# --- START OF FILE project/spin_wheel_api.py ---
import time
import random
import sys
from flask import (
    Blueprint, request, jsonify, session
)
from firebase_admin import db
from .utils import login_required

bp = Blueprint('spin_wheel', __name__, url_prefix='/api/spin_wheel')

def get_prize_from_settings(settings):
    """دالة مساعدة لاختيار جائزة عشوائية بناءً على الأوزان المعطاة."""
    prizes_config = settings.get('prizes', [])
    try:
        if not prizes_config: return 100, -1 # Default prize, invalid index
        
        # Create a list of tuples (prize_object, index)
        indexed_prizes = [(p, i) for i, p in enumerate(prizes_config)]

        prizes = [p['value'] for p, i in indexed_prizes]
        weights = [float(p['weight']) for p, i in indexed_prizes]
        
        if not prizes or not weights or sum(weights) <= 0:
            return 100, -1

        # random.choices returns a list, so get the first element
        chosen_prize_value = random.choices(prizes, weights=weights, k=1)[0]

        # Find the original index of the chosen prize
        for p, i in indexed_prizes:
            if p['value'] == chosen_prize_value:
                # We need to find the specific segment that was chosen if there are duplicates
                # To do this, we can filter down to only segments with the winning value and choose one
                # based on their relative weights.
                
                winning_value_segments = [(seg, original_index) for seg, original_index in indexed_prizes if seg['value'] == chosen_prize_value]
                
                if len(winning_value_segments) == 1:
                    return chosen_prize_value, winning_value_segments[0][1]

                # If multiple segments have the same prize value, we need to pick one randomly based on their weights
                sub_weights = [float(seg['weight']) for seg, _ in winning_value_segments]
                chosen_segment_tuple = random.choices(winning_value_segments, weights=sub_weights, k=1)[0]
                return chosen_prize_value, chosen_segment_tuple[1]

        return 100, -1 # Fallback
    except (ValueError, TypeError, IndexError) as e:
        print(f"Error in get_prize_from_settings: {e}", file=sys.stderr)
        return 100, -1

@bp.route('/state', methods=['POST'])
@login_required
def check_and_update_state():
    """
    يتم استدعاء هذا المسار من الواجهة الأمامية عند تحميل الصفحة للتأكد من
    أن المستخدم يحصل على محاولاته المجانية اليومية إذا كان مستحقاً لها.
    """
    ref_site_settings = db.reference('site_settings/')
    ref_user_spin_state = db.reference('user_spin_state/')
    user_id = session.get('user_id')
    
    if not user_id: 
        return jsonify(success=False, message="User not found in session"), 401

    try:
        settings = ref_site_settings.child('spin_wheel_settings').get() or {}
        user_state_ref = ref_user_spin_state.child(user_id)
        user_state = user_state_ref.get()

        free_attempts_per_day = settings.get('maxAttempts', 1)

        # إذا كان المستخدم جديداً وليس له حالة، يتم إنشاء واحدة
        if user_state is None:
            user_state = {
                'freeAttempts': free_attempts_per_day,
                'purchasedAttempts': 0,
                'lastFreeUpdateTimestamp': int(time.time())
            }
            user_state_ref.set(user_state)
            return jsonify(success=True, message="User state created.")

        cooldown_seconds = settings.get('cooldownHours', 24) * 3600
        max_accumulation = settings.get('maxAccumulation', 10)
        
        last_free_update = user_state.get('lastFreeUpdateTimestamp', 0)
        now = int(time.time())
        
        # التحقق مما إذا مر وقت كافٍ لتجديد المحاولات
        if now - last_free_update >= cooldown_seconds:
            updates = {'lastFreeUpdateTimestamp': now}
            current_free = user_state.get('freeAttempts', 0)
            
            # منح محاولات جديدة فقط إذا لم يصل المستخدم للحد الأقصى للتجميع
            if current_free < max_accumulation:
                new_total = min(current_free + free_attempts_per_day, max_accumulation)
                updates['freeAttempts'] = new_total
            
            user_state_ref.update(updates)

        return jsonify(success=True)

    except Exception as e:
        print(f"!!! Check State Error for user {user_id}: {e}", file=sys.stderr)
        return jsonify(success=False, message="Server error during state update"), 500

# <<< --- التعديل الجذري هنا --- >>>
@bp.route('/initiate_spin/<attempt_type>', methods=['POST'])
@login_required
def initiate_spin(attempt_type):
    """
    This is the new single endpoint for spinning. It's called BEFORE the animation starts.
    It determines the prize, updates the wallet, and returns the result to the client.
    """
    user_id, user_name = session['user_id'], session.get('name', 'مستخدم')
    
    if attempt_type not in ['free', 'purchased']:
        return jsonify(success=False, message="نوع محاولة غير صالح."), 400

    db_attempt_key = 'freeAttempts' if attempt_type == 'free' else 'purchasedAttempts'

    ref_site_settings = db.reference('site_settings/')
    ref_wallets = db.reference('wallets/')
    ref_user_spin_state = db.reference(f'user_spin_state/{user_id}')
    ref_activity_log = db.reference('activity_log/')

    settings = ref_site_settings.child('spin_wheel_settings').get() or {}
    if not settings.get('enabled', False):
        return jsonify(success=False, message="عجلة الحظ معطلة حالياً."), 403

    user_state = ref_user_spin_state.get() or {}
    
    attempts = user_state.get(db_attempt_key, 0)
    if attempts < 1:
        return jsonify(success=False, message="ليس لديك محاولات كافية."), 400

    # --- SINGLE POINT OF TRUTH: Determine prize and index on the server ---
    chosen_prize_cc, winning_segment_index = get_prize_from_settings(settings)
    if winning_segment_index == -1:
        return jsonify(success=False, message="حدث خطأ في تحديد الجائزة من الإعدادات."), 500

    try:
        # Use a transaction to safely decrement attempts and update wallet
        # 1. Decrement attempt
        ref_user_spin_state.child(db_attempt_key).transaction(lambda current_attempts: (current_attempts or 0) - 1)
        
        # 2. Add prize to wallet
        ref_wallets.child(f"{user_id}/cc").transaction(lambda current_wallet_cc: (current_wallet_cc or 0) + chosen_prize_cc)

        # 3. Log activity
        log_text = f"'{user_name}' فاز بـ {chosen_prize_cc:,} CC من عجلة الحظ ({'مجانية' if attempt_type == 'free' else 'مشتراة'})."
        ref_activity_log.push({ 'type': 'gift', 'text': log_text, 'timestamp': int(time.time()), 'user_id': user_id, 'user_name': user_name })
        
        # Return the confirmed prize and the segment index to the client
        return jsonify(success=True, prize=chosen_prize_cc, winningSegmentIndex=winning_segment_index + 1) # Winwheel.js is 1-based index
    except Exception as e:
        print(f"!!! Initiate Spin Error: {e}", file=sys.stderr)
        # Attempt to refund the spin if the wallet update failed
        ref_user_spin_state.child(db_attempt_key).transaction(lambda current_attempts: (current_attempts or 0) + 1)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء دوران العجلة."), 500
# <<< --- نهاية التعديل الجذري --- >>>
# --- END OF FILE project/spin_wheel_api.py ---
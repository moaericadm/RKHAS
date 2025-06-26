# --- START OF FILE project/spin_wheel_api.py ---
import time
import random
import sys
from flask import (
    Blueprint, request, jsonify, session
)
# *** التعديل: استيراد الوحدات الفرعية المطلوبة فقط ***
from firebase_admin import db
from .auth_routes import login_required

bp = Blueprint('spin_wheel', __name__, url_prefix='/api/spin_wheel')

def get_prize_from_settings(settings):
    """Helper to get a random prize based on weights."""
    prizes_config = settings.get('prizes', [])
    try:
        prizes = [int(p['value']) for p in prizes_config]
        weights = [float(p['weight']) for p in prizes_config]
        if not prizes or not weights or sum(weights) <= 0:
            return None
        return random.choices(prizes, weights=weights, k=1)[0]
    except (ValueError, TypeError, IndexError):
        return None

@bp.route('/state', methods=['POST'])
@login_required
def check_and_update_state():
    ref_site_settings = db.reference('site_settings/')
    ref_user_spin_state = db.reference('user_spin_state/')
    
    user_id = session.get('user_id')
    if not user_id: return jsonify(success=False), 401

    try:
        settings = ref_site_settings.child('spin_wheel_settings').get() or {}
        user_state_ref = ref_user_spin_state.child(user_id)
        user_state = user_state_ref.get()

        free_attempts_per_day = settings.get('maxAttempts', 1)

        if user_state is None:
            user_state = {'freeAttempts': free_attempts_per_day, 'purchasedAttempts': 0, 'lastFreeUpdateTimestamp': int(time.time())}
            user_state_ref.set(user_state)
            return jsonify(success=True)

        cooldown_hours = settings.get('cooldownHours', 24)
        max_accumulation = settings.get('maxAccumulation', 10)
        cooldown_seconds = cooldown_hours * 3600
        
        last_free_update = user_state.get('lastFreeUpdateTimestamp', 0)
        now = int(time.time())
        time_since_last_update = now - last_free_update
        
        if time_since_last_update >= cooldown_seconds:
            updates = {'lastFreeUpdateTimestamp': now}
            current_free = user_state.get('freeAttempts', 0)
            
            if current_free < max_accumulation:
                new_total = min(current_free + free_attempts_per_day, max_accumulation)
                updates['freeAttempts'] = new_total
            
            user_state_ref.update(updates)

        return jsonify(success=True)

    except Exception as e:
        print(f"!!! Check State Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="Server error"), 500


def process_spin(user_id, user_name, attempt_type):
    """Generic function to process a spin."""
    ref_site_settings = db.reference('site_settings/')
    ref_wallets = db.reference('wallets/')
    ref_user_spin_state = db.reference('user_spin_state/')
    ref_activity_log = db.reference('activity_log/')

    settings = ref_site_settings.child('spin_wheel_settings').get() or {}
    if not settings.get('enabled', False):
        return jsonify(success=False, message="عجلة الحظ معطلة حالياً."), 403

    user_state_ref = ref_user_spin_state.child(user_id)
    user_state = user_state_ref.get() or {}
    
    attempts = user_state.get(attempt_type, 0)
    if attempts < 1:
        return jsonify(success=False, message="ليس لديك محاولات من هذا النوع."), 400

    chosen_prize_cc = get_prize_from_settings(settings)
    if chosen_prize_cc is None:
        return jsonify(success=False, message="خطأ في إعدادات الجوائز."), 500
        
    try:
        current_wallet_cc = ref_wallets.child(f"{user_id}/cc").get() or 0
        updates = {
            f"user_spin_state/{user_id}/{attempt_type}": attempts - 1,
            f"wallets/{user_id}/cc": current_wallet_cc + chosen_prize_cc
        }
        db.reference('/').update(updates)
        ref_activity_log.push({
            'type': 'gift', 'text': f"'{user_name}' فاز بـ {chosen_prize_cc:,} CC من عجلة الحظ ({'مجانية' if attempt_type == 'freeAttempts' else 'مشتراة'}).",
            'timestamp': int(time.time()), 'user_id': user_id, 'user_name': user_name
        })
        return jsonify(success=True, prize=chosen_prize_cc)
    except Exception as e:
        print(f"!!! Atomic Spin Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم."), 500

@bp.route('/spin/free', methods=['POST'])
@login_required
def spin_free():
    return process_spin(session['user_id'], session['name'], 'freeAttempts')

@bp.route('/spin/purchased', methods=['POST'])
@login_required
def spin_purchased():
    return process_spin(session['user_id'], session['name'], 'purchasedAttempts')
# --- END OF FILE project/spin_wheel_api.py ---
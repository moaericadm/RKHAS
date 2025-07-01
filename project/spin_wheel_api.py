# --- START OF FILE project/spin_wheel_api.py ---
import time
import random
import sys
from flask import (
    Blueprint, request, jsonify, session
)
from firebase_admin import db
from .utils import login_required

bp = Blueprint('spin_wheel', __name__)

try:
    from .user_interactions_api import _log_public_notification
except ImportError:
    def _log_public_notification(text):
        user_id = session.get('user_id')
        user_name = session.get('name')
        if not all([user_id, user_name]):
            return
        try:
            user_avatar = db.reference(f'registered_users/{user_id}/current_avatar').get()
            db.reference('live_feed').push({
                'user_id': user_id, 'user_name': user_name,
                'user_avatar': user_avatar or '', 'text': text,
                'timestamp': int(time.time())
            })
        except Exception as e:
            print(f"!!! Public Notification Log Error (Fallback): {e}", file=sys.stderr)

def get_prize_from_settings(settings):
    prizes_config = settings.get('prizes', [])
    try:
        if not prizes_config: return 100, -1
        indexed_prizes = [(p, i) for i, p in enumerate(prizes_config)]
        prizes = [p['value'] for p, i in indexed_prizes]
        weights = [float(p['weight']) for p, i in indexed_prizes]
        if not prizes or not weights or sum(weights) <= 0: return 100, -1
        chosen_prize_value = random.choices(prizes, weights=weights, k=1)[0]
        winning_value_segments = [(seg, original_index) for seg, original_index in indexed_prizes if seg['value'] == chosen_prize_value]
        if len(winning_value_segments) == 1:
            return chosen_prize_value, winning_value_segments[0][1]
        sub_weights = [float(seg['weight']) for seg, _ in winning_value_segments]
        chosen_segment_tuple = random.choices(winning_value_segments, weights=sub_weights, k=1)[0]
        return chosen_prize_value, chosen_segment_tuple[1]
    except (ValueError, TypeError, IndexError) as e:
        print(f"Error in get_prize_from_settings: {e}", file=sys.stderr)
        return 100, -1

@bp.route('/state', methods=['POST'])
@login_required
def check_and_update_state():
    user_id = session.get('user_id')
    try:
        settings = db.reference('site_settings/spin_wheel_settings').get() or {}
        user_state_ref = db.reference(f'user_spin_state/{user_id}')
        user_state = user_state_ref.get()
        free_attempts = settings.get('maxAttempts', 1)
        if user_state is None:
            user_state_ref.set({'freeAttempts': free_attempts, 'purchasedAttempts': 0, 'lastFreeUpdateTimestamp': int(time.time())})
            return jsonify(success=True)
        cooldown_seconds = settings.get('cooldownHours', 24) * 3600
        max_accumulation = settings.get('maxAccumulation', 10)
        last_update = user_state.get('lastFreeUpdateTimestamp', 0)
        now = int(time.time())
        if now - last_update >= cooldown_seconds:
            updates = {'lastFreeUpdateTimestamp': now}
            current_free = user_state.get('freeAttempts', 0)
            if current_free < max_accumulation:
                updates['freeAttempts'] = min(current_free + free_attempts, max_accumulation)
            user_state_ref.update(updates)
        return jsonify(success=True)
    except Exception as e:
        print(f"!!! Check State Error for user {user_id}: {e}", file=sys.stderr)
        return jsonify(success=False, message="Server error"), 500

# *** بداية التعديل: تعديل شامل للمنطق ***
@bp.route('/initiate_spin/<attempt_type>', methods=['POST'])
@login_required
def initiate_spin(attempt_type):
    user_id = session['user_id']
    if attempt_type not in ['free', 'purchased']:
        return jsonify(success=False, message="نوع محاولة غير صالح."), 400

    db_attempt_key = 'freeAttempts' if attempt_type == 'free' else 'purchasedAttempts'
    user_state_ref = db.reference(f'user_spin_state/{user_id}')
    
    settings = db.reference('site_settings/spin_wheel_settings').get() or {}
    if not settings.get('enabled', False):
        return jsonify(success=False, message="عجلة الحظ معطلة حالياً."), 403

    # استخدام transaction لضمان خصم المحاولة بشكل آمن
    def transaction_update(current_state):
        if current_state is None:
            return None # لا يوجد حالة للمستخدم، لا تقم بالعملية
        
        attempts = current_state.get(db_attempt_key, 0)
        if attempts < 1:
            raise ValueError("No attempts left") # سيتم التقاط هذا الخطأ في الخارج

        current_state[db_attempt_key] = attempts - 1
        return current_state

    try:
        user_state_ref.transaction(transaction_update)
    except ValueError:
        return jsonify(success=False, message="ليس لديك محاولات كافية."), 400
    except Exception as e:
        print(f"!!! Spin Initiation Transaction Error for {user_id}: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم أثناء بدء الدوران."), 500
        
    chosen_prize_cc, winning_segment_index = get_prize_from_settings(settings)
    if winning_segment_index == -1:
        # إذا فشل تحديد الجائزة، يجب إعادة المحاولة للمستخدم
        user_state_ref.child(db_attempt_key).transaction(lambda current: (current or 0) + 1)
        return jsonify(success=False, message="حدث خطأ في تحديد الجائزة."), 500

    # حفظ الجائزة مؤقتاً في جلسة المستخدم لمنع الغش
    session['pending_spin_prize'] = {'value': chosen_prize_cc, 'timestamp': int(time.time())}
    session.modified = True
    
    return jsonify(success=True, winningSegmentIndex=winning_segment_index + 1)

@bp.route('/claim_prize', methods=['POST'])
@login_required
def claim_prize():
    user_id, user_name = session['user_id'], session.get('name', 'مستخدم')
    
    pending_prize = session.get('pending_spin_prize')
    if not pending_prize or (int(time.time()) - pending_prize.get('timestamp', 0)) > 60:
        return jsonify(success=False, message="لا توجد جائزة للمطالبة بها أو انتهت صلاحية الطلب."), 400
        
    prize_value = pending_prize['value']
    
    try:
        # إضافة الجائزة إلى المحفظة
        db.reference(f'wallets/{user_id}/cc').transaction(lambda current_cc: (current_cc or 0) + prize_value)
        
        # تسجيل النشاط
        log_text_admin = f"'{user_name}' ربح وطالب بـ {prize_value:,} CC من عجلة الحظ."
        db.reference('activity_log').push({
            'type': 'gift', 'text': log_text_admin, 'timestamp': int(time.time()),
            'user_id': user_id, 'user_name': user_name
        })

        # إرسال إشعار عام
        log_text_public = f"ربح {prize_value:,} CC من عجلة الحظ!"
        _log_public_notification(log_text_public)
        
        # حذف الجائزة المعلقة من الجلسة
        session.pop('pending_spin_prize', None)
        session.modified = True

        return jsonify(success=True, message=f"تمت إضافة {prize_value:,} CC إلى محفظتك بنجاح!")
        
    except Exception as e:
        print(f"!!! Prize Claim Error for {user_id}: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء المطالبة بالجائزة."), 500
# *** نهاية التعديل ***
# --- END OF FILE project/spin_wheel_api.py ---
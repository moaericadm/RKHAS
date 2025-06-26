# --- START OF FILE project/admin_api.py ---
import time
import sys
from flask import (
    Blueprint, request, jsonify, session
)
from firebase_admin import db, auth
from .auth_routes import admin_required

bp = Blueprint('admin_api', __name__, url_prefix='/api/admin')

# --- USER MANAGEMENT ---
@bp.route('/add_user', methods=['POST'])
@admin_required
def add_user():
    ref_users = db.reference('users/')
    ref_points_history = db.reference('points_history/')
    ref_candidates = db.reference('candidates/')
    
    name = request.form.get('name', '').strip()
    points_str = request.form.get('points', '0')
    original_name = request.form.get('original_name', '').strip()
    if not name: return jsonify(success=False, message="اسم الزاحف مطلوب."), 400
    try: points = int(points_str)
    except (ValueError, TypeError): return jsonify(success=False, message="النقاط يجب أن تكون رقماً صحيحاً."), 400
    if not original_name and ref_users.child(name).get(): return jsonify(success=False, message="هذا الاسم موجود بالفعل."), 409
    if original_name and original_name != name:
        if ref_users.child(name).get(): return jsonify(success=False, message=f"الاسم الجديد '{name}' موجود بالفعل."), 409
        old_data = ref_users.child(original_name).get()
        if old_data:
            old_data['name'] = name
            ref_users.child(name).set(old_data)
            ref_users.child(original_name).delete()
            old_history = ref_points_history.child(original_name).get()
            if old_history: 
                ref_points_history.child(name).set(old_history)
                ref_points_history.child(original_name).delete()
            if ref_candidates.child(original_name).get():
                ref_candidates.child(name).set(True)
                ref_candidates.child(original_name).delete()
        ref_users.child(name).update({'points': points})
    else:
        user_data = ref_users.child(name).get() or {}
        current_likes = user_data.get('likes', 0)
        ref_users.child(name).update({'name': name, 'points': points, 'likes': current_likes})
    ref_points_history.child(name).push({'points': points, 'timestamp': int(time.time())})
    return jsonify(success=True)

@bp.route('/delete_user/<username>', methods=['POST'])
@admin_required
def delete_user(username):
    ref_users = db.reference('users/')
    ref_candidates = db.reference('candidates/')
    ref_points_history = db.reference('points_history/')
    if not ref_users.child(username).get(): return jsonify(success=False, message="المستخدم غير موجود"), 404
    ref_users.child(username).delete()
    ref_candidates.child(username).delete()
    ref_points_history.child(username).delete()
    return jsonify(success=True)

@bp.route('/ban_user', methods=['POST'])
@admin_required
def ban_user():
    ref_banned_users = db.reference('banned_users/')
    user_id, user_name = request.form.get('user_id_to_ban', ''), request.form.get('user_name_to_ban', 'مستخدم')
    if not user_id: return jsonify(success=False, message="معرف المستخدم مطلوب."), 400
    ref_banned_users.child(user_id).set({'banned': True, 'name': user_name, 'timestamp': int(time.time()), 'banned_by': session.get('name', 'Admin')})
    return jsonify(success=True, message=f"تم حظر المستخدم '{user_name}' بنجاح.")

@bp.route('/unban_user/<user_id>', methods=['POST'])
@admin_required
def unban_user(user_id):
    ref_banned_users = db.reference('banned_users/')
    if not ref_banned_users.child(user_id).get(): return jsonify(success=False, message="هذا المستخدم غير محظور."), 404
    ref_banned_users.child(user_id).delete()
    return jsonify(success=True, message="تم رفع الحظر عن المستخدم.")

@bp.route('/manage_user/<user_id>/<action>', methods=['POST'])
@admin_required
def manage_user(user_id, action):
    ref_registered_users = db.reference('registered_users/')
    user_ref = ref_registered_users.child(user_id)
    user_data = user_ref.get()
    if not user_data: 
        return jsonify(success=False, message="المستخدم غير موجود."), 404
    if action not in ['approve', 'reject']: 
        return jsonify(success=False, message="إجراء غير صالح."), 400
    
    try:
        if action == 'approve':
            auth.update_user(user_id, disabled=False)
            user_ref.update({'status': 'approved'})
            message = "تم قبول المستخدم وتفعيل حسابه بنجاح."
        else: # action == 'reject'
            user_ref.update({'status': 'rejected'})
            try:
                auth.delete_user(user_id)
            except auth.UserNotFoundError:
                pass 
            message = "تم رفض المستخدم وحذف طلبه."
        return jsonify(success=True, message=message)
    except Exception as e:
        print(f"!!! User Management Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم."), 500


# --- CONTENT MANAGEMENT ---
@bp.route('/candidate/<action>/<username>', methods=['POST'])
@admin_required
def manage_candidate(action, username):
    ref_candidates = db.reference('candidates/')
    if action == 'add': ref_candidates.child(username).set(True)
    elif action == 'remove': ref_candidates.child(username).delete()
    return jsonify(success=True)

@bp.route('/announcements/<action>', methods=['POST'])
@admin_required
def manage_announcement(action):
    ref_site_settings = db.reference('site_settings/')
    if action == 'add':
        text = request.form.get('text', '').strip()
        if text: ref_site_settings.child('announcements').push({'text': text})
    elif action.startswith('delete/'):
        item_id = action.split('/')[-1]
        ref_site_settings.child(f'announcements/{item_id}').delete()
    return jsonify(success=True)

@bp.route('/honor_roll/<action>', methods=['POST'])
@admin_required
def manage_honor_roll(action):
    ref_site_settings = db.reference('site_settings/')
    if action == 'add':
        name = request.form.get('name', '').strip()
        if name: ref_site_settings.child('honor_roll').push({'name': name})
    elif action.startswith('delete/'):
        item_id = action.split('/')[-1]
        ref_site_settings.child(f'honor_roll/{item_id}').delete()
    return jsonify(success=True)

@bp.route('/user_message/send', methods=['POST'])
@admin_required
def send_user_message():
    ref_user_messages = db.reference('user_messages/')
    user_id, user_name, message = request.form.get('user_id'), request.form.get('user_name'), request.form.get('message')
    if not all([user_id, message]): return jsonify(success=False, message="معرف المستخدم والرسالة مطلوبان."), 400
    ref_user_messages.child(user_id).push({'text': message, 'timestamp': int(time.time())})
    return jsonify(success=True, message=f"تم إرسال الرسالة إلى {user_name}")

# --- SETTINGS MANAGEMENT ---
@bp.route('/settings/spin_wheel', methods=['POST'])
@admin_required
def save_spin_wheel_settings():
    ref_site_settings = db.reference('site_settings/')
    settings = request.get_json()
    if settings:
        ref_site_settings.child('spin_wheel_settings').set(settings)
    return jsonify(success=True, message=f"تم حفظ إعدادات عجلة الحظ بنجاح!")

# --- SHOP & ECONOMY MANAGEMENT ---
@bp.route('/shop/add_points_product', methods=['POST'])
@admin_required
def add_points_product():
    ref_site_settings = db.reference('site_settings/')
    try:
        data = request.get_json()
        product_type = data.get('type')
        points = int(data.get('points_amount'))
        price = int(data.get('sp_price'))
        limit = int(data.get('daily_limit'))

        if not all([product_type, points > 0, price > 0, limit > 0]):
            return jsonify(success=False, message="بيانات المنتج غير صالحة."), 400
        if product_type not in ['raise', 'drop']:
            return jsonify(success=False, message="نوع المنتج غير صالح."), 400

        new_product = {
            "type": product_type,
            "points_amount": points,
            "sp_price": price,
            "daily_limit": limit
        }
        ref_site_settings.child('shop_products_points').push(new_product)
        return jsonify(success=True)
    except (ValueError, TypeError, KeyError):
        return jsonify(success=False, message="بيانات الإدخال غير صحيحة."), 400
    except Exception as e:
        print(f"!!! Add Points Product Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500

@bp.route('/shop/delete_points_product/<product_id>', methods=['POST'])
@admin_required
def delete_points_product(product_id):
    ref_site_settings = db.reference('site_settings/')
    if not product_id:
        return jsonify(success=False, message="معرف المنتج مطلوب."), 400
    ref_site_settings.child(f'shop_products_points/{product_id}').delete()
    return jsonify(success=True)


# --- SPIN WHEEL & WALLET ADMIN CONTROLS ---

# *** התיקון כאן | THE FIX IS HERE ***
@bp.route('/update_wallet', methods=['POST'])
@admin_required
def update_wallet():
    ref_wallets = db.reference('wallets/')
    ref_activity_log = db.reference('activity_log/')
    
    user_id = request.form.get('user_id')
    user_name = request.form.get('user_name') # للحفظ في سجل النشاط
    
    if not user_id:
        return jsonify(success=False, message="معرف المستخدم مطلوب."), 400
        
    try:
        new_cc = int(request.form.get('cc'))
        new_sp = float(request.form.get('sp'))
        
        if new_cc < 0 or new_sp < 0:
            return jsonify(success=False, message="لا يمكن أن تكون الأرصدة سالبة."), 400
            
    except (ValueError, TypeError):
        return jsonify(success=False, message="الرجاء إدخال قيم رقمية صحيحة للأرصدة."), 400

    try:
        # تحديث المحفظة مباشرة
        ref_wallets.child(user_id).update({
            'cc': new_cc,
            'sp': new_sp
        })
        
        # تسجيل هذا الإجراء الإداري في سجل النشاط
        admin_name = session.get('name', 'Admin')
        ref_activity_log.push({
            'type': 'admin_edit',
            'text': f"'{admin_name}' قام بتعديل محفظة '{user_name}' إلى {new_cc} CC و {new_sp:.2f} SP.",
            'timestamp': int(time.time()),
            'admin_id': session.get('user_id'),
            'target_user_id': user_id
        })
        
        return jsonify(success=True, message="تم تحديث المحفظة بنجاح.")
    except Exception as e:
        print(f"!!! Update Wallet Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء تحديث المحفظة."), 500


@bp.route('/update_purchased_attempts', methods=['POST'])
@admin_required
def update_purchased_attempts():
    ref_user_spin_state = db.reference('user_spin_state/')
    user_id = request.form.get('user_id')
    try:
        attempts = int(request.form.get('attempts'))
        if attempts < 0: return jsonify(success=False, message="عدد المحاولات لا يمكن أن يكون سالباً."), 400
    except (ValueError, TypeError):
        return jsonify(success=False, message="الرجاء إدخال عدد صحيح للمحاولات."), 400
    if not user_id: return jsonify(success=False, message="معرف المستخدم مطلوب."), 400
    try:
        ref_user_spin_state.child(f"{user_id}/purchasedAttempts").set(attempts)
        return jsonify(success=True, message="تم تحديث رصيد المحاولات المشتراة بنجاح.")
    except Exception as e:
        print(f"!!! Update Purchased Attempts Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم."), 500

@bp.route('/reset_all_free_spins', methods=['POST'])
@admin_required
def reset_all_free_spins():
    ref_site_settings = db.reference('site_settings/')
    ref_registered_users = db.reference('registered_users/')
    
    user_id_to_reset = request.form.get('user_id')
    
    try:
        settings = ref_site_settings.child('spin_wheel_settings').get() or {}
        free_attempts_to_add = settings.get('maxAttempts', 1)
        now = int(time.time())

        updates = {}
        target_users_count = 0
        
        if user_id_to_reset:
            updates[f"user_spin_state/{user_id_to_reset}/freeAttempts"] = free_attempts_to_add
            updates[f"user_spin_state/{user_id_to_reset}/lastFreeUpdateTimestamp"] = now
            target_users_count = 1
        else:
            registered_users = ref_registered_users.get() or {}
            if not registered_users:
                return jsonify(success=True, message="لا يوجد مستخدمون مسجلون لمنحهم محاولات.")
            for user_id in registered_users:
                updates[f"user_spin_state/{user_id}/freeAttempts"] = free_attempts_to_add
                updates[f"user_spin_state/{user_id}/lastFreeUpdateTimestamp"] = now
            target_users_count = len(registered_users)

        if updates:
            db.reference('/').update(updates)
            
        return jsonify(success=True, message=f"تم إرسال طلب إعادة التعيين لـ {target_users_count} مستخدم.")
    except Exception as e:
        print(f"!!! Reset All Free Spins Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء إعادة التعيين."), 500
# --- END OF FILE project/admin_api.py ---
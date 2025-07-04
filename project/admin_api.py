# --- START OF FILE project/admin_api.py ---
import time
import sys
import os
import io
from flask import Blueprint, request, jsonify, session, current_app
from firebase_admin import db, auth
from .utils import admin_required
from . import scheduled_tasks, scheduler 
from apscheduler.triggers.interval import IntervalTrigger

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

bp = Blueprint('admin_api', __name__)

E_ARABIC_TO_W_ARABIC = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')

def _to_float(value, default=0.0):
    if value is None:
        return default
    try:
        s_value = str(value).translate(E_ARABIC_TO_W_ARABIC).strip()
        return float(s_value) if s_value else default
    except (ValueError, TypeError):
        return default

def _to_int(value, default=0):
    return int(_to_float(value, float(default)))

def _get_drive_service():
    SERVICE_ACCOUNT_FILE = os.getenv('FIREBASE_SERVICE_ACCOUNT')
    SCOPES = ['https://www.googleapis.com/auth/drive']
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    service = build('drive', 'v3', credentials=creds)
    return service

@bp.route('/adjust_points_percent', methods=['POST'])
@admin_required
def adjust_points_percent():
    try:
        username = request.form.get('username')
        percent_str = request.form.get('percent')
        direction = request.form.get('direction')

        if not all([username, percent_str, direction]):
            return jsonify(success=False, message="بيانات ناقصة."), 400

        percent = _to_float(percent_str)
        if percent <= 0:
            return jsonify(success=False, message="النسبة المئوية يجب أن تكون أكبر من صفر."), 400

        user_ref = db.reference(f'users/{username}')
        user_data = user_ref.get()
        if not user_data:
            return jsonify(success=False, message="الزاحف غير موجود."), 404

        current_points = _to_int(user_data.get('points', 0))
        change_amount = int(current_points * (percent / 100.0))

        if direction == 'decrease':
            change_amount = -change_amount

        new_points = max(0, current_points + change_amount)

        user_ref.update({'points': new_points})
        db.reference(f'points_history/{username}').push({'points': new_points, 'timestamp': int(time.time())})

        log_text = f"الأدمن '{session.get('name')}' قام بـ{'رفع' if direction == 'increase' else 'خفض'} نقاط '{username}' بنسبة {percent}%."
        db.reference('activity_log').push({'type': 'admin_edit', 'text': log_text, 'timestamp': int(time.time())})
        
        return jsonify(success=True)

    except (ValueError, TypeError):
        return jsonify(success=False, message="النسبة المئوية يجب أن تكون رقماً صالحاً."), 400
    except Exception as e:
        print(f"!!! Adjust Points by Percent Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500


@bp.route('/add_user', methods=['POST'])
@admin_required
def add_user():
    try:
        name = request.form.get('name', '').strip()
        points = _to_int(request.form.get('points', '0'))
        stock_multiplier = _to_float(request.form.get('stock_multiplier'), 1.0)
        avatar_url = request.form.get('avatar_url', '') 
        original_name = request.form.get('original_name', '').strip()

        if not name: return jsonify(success=False, message="اسم الزاحف مطلوب."), 400
        
        ref_users = db.reference('users/')
        ref_history = db.reference('points_history/')
        
        if not original_name and ref_users.child(name).get():
            return jsonify(success=False, message="هذا الاسم موجود بالفعل."), 409
        if original_name and original_name != name and ref_users.child(name).get():
            return jsonify(success=False, message=f"الاسم الجديد '{name}' موجود بالفعل."), 409
            
        if original_name and original_name != name:
            old_data = ref_users.child(original_name).get()
            if old_data:
                ref_users.child(name).set(old_data)
                ref_users.child(original_name).delete()
            old_history = ref_history.child(original_name).get()
            if old_history: 
                ref_history.child(name).set(old_history)
                ref_history.child(original_name).delete()
                
        user_data = ref_users.child(name).get() or {}
        user_data.update({
            'name': name, 
            'points': points, 
            'stock_multiplier': stock_multiplier,
            'avatar_url': avatar_url
        })
        
        if 'likes' not in user_data: user_data['likes'] = 0

        ref_users.child(name).set(user_data)
        
        db.reference(f'points_history/{name}').push({'points': points, 'timestamp': int(time.time())})
        return jsonify(success=True)
        
    except (ValueError, TypeError):
        return jsonify(success=False, message="النقاط ومضاعف السهم يجب أن تكون أرقاماً صالحة."), 400
    except Exception as e:
        print(f"!!! Add/Edit User Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500

@bp.route('/delete_user/<username>', methods=['POST'])
@admin_required
def delete_user(username):
    if username: 
        db.reference(f'users/{username}').delete()
        db.reference(f'candidates/{username}').delete()
        db.reference(f'points_history/{username}').delete()
    return jsonify(success=True)

@bp.route('/candidate/add', methods=['POST'])
@admin_required
def add_candidate():
    name = request.form.get('name', '').strip()
    if not name:
        return jsonify(success=False, message="اسم المرشح مطلوب."), 400
    if db.reference(f'users/{name}').get():
        return jsonify(success=False, message="هذا الاسم موجود بالفعل كزاحف."), 409
    if db.reference(f'candidates/{name}').get():
        return jsonify(success=False, message="هذا الاسم موجود بالفعل في قائمة المرشحين."), 409
    try:
        db.reference(f'candidates/{name}').set(True) 
        return jsonify(success=True, message=f"تمت إضافة '{name}' إلى قائمة المرشحين بنجاح.")
    except Exception as e:
        print(f"!!! Add Candidate Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء إضافة المرشح."), 500

@bp.route('/ban_user', methods=['POST'])
@admin_required
def ban_user():
    user_id = request.form.get('user_id_to_ban')
    if user_id: 
        db.reference(f'banned_users/{user_id}').set({
            'name': request.form.get('user_name_to_ban', 'مستخدم'), 
            'timestamp': int(time.time()), 'banned_by': session.get('name', 'Admin')})
    return jsonify(success=True)

@bp.route('/unban_user/<user_id>', methods=['POST'])
@admin_required
def unban_user(user_id):
    if user_id: db.reference(f'banned_users/{user_id}').delete()
    return jsonify(success=True)

@bp.route('/manage_user/<user_id>/<action>', methods=['POST'])
@admin_required
def manage_user(user_id, action):
    user_ref = db.reference(f'registered_users/{user_id}');
    if not user_ref.get(): return jsonify(success=False, message="المستخدم غير موجود."), 404
    try:
        if action == 'approve': auth.update_user(user_id, disabled=False); user_ref.update({'status': 'approved'}); return jsonify(success=True)
        elif action == 'reject': auth.delete_user(user_id); user_ref.delete(); return jsonify(success=True)
    except auth.UserNotFoundError: user_ref.delete(); return jsonify(success=True)
    except Exception as e: return jsonify(success=False, message=str(e)), 500

@bp.route('/candidate/approve', methods=['POST'])
@admin_required
def approve_candidate():
    name = request.form.get('name', '').strip()
    if name: 
        db.reference(f'users/{name}').set({
            'name': name, 
            'points': 0, 
            'likes': 0, 
            'stock_multiplier': 1.0
        })
        db.reference(f'candidates/{name}').delete()
    return jsonify(success=True)

@bp.route('/candidate/reject', methods=['POST'])
@admin_required
def reject_candidate():
    name = request.form.get('name', '').strip()
    if name: db.reference(f'candidates/{name}').delete()
    return jsonify(success=True)

@bp.route('/announcements/add', methods=['POST'])
@admin_required
def add_announcement():
    text = request.form.get('text', '').strip()
    if text: db.reference('site_settings/announcements').push({'text': text})
    return jsonify(success=True)

@bp.route('/announcements/delete/<item_id>', methods=['POST'])
@admin_required
def delete_announcement(item_id):
    if item_id: db.reference(f'site_settings/announcements/{item_id}').delete()
    return jsonify(success=True)

@bp.route('/honor_roll/add', methods=['POST'])
@admin_required
def add_to_honor_roll():
    name = request.form.get('name', '').strip()
    if name: db.reference('site_settings/honor_roll').push({'name': name})
    return jsonify(success=True)

@bp.route('/honor_roll/delete/<item_id>', methods=['POST'])
@admin_required
def delete_from_honor_roll(item_id):
    if item_id: db.reference(f'site_settings/honor_roll/{item_id}').delete()
    return jsonify(success=True)

@bp.route('/user_message/send', methods=['POST'])
@admin_required
def send_user_message():
    user_id = request.form.get('user_id'); message = request.form.get('message')
    if all([user_id, message]): db.reference(f'user_messages/{user_id}').push({'text': message, 'timestamp': int(time.time())})
    return jsonify(success=True)

@bp.route('/update_wallet', methods=['POST'])
@admin_required
def update_wallet():
    user_id = request.form.get('user_id'); user_name = request.form.get('user_name', 'مستخدم')
    if not user_id: return jsonify(success=False, message="User ID is required."), 400
    try: 
        new_cc = _to_int(request.form.get('cc'))
        new_sp = _to_float(request.form.get('sp'))
    except (ValueError, TypeError): return jsonify(success=False, message="Invalid number format."), 400
    db.reference(f'wallets/{user_id}').update({'cc': new_cc, 'sp': new_sp})
    db.reference('activity_log').push({'type':'admin_edit', 'text': f"الأدمن '{session.get('name')}' عدل محفظة '{user_name}'", 'timestamp': int(time.time())})
    return jsonify(success=True)

@bp.route('/update_purchased_attempts', methods=['POST'])
@admin_required
def update_purchased_attempts():
    user_id = request.form.get('user_id')
    if not user_id: return jsonify(success=False, message="User ID is required."), 400
    try:
        attempts = _to_int(request.form.get('attempts'))
        if attempts < 0: return jsonify(success=False, message="عدد المحاولات لا يمكن أن يكون سالباً."), 400
        db.reference(f'user_spin_state/{user_id}/purchasedAttempts').set(attempts)
        user_name = (db.reference(f'registered_users/{user_id}/name').get() or 'مستخدم')
        db.reference('activity_log').push({'type':'admin_edit', 'text': f"الأدمن '{session.get('name')}' عدل المحاولات المشتراة لـ '{user_name}' إلى {attempts}.", 'timestamp': int(time.time())})
        return jsonify(success=True)
    except (ValueError, TypeError): return jsonify(success=False, message="عدد المحاولات يجب أن يكون رقماً صحيحاً."), 400

@bp.route('/settings/spin_wheel', methods=['POST'])
@admin_required
def save_spin_wheel_settings():
    data = request.get_json()
    if not data: return jsonify(success=False, message="No data received."), 400
    try:
        settings = {"enabled": bool(data.get('enabled')), "cooldownHours": _to_int(data.get('cooldownHours')), "maxAttempts": _to_int(data.get('maxAttempts')), "maxAccumulation": _to_int(data.get('maxAccumulation')), "purchaseLimit": _to_int(data.get('purchaseLimit')), "prizes": [{"value": _to_int(p['value']), "weight": _to_float(p['weight'])} for p in data.get('prizes', []) if p.get('value') and p.get('weight')]}
        db.reference('site_settings/spin_wheel_settings').set(settings)
        return jsonify(success=True)
    except (ValueError, TypeError): return jsonify(success=False, message="بيانات غير صالحة."), 400

@bp.route('/settings/gambling', methods=['POST'])
@admin_required
def save_gambling_settings():
    data = request.get_json()
    if not data: return jsonify(success=False, message="لم يتم استلام أي بيانات."), 400
    try:
        settings = {'is_enabled': bool(data.get('is_enabled')),'max_bet': _to_int(data.get('max_bet')),'win_chance_percent': _to_float(data.get('win_chance_percent'))}
        if not (0 <= settings['win_chance_percent'] <= 100): raise ValueError("نسبة الربح يجب أن تكون بين 0 و 100.")
        if settings['max_bet'] < 0: raise ValueError("الحد الأعلى للرهان لا يمكن أن يكون سالباً.")
        db.reference('site_settings/gambling_settings').set(settings)
        return jsonify(success=True, message="تم حفظ إعدادات الرهان بنجاح!")
    except (ValueError, TypeError) as e: return jsonify(success=False, message=f"بيانات غير صالحة: {e}"), 400
    except Exception as e:
        print(f"!!! Save Gambling Settings Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500

@bp.route('/settings/contest', methods=['POST'])
@admin_required
def save_contest_settings():
    data = request.get_json()
    if not data: return jsonify(success=False, message="لم يتم استلام أي بيانات."), 400
    try:
        is_enabled = bool(data.get('is_enabled'))
        winner_points = _to_int(data.get('winner_points_reward'))
        voter_sp = _to_int(data.get('voter_sp_reward'))
        multiplier_boost = _to_float(data.get('multiplier_boost', 0.2))
        if winner_points < 0 or voter_sp < 0 or multiplier_boost < 0: raise ValueError("لا يمكن أن تكون القيم سالبة.")
        settings = {'is_enabled': is_enabled,'winner_points_reward': winner_points,'voter_sp_reward': voter_sp, 'multiplier_boost': multiplier_boost}
        db.reference('site_settings/contest_settings').set(settings)
        return jsonify(success=True, message="تم حفظ إعدادات المنافسة بنجاح!")
    except (ValueError, TypeError) as e: return jsonify(success=False, message=f"بيانات غير صالحة. {e}"), 400
    except Exception as e:
        print(f"!!! Save Contest Settings Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500

@bp.route('/shop/add_product', methods=['POST'])
@admin_required
def add_product():
    try:
        sp = _to_int(request.form.get('sp_amount')); cc = _to_int(request.form.get('cc_price'))
        if sp <= 0 or cc <= 0: raise ValueError
        db.reference('site_settings/shop_products').push({'sp_amount': sp, 'cc_price': cc}); return jsonify(success=True)
    except (ValueError, TypeError): return jsonify(success=False, message="الكميات والأسعار يجب أن تكون أرقاماً موجبة."), 400

@bp.route('/shop/delete_product/<pid>', methods=['POST'])
@admin_required
def delete_product(pid):
    if pid: db.reference(f'site_settings/shop_products/{pid}').delete(); return jsonify(success=True)

@bp.route('/shop/add_spin_product', methods=['POST'])
@admin_required
def add_spin_product():
    try:
        att = _to_int(request.form.get('attempts_amount')); sp = _to_int(request.form.get('sp_price'))
        if att <= 0 or sp <= 0: raise ValueError
        db.reference('site_settings/shop_products_spins').push({'attempts_amount': att, 'sp_price': sp}); return jsonify(success=True)
    except (ValueError, TypeError): return jsonify(success=False, message="الكميات والأسعار يجب أن تكون أرقاماً موجبة."), 400

@bp.route('/shop/delete_spin_product/<pid>', methods=['POST'])
@admin_required
def delete_spin_product(pid):
    if pid: db.reference(f'site_settings/shop_products_spins/{pid}').delete(); return jsonify(success=True)

@bp.route('/shop/add_points_product', methods=['POST'])
@admin_required
def add_points_product():
    try:
        prod = {"type": request.form.get('type'), "points_amount": _to_int(request.form.get('points_amount')), "sp_price": _to_int(request.form.get('sp_price')), "daily_limit": _to_int(request.form.get('daily_limit'), 1)}
        if not prod["type"] or prod["points_amount"] <= 0 or prod["sp_price"] <= 0 or prod["daily_limit"] <= 0: raise ValueError
        db.reference('site_settings/shop_products_points').push(prod); return jsonify(success=True)
    except (ValueError, TypeError): return jsonify(success=False, message="بيانات المنتج غير صالحة."), 400

@bp.route('/shop/delete_points_product/<pid>', methods=['POST'])
@admin_required
def delete_points_product(pid):
    if pid: db.reference(f'site_settings/shop_products_points/{pid}').delete(); return jsonify(success=True)

# <<< بداية التعديل: تطبيق الإصلاح على هذه الدالة >>>
@bp.route('/reset_all_free_spins', methods=['POST'])
@admin_required
def reset_all_free_spins():
    settings = db.reference('site_settings/spin_wheel_settings').get() or {}; atts = settings.get('maxAttempts', 1); now = int(time.time()); updates = {}
    users_approved = (db.reference('registered_users').order_by_child('status').equal_to('approved').get() or {})
    for uid in users_approved: 
        updates[f'user_spin_state/{uid}/freeAttempts'] = atts; 
        updates[f'user_spin_state/{uid}/lastFreeUpdateTimestamp'] = now
    if updates: 
        db.reference().update(updates) # استدعاء update على مرجع فارغ آمن
    return jsonify(success=True)
# <<< نهاية التعديل >>>

@bp.route('/shop/add_avatar', methods=['POST'])
@admin_required
def add_avatar():
    if 'avatar_file' not in request.files: return jsonify(success=False, message="ملف الصورة مطلوب."), 400
    file = request.files['avatar_file']
    name = request.form.get('avatar_name', '').strip()
    try:
        price_personal = _to_int(request.form.get('price_sp_personal'))
        price_gift = _to_int(request.form.get('price_sp_gift'))
    except (ValueError, TypeError): return jsonify(success=False, message="الأسعار يجب أن تكون أرقاماً صحيحة."), 400

    if not name or price_personal <= 0 or price_gift <= 0: return jsonify(success=False, message="اسم الأفاتار والأسعار الموجبة مطلوبة."), 400
    if file.filename == '': return jsonify(success=False, message="لم يتم اختيار ملف."), 400
    DRIVE_FOLDER_ID = os.getenv('GOOGLE_DRIVE_FOLDER_ID')
    if not DRIVE_FOLDER_ID: return jsonify(success=False, message="معرف مجلد Google Drive غير مهيأ في الخادم."), 500

    try:
        drive_service = _get_drive_service()
        file_metadata = {'name': f"{int(time.time())}_{file.filename}", 'parents': [DRIVE_FOLDER_ID]}
        media = MediaIoBaseUpload(io.BytesIO(file.read()), mimetype=file.content_type, resumable=True)
        uploaded_file = drive_service.files().create(body=file_metadata, media_body=media, fields='id').execute()
        file_id = uploaded_file.get('id')
        drive_service.permissions().create(fileId=file_id, body={'type': 'anyone', 'role': 'reader'}).execute()
        image_url = f'https://lh3.googleusercontent.com/d/{file_id}'
        new_avatar_ref = db.reference('site_settings/shop_avatars').push()
        new_avatar_ref.set({'name': name,'price_sp_personal': price_personal,'price_sp_gift': price_gift,'image_url': image_url,'storage_path': file_id,'added_at': int(time.time())})
        return jsonify(success=True, message=f"تمت إضافة أفاتار '{name}' بنجاح!")
    except Exception as e:
        error_type = type(e).__name__
        print(f"!!! Avatar Upload Error (Google Drive) [{error_type}]: {str(e)}", file=sys.stderr)
        return jsonify(success=False, message=f"فشل رفع الصورة. الخطأ: {error_type}"), 500

@bp.route('/shop/delete_avatar/<avatar_id>', methods=['POST'])
@admin_required
def delete_avatar(avatar_id):
    if not avatar_id: return jsonify(success=False, message="معرف الأفاتار مفقود."), 400
    avatar_ref = db.reference(f'site_settings/shop_avatars/{avatar_id}')
    avatar_data = avatar_ref.get()
    if not avatar_data: return jsonify(success=False, message="الأفاتار غير موجود."), 404
    try:
        drive_file_id = avatar_data.get('storage_path')
        if drive_file_id:
            drive_service = _get_drive_service()
            drive_service.files().delete(fileId=drive_file_id).execute()
        avatar_ref.delete()
        return jsonify(success=True, message="تم حذف الأفاتار بنجاح.")
    except Exception as e:
        error_type = type(e).__name__
        if 'HttpError 404' in str(e):
             avatar_ref.delete()
             return jsonify(success=True, message="تم حذف الأفاتار من قاعدة البيانات (لم يكن موجوداً في Drive).")
        print(f"!!! Avatar Deletion Error (Google Drive) [{error_type}]: {str(e)}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء الحذف من Google Drive."), 500

@bp.route('/user_avatar/remove', methods=['POST'])
@admin_required
def remove_user_avatar():
    user_id = request.form.get('user_id')
    avatar_id = request.form.get('avatar_id')
    if not all([user_id, avatar_id]): return jsonify(success=False, message="بيانات المستخدم والأفاتار مطلوبة."), 400
    try:
        avatar_ownership_ref = db.reference(f'user_avatars/{user_id}/owned/{avatar_id}')
        if avatar_ownership_ref.get() is None: return jsonify(success=False, message="المستخدم لا يمتلك هذا الأفاتار أصلاً."), 404
        avatar_ownership_ref.delete()
        user_name = (db.reference(f'registered_users/{user_id}/name').get() or 'مستخدم')
        avatar_name = (db.reference(f'site_settings/shop_avatars/{avatar_id}/name').get() or 'غير معروف')
        log_text = f"الأدمن '{session.get('name')}' أزال أفاتار '{avatar_name}' من المستخدم '{user_name}'."
        db.reference('activity_log').push({'type': 'admin_edit', 'text': log_text, 'timestamp': int(time.time())})
        return jsonify(success=True, message=f"تمت إزالة الأفاتار من {user_name} بنجاح.")
    except Exception as e:
        print(f"!!! Remove User Avatar Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم."), 500

@bp.route('/gift_request/<request_id>/<action>', methods=['POST'])
@admin_required
def handle_gift_request(request_id, action):
    if action not in ['approve', 'reject']: return jsonify(success=False, message="إجراء غير صالح."), 400
    request_ref = db.reference(f'gift_requests/{request_id}')
    gift_request = request_ref.get()
    if not gift_request or gift_request.get('status') != 'pending': return jsonify(success=False, message="الطلب غير موجود أو تمت معالجته بالفعل."), 404
    if action == 'reject': request_ref.update({'status': 'rejected', 'processed_by': session.get('name')}); return jsonify(success=True, message="تم رفض الطلب بنجاح.")
    try:
        gifter_id, target_name, avatar_id, avatar_url, price_sp = gift_request.get('gifter_id'), gift_request.get('target_user_name'), gift_request.get('avatar_id'), gift_request.get('avatar_image_url'), gift_request.get('price_sp', 0)
        if not all([gifter_id, target_name, avatar_id, avatar_url]): raise ValueError("بيانات طلب الإهداء غير مكتملة.")
        gifter_wallet_ref = db.reference(f'wallets/{gifter_id}/sp')
        if gifter_wallet_ref.transaction(lambda current_sp: (current_sp or 0) - price_sp if (current_sp or 0) >= price_sp else None) is None:
             request_ref.update({'status': 'failed', 'reason': 'رصيد غير كافٍ', 'processed_by': session.get('name')}); return jsonify(success=False, message="فشلت الموافقة: رصيد المُهدي غير كافٍ."), 400
        db.reference(f'users/{target_name}').update({'avatar_url': avatar_url})
        registered_user_query = db.reference('registered_users').order_by_child('name').equal_to(target_name).get()
        if registered_user_query:
            target_user_id = list(registered_user_query.keys())[0]
            db.reference(f'registered_users/{target_user_id}').update({'current_avatar': avatar_url})
        request_ref.update({'status': 'approved', 'processed_by': session.get('name')})
        log_text = f"الأدمن '{session.get('name')}' وافق على طلب إهداء أفاتار '{gift_request.get('avatar_name')}' إلى الزاحف '{target_name}'."
        db.reference('activity_log').push({'type': 'gift', 'text': log_text, 'timestamp': int(time.time())})
        return jsonify(success=True, message="تمت الموافقة على الطلب وتعيين الأفاتار للزاحف بنجاح.")
    except Exception as e:
        request_ref.update({'status': 'failed', 'reason': str(e), 'processed_by': session.get('name')})
        print(f"!!! Handle Gift Request Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء معالجة الطلب."), 500

@bp.route('/settings/investment', methods=['POST'])
@admin_required
def save_investment_settings():
    data = request.get_json()
    if not data: return jsonify(success=False, message="No data received."), 400
    try:
        settings = {
            'max_investments': _to_int(data.get('max_investments')),
            'investment_lock_hours': _to_int(data.get('investment_lock_hours')),
            'sell_tax_percent': _to_float(data.get('sell_tax_percent')),
            'sell_fee_sp': _to_float(data.get('sell_fee_sp')),
            'withdrawal_approval_limit': _to_int(data.get('withdrawal_approval_limit'), 500000)
        }
        if any(v < 0 for v in settings.values()): raise ValueError("Values cannot be negative.")
        if not (0 <= settings['sell_tax_percent'] <= 100): raise ValueError("Sell tax must be between 0 and 100.")
        db.reference('site_settings/investment_settings').set(settings)
        return jsonify(success=True)
    except (ValueError, TypeError) as e: return jsonify(success=False, message=f"بيانات غير صالحة: {e}"), 400
    except Exception as e:
        print(f"!!! Save Investment Settings Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500

@bp.route('/shop/edit_product/<pid>', methods=['POST'])
@admin_required
def edit_product(pid):
    if not pid: return jsonify(success=False, message="معرف المنتج مفقود."), 400
    try:
        sp = _to_int(request.form.get('sp_amount')); cc = _to_int(request.form.get('cc_price'))
        if sp <= 0 or cc <= 0: raise ValueError
        db.reference(f'site_settings/shop_products/{pid}').update({'sp_amount': sp, 'cc_price': cc}); return jsonify(success=True)
    except (ValueError, TypeError): return jsonify(success=False, message="الكميات والأسعار يجب أن تكون أرقاماً موجبة."), 400

@bp.route('/shop/edit_spin_product/<pid>', methods=['POST'])
@admin_required
def edit_spin_product(pid):
    if not pid: return jsonify(success=False, message="معرف المنتج مفقود."), 400
    try:
        att = _to_int(request.form.get('attempts_amount')); sp = _to_int(request.form.get('sp_price'))
        if att <= 0 or sp <= 0: raise ValueError
        db.reference(f'site_settings/shop_products_spins/{pid}').update({'attempts_amount': att, 'sp_price': sp}); return jsonify(success=True)
    except (ValueError, TypeError): return jsonify(success=False, message="الكميات والأسعار يجب أن تكون أرقاماً موجبة."), 400

@bp.route('/shop/edit_points_product/<pid>', methods=['POST'])
@admin_required
def edit_points_product(pid):
    if not pid: return jsonify(success=False, message="معرف المنتج مفقود."), 400
    try:
        updates = {"points_amount": _to_int(request.form.get('points_amount')), "sp_price": _to_int(request.form.get('sp_price')), "daily_limit": _to_int(request.form.get('daily_limit'))}
        if updates["points_amount"] <= 0 or updates["sp_price"] <= 0 or updates["daily_limit"] <= 0: raise ValueError
        db.reference(f'site_settings/shop_products_points/{pid}').update(updates); return jsonify(success=True)
    except (ValueError, TypeError): return jsonify(success=False, message="بيانات المنتج غير صالحة."), 400

@bp.route('/shop/edit_avatar/<pid>', methods=['POST'])
@admin_required
def edit_avatar(pid):
    if not pid: return jsonify(success=False, message="معرف الأفاتار مفقود."), 400
    try:
        name = request.form.get('avatar_name').strip()
        price_personal = _to_int(request.form.get('price_sp_personal'))
        price_gift = _to_int(request.form.get('price_sp_gift'))
        if not name or price_personal <= 0 or price_gift <= 0: raise ValueError
        db.reference(f'site_settings/shop_avatars/{pid}').update({'name': name, 'price_sp_personal': price_personal, 'price_sp_gift': price_gift})
        return jsonify(success=True)
    except (ValueError, TypeError): return jsonify(success=False, message="بيانات الأفاتار غير صالحة."), 400

@bp.route('/shop/add_nudge', methods=['POST'])
@admin_required
def add_nudge():
    try:
        text = request.form.get('nudge_text', '').strip()
        sp_price = _to_int(request.form.get('sp_price'))
        if not text or sp_price <= 0: raise ValueError
        db.reference('site_settings/shop_products_nudges').push({'text': text,'sp_price': sp_price})
        return jsonify(success=True)
    except (ValueError, TypeError): return jsonify(success=False, message="نص النكزة والسعر الموجب مطلوبان."), 400

@bp.route('/shop/edit_nudge/<pid>', methods=['POST'])
@admin_required
def edit_nudge(pid):
    if not pid: return jsonify(success=False, message="معرف المنتج مفقود."), 400
    try:
        text = request.form.get('nudge_text', '').strip()
        sp_price = _to_int(request.form.get('sp_price'))
        if not text or sp_price <= 0: raise ValueError
        db.reference(f'site_settings/shop_products_nudges/{pid}').update({'text': text,'sp_price': sp_price})
        return jsonify(success=True)
    except (ValueError, TypeError): return jsonify(success=False, message="بيانات المنتج غير صالحة."), 400

@bp.route('/shop/delete_nudge/<pid>', methods=['POST'])
@admin_required
def delete_nudge(pid):
    if pid:
        db.reference(f'site_settings/shop_products_nudges/{pid}').delete()
        return jsonify(success=True)
    return jsonify(success=False, message="معرف المنتج مفقود."), 400

@bp.route('/user_nudge/toggle', methods=['POST'])
@admin_required
def toggle_user_nudge():
    try:
        user_id, nudge_id, action = request.form.get('user_id'), request.form.get('nudge_id'), request.form.get('action')
        if not all([user_id, nudge_id, action]): return jsonify(success=False, message="بيانات ناقصة."), 400
        user_nudge_ref = db.reference(f'user_nudges/{user_id}/owned/{nudge_id}')
        if action == 'grant': user_nudge_ref.set({'granted_at': int(time.time())})
        elif action == 'revoke': user_nudge_ref.delete()
        else: return jsonify(success=False, message="إجراء غير معروف."), 400
        return jsonify(success=True)
    except Exception as e:
        print(f"!!! Toggle User Nudge Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500

@bp.route('/update_personal_multiplier', methods=['POST'])
@admin_required
def update_personal_multiplier():
    try:
        investor_id, crawler_name, multiplier_str = request.form.get('user_id'), request.form.get('crawler_name'), request.form.get('multiplier')
        if not all([investor_id, crawler_name, multiplier_str]): return jsonify(success=False, message="بيانات ناقصة."), 400
        multiplier = _to_float(multiplier_str)
        investment_ref = db.reference(f'investments/{investor_id}/{crawler_name}')
        if not investment_ref.get(): return jsonify(success=False, message="هذا المستخدم ليس لديه استثمار في هذا الزاحف."), 404
        updates = {'personal_multiplier': multiplier,'manual_override': True,'last_manual_update': int(time.time())}
        investment_ref.update(updates)
        investor_name = (db.reference(f'registered_users/{investor_id}/name').get() or 'مستخدم')
        log_text = (f"الأدمن '{session.get('name')}' عدّل مضاعف الربح الشخصي للمستثمر '{investor_name}' في الزاحف '{crawler_name}' إلى {multiplier:.2f}x.")
        db.reference('activity_log').push({'type': 'admin_edit', 'text': log_text, 'timestamp': int(time.time())})
        return jsonify(success=True, message="تم تحديث المضاعف الشخصي بنجاح.")
    except (ValueError, TypeError): return jsonify(success=False, message="قيمة المضاعف غير صالحة."), 400
    except Exception as e:
        print(f"!!! Update Personal Multiplier Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500

@bp.route('/set_special_multiplier', methods=['POST'])
@admin_required
def set_special_multiplier():
    try:
        data = request.get_json()
        investor_id, crawler_name, action = data.get('user_id'), data.get('crawler_name'), data.get('action')
        if not all([investor_id, crawler_name, action]): return jsonify(success=False, message="بيانات ناقصة."), 400
        investment_ref, crawler_data = db.reference(f'investments/{investor_id}/{crawler_name}'), db.reference(f'users/{crawler_name}').get()
        investment_data = investment_ref.get()
        if not investment_data or not crawler_data: return jsonify(success=False, message="بيانات الاستثمار أو الزاحف غير موجودة."), 404
        new_multiplier = 1.0
        if action == 'reset_to_normal': new_multiplier = 1.0
        elif action == 'total_loss': new_multiplier = 0.0
        elif action == 'invert_profit': new_multiplier = -1.0
        elif action == 'reset_profit':
            points_now, stock_multiplier, total_invested_sp, weighted_market_factor_sum = _to_float(max(1, crawler_data.get('points', 1))), _to_float(crawler_data.get('stock_multiplier', 1.0)), 0, 0
            lots = investment_data.get('lots', {})
            if not lots: new_multiplier = 1.0
            else:
                for lot in lots.values():
                    sp, points_then = _to_float(lot.get('sp', 0)), _to_float(max(1, lot.get('p', 1)))
                    market_factor = (points_now / points_then) * stock_multiplier
                    total_invested_sp += sp; weighted_market_factor_sum += sp * market_factor
                new_multiplier = total_invested_sp / weighted_market_factor_sum if total_invested_sp > 0 and weighted_market_factor_sum > 0 else 1.0
        investment_ref.update({'personal_multiplier': new_multiplier}); return jsonify(success=True, new_multiplier=new_multiplier)
    except Exception as e:
        print(f"!!! Set Special Multiplier Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500

@bp.route('/settings/stock_prediction_game', methods=['POST'])
@admin_required
def save_stock_prediction_game_settings():
    data = request.get_json()
    if not data: return jsonify(success=False, message="لم يتم استلام أي بيانات."), 400
    try:
        settings = {'is_enabled': bool(data.get('is_enabled')),'max_bet': _to_int(data.get('max_bet')),'win_chance_percent': _to_float(data.get('win_chance_percent'))}
        if not (0 <= settings['win_chance_percent'] <= 100) or settings['max_bet'] < 0: raise ValueError("قيم الإعدادات غير صالحة.")
        db.reference('site_settings/stock_prediction_game').set(settings)
        return jsonify(success=True, message="تم حفظ إعدادات اللعبة بنجاح!")
    except (ValueError, TypeError) as e: return jsonify(success=False, message=f"بيانات غير صالحة: {e}"), 400
    except Exception as e:
        print(f"!!! Save Stock Prediction Settings Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500

@bp.route('/settings/rps_game', methods=['POST'])
@admin_required
def save_rps_game_settings():
    data = request.get_json()
    if not data: return jsonify(success=False, message="لم يتم استلام أي بيانات."), 400
    try:
        settings = {'is_enabled': bool(data.get('is_enabled')),'max_bet': _to_int(data.get('max_bet')),'cooldown_seconds': _to_int(data.get('cooldown_seconds'), 60)}
        if settings['max_bet'] < 0 or settings['cooldown_seconds'] < 0: raise ValueError("القيم لا يمكن أن تكون سالبة.")
        db.reference('site_settings/rps_game').update(settings)
        return jsonify(success=True, message="تم حفظ إعدادات اللعبة بنجاح!")
    except (ValueError, TypeError) as e: return jsonify(success=False, message=f"بيانات غير صالحة: {e}"), 400
    except Exception as e:
        print(f"!!! Save RPS Game Settings Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500

@bp.route('/user_investments/<user_id>', methods=['GET'])
@admin_required
def get_user_investments(user_id):
    if not user_id: return jsonify(success=False, message="معرف المستخدم مطلوب."), 400
    try:
        investments = (db.reference(f'investments/{user_id}').get() or {})
        return jsonify(success=True, investments=investments)
    except Exception as e:
        print(f"!!! Get User Investments Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم أثناء جلب البيانات."), 500

@bp.route('/delete_investment_lot', methods=['POST'])
@admin_required
def delete_investment_lot():
    user_id, crawler_name, lot_id = request.form.get('user_id'), request.form.get('crawler_name'), request.form.get('lot_id')
    if not all([user_id, crawler_name, lot_id]): return jsonify(success=False, message="بيانات غير مكتملة لحذف دفعة الاستثمار."), 400
    lot_ref = db.reference(f'investments/{user_id}/{crawler_name}/lots/{lot_id}')
    if lot_ref.get() is None: return jsonify(success=False, message="دفعة الاستثمار هذه غير موجودة بالفعل."), 404
    try:
        lot_ref.delete()
        if not db.reference(f'investments/{user_id}/{crawler_name}/lots').get():
            db.reference(f'investments/{user_id}/{crawler_name}').delete()
        admin_name = session.get('name', 'Admin')
        user_name = (db.reference(f'registered_users/{user_id}/name').get() or 'مستخدم')
        log_text = f"الأدمن '{admin_name}' حذف دفعة استثمار للمستخدم '{user_name}' في الزاحف '{crawler_name}'."
        db.reference('activity_log').push({'type': 'admin_edit', 'text': log_text, 'timestamp': int(time.time())})
        return jsonify(success=True, message="تم حذف دفعة الاستثمار بنجاح.")
    except Exception as e:
        print(f"!!! Delete Investment Lot Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم أثناء الحذف."), 500

@bp.route('/force_sell_all_lots', methods=['POST'])
@admin_required
def force_sell_all_lots():
    try:
        data = request.get_json()
        investor_id, crawler_name = data.get('user_id'), data.get('crawler_name')
        if not all([investor_id, crawler_name]): return jsonify(success=False, message="بيانات ناقصة."), 400
        investment_ref, crawler_data = db.reference(f'investments/{investor_id}/{crawler_name}'), db.reference(f'users/{crawler_name}').get()
        investment_data = investment_ref.get()
        if not investment_data or not crawler_data: return jsonify(success=False, message="لا يوجد استثمار لهذا المستخدم في هذا الزاحف."), 404
        lots = investment_data.get('lots', {})
        if not lots: return jsonify(success=False, message="لا توجد دفعات استثمار لبيعها."), 404
        settings = db.reference('site_settings/investment_settings').get() or {}
        sell_tax_percent, sell_fee_sp = settings.get('sell_tax_percent', 0.0), settings.get('sell_fee_sp', 0.0)
        current_points, stock_multiplier, personal_multiplier = _to_float(max(1, crawler_data.get('points', 1))), _to_float(crawler_data.get('stock_multiplier', 1.0)), _to_float(investment_data.get('personal_multiplier', 1.0))
        total_sp_to_return = 0
        for lot_data in lots.values():
            invested_sp, points_at_inv = _to_float(lot_data.get('sp', 0)), _to_float(max(1, lot_data.get('p', 1)))
            value_of_lot = invested_sp * (current_points / points_at_inv) * stock_multiplier * personal_multiplier
            profit = value_of_lot - invested_sp
            tax_amount = max(0, profit * (sell_tax_percent / 100.0))
            total_sp_to_return += value_of_lot - tax_amount
        total_sp_to_return -= sell_fee_sp
        db.reference(f'wallets/{investor_id}/sp').transaction(lambda current: (current or 0) + total_sp_to_return)
        investment_ref.delete()
        admin_name, investor_name = session.get('name', 'Admin'), (db.reference(f'registered_users/{investor_id}/name').get() or 'مستخدم')
        log_text = f"الأدمن '{admin_name}' قام بتصفية استثمارات '{investor_name}' في '{crawler_name}' بقيمة {total_sp_to_return:,.2f} SP."
        db.reference('activity_log').push({'type': 'admin_edit', 'text': log_text, 'timestamp': int(time.time())})
        db.reference(f'user_messages/{investor_id}').push({'text': f"تمت تصفية استثماراتك في '{crawler_name}'. تم إضافة/خصم {total_sp_to_return:,.2f} SP إلى/من محفظتك.",'timestamp': int(time.time())})
        return jsonify(success=True, message=f"تمت تصفية جميع استثمارات {investor_name} في {crawler_name} بنجاح.")
    except Exception as e:
        print(f"!!! Force Sell All Lots Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500

@bp.route('/handle_withdrawal_request/<request_id>/<action>', methods=['POST'])
@admin_required
def handle_withdrawal_request(request_id, action):
    if action not in ['approve', 'reject']: return jsonify(success=False, message="إجراء غير صالح."), 400
    req_ref, request_data = db.reference(f'withdrawal_requests/{request_id}'), req_ref.get()
    if not request_data or request_data.get('status') != 'pending': return jsonify(success=False, message="الطلب غير موجود أو تمت معالجته بالفعل."), 404
    user_id = request_data.get('user_id')
    if action == 'reject':
        try:
            db.reference(f"investments/{user_id}/{request_data['crawler_name']}/lots/{request_data['lot_id']}").set(request_data['lot_data'])
            req_ref.update({'status': 'rejected', 'processed_by': session.get('name')})
            db.reference(f'user_messages/{user_id}').push({'text': f"تم رفض طلب سحب الأرباح الخاص بك من استثمار '{request_data['crawler_name']}'.", 'timestamp': int(time.time())})
            return jsonify(success=True, message="تم رفض طلب السحب بنجاح.")
        except Exception as e: return jsonify(success=False, message=f"خطأ في الخادم: {e}"), 500
    try:
        settings = db.reference('site_settings/investment_settings').get() or {}
        sell_tax_percent, sell_fee_sp = settings.get('sell_tax_percent', 0.0), settings.get('sell_fee_sp', 0.0)
        value_of_lot_before_tax, invested_sp = _to_float(request_data.get('amount_to_withdraw')), _to_float(request_data.get('lot_data', {}).get('sp', 0))
        profit = value_of_lot_before_tax - invested_sp
        tax_amount = max(0, profit * (sell_tax_percent / 100.0))
        final_sp_to_return = max(0, value_of_lot_before_tax - tax_amount - sell_fee_sp)
        db.reference(f'wallets/{user_id}/sp').transaction(lambda current: (current or 0) + final_sp_to_return)
        req_ref.update({'status': 'approved', 'processed_by': session.get('name')})
        db.reference(f'user_messages/{user_id}').push({'text': f"تمت الموافقة على طلب سحب الأرباح الخاص بك! تم إضافة {final_sp_to_return:,.2f} SP إلى محفظتك.", 'timestamp': int(time.time())})
        db.reference('investment_log').push({'investor_id': user_id, 'investor_name': request_data.get('user_name'), 'target_name': request_data.get('crawler_name'), 'action': 'sell', 'sp_amount': final_sp_to_return, 'timestamp': int(time.time())})
        return jsonify(success=True, message="تمت الموافقة على الطلب بنجاح.")
    except Exception as e: return jsonify(success=False, message=f"خطأ في الخادم: {e}"), 500

@bp.route('/settings/market_governor', methods=['POST'])
@admin_required
def save_governor_settings():
    data = request.get_json()
    if not data: return jsonify(success=False, message="No data received."), 400
    try:
        milestones_str = data.get('diversify_milestones', '')
        milestones = [_to_int(x.strip()) for x in milestones_str.split(',') if x.strip()]
        interval_hours, interval_minutes, interval_seconds = _to_int(data.get('interval_hours')), _to_int(data.get('interval_minutes')), _to_int(data.get('interval_seconds'))
        total_seconds = (interval_hours * 3600) + (interval_minutes * 60) + interval_seconds
        if total_seconds < 10: return jsonify(success=False, message="أقل تردد مسموح به هو 10 ثوانٍ."), 400
        volatility_data = data.get('market_volatility', {})
        settings = { 'enabled': bool(data.get('enabled')), 'interval_hours': interval_hours, 'interval_minutes': interval_minutes, 'interval_seconds': interval_seconds, 'market_volatility': { 'enabled': bool(volatility_data.get('enabled')), **{k: _to_float(v) for k, v in volatility_data.items() if k != 'enabled'} }, 'balance_profit_threshold': _to_int(data.get('balance_profit_threshold')), 'balance_value_threshold': _to_int(data.get('balance_value_threshold')), 'rescue_wallet_threshold': _to_int(data.get('rescue_wallet_threshold')), 'rescue_loss_threshold': _to_int(data.get('rescue_loss_threshold')), 'jackpot_chance_percent': _to_float(data.get('jackpot_chance_percent')), 'jackpot_multiplier': _to_float(data.get('jackpot_multiplier')), 'deal_bonus_enabled': bool(data.get('deal_bonus_enabled')), 'underdog_rank_threshold': _to_int(data.get('underdog_rank_threshold')), 'underdog_bonus_percent': _to_float(data.get('underdog_bonus_percent')), 'diversify_milestones': milestones, 'diversify_bonus_percent': _to_float(data.get('diversify_bonus_percent')), 'instant_bonus_enabled': bool(data.get('instant_bonus_enabled')), 'instant_win_chance': _to_float(data.get('instant_win_chance')), 'instant_loss_chance': _to_float(data.get('instant_loss_chance')), 'instant_neutral_chance': _to_float(data.get('instant_neutral_chance')), 'instant_win_max_percent': _to_float(data.get('instant_win_max_percent')), 'instant_loss_max_percent': _to_float(data.get('instant_loss_max_percent')) }
        db.reference('site_settings/market_governor').set(settings)
        if scheduler.get_job('market_justice_job'):
            scheduler.remove_job('market_justice_job')
            print(">> Removed old 'market_justice_job'.")
        scheduler.add_job(id='market_justice_job',func=scheduled_tasks.automated_market_balance,trigger='interval',seconds=total_seconds,args=[current_app._get_current_object()])
        print(f">> Rescheduled 'market_justice_job' to run every {total_seconds} seconds.")
        return jsonify(success=True, message="تم حفظ الإعدادات وإعادة جدولة المهمة بنجاح.")
    except Exception as e:
        print(f"!!! Save Governor Settings Error (General): {e}", file=sys.stderr)
        return jsonify(success=False, message=f"خطأ في الخادم: {e}"), 500

# --- END OF FILE project/admin_api.py ---
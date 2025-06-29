import time
import sys
import os
import io
from flask import Blueprint, request, jsonify, session
from firebase_admin import db, auth
from .utils import admin_required

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

bp = Blueprint('admin_api', __name__)

def _get_drive_service():
    SERVICE_ACCOUNT_FILE = os.getenv('FIREBASE_SERVICE_ACCOUNT')
    SCOPES = ['https://www.googleapis.com/auth/drive']
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    service = build('drive', 'v3', credentials=creds)
    return service

@bp.route('/add_user', methods=['POST'])
@admin_required
def add_user():
    try:
        name = request.form.get('name', '').strip()
        points_str = request.form.get('points', '0')
        stock_trend_str = request.form.get('stock_trend')
        avatar_url = request.form.get('avatar_url', '') 
        original_name = request.form.get('original_name', '').strip()

        if not name: return jsonify(success=False, message="اسم الزاحف مطلوب."), 400
        points = int(points_str)
        stock_trend = float(stock_trend_str) if stock_trend_str else 0.0
        
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
            'stock_trend': stock_trend,
            'avatar_url': avatar_url
        })
        
        if 'stock_multiplier' not in user_data:
            user_data['stock_multiplier'] = 1.0
        if 'likes' not in user_data: user_data['likes'] = 0

        ref_users.child(name).set(user_data)
        
        db.reference(f'points_history/{name}').push({'points': points, 'timestamp': int(time.time())})
        return jsonify(success=True)
        
    except (ValueError, TypeError):
        return jsonify(success=False, message="النقاط واتجاه السهم يجب أن تكون أرقاماً صالحة."), 400
    except Exception as e:
        print(f"!!! Add/Edit User Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500

@bp.route('/market/update_trends', methods=['POST'])
@admin_required
def update_market_trends():
    try:
        users_ref = db.reference('users')
        all_users = users_ref.get()
        if not all_users:
            return jsonify(success=False, message="لا يوجد زواحف لتحديثهم."), 404

        updates = {}
        updated_crawlers_count = 0
        now = int(time.time())

        for name, data in all_users.items():
            if isinstance(data, dict):
                trend = data.get('stock_trend', 0.0)
                
                if trend != 0:
                    current_multiplier = float(data.get('stock_multiplier', 1.0))
                    new_multiplier = current_multiplier + (trend / 100.0)
                    
                    updates[f'users/{name}/stock_multiplier'] = max(0, new_multiplier)
                    updated_crawlers_count += 1

                if data.get('stock_trend') is not None and data.get('stock_trend') != 0:
                    updates[f'users/{name}/stock_trend'] = 0
        
        if updates:
            db.reference().update(updates)
        
        log_text = f"الأدمن '{session.get('name')}' قام بتحديث السوق. تم تعديل مُضاعِف أسهم {updated_crawlers_count} زاحف."
        db.reference('activity_log').push({'type': 'admin_edit', 'text': log_text, 'timestamp': now})
        
        return jsonify(success=True, message=f"تم تحديث السوق بنجاح. تم تعديل مُضاعِف أسهم {updated_crawlers_count} زاحف.")

    except Exception as e:
        print(f"!!! Market Update Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ أثناء تحديث السوق."), 500

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
    if name: db.reference(f'users/{name}').set({'name': name, 'points': 0, 'likes': 0, 'stock_trend': 0, 'stock_multiplier': 1.0}); db.reference(f'candidates/{name}').delete()
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
    try: new_cc = int(request.form.get('cc', 0)); new_sp = float(request.form.get('sp', 0))
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
        attempts = int(request.form.get('attempts', 0))
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
        settings = {"enabled": bool(data.get('enabled')), "cooldownHours": int(data.get('cooldownHours')), "maxAttempts": int(data.get('maxAttempts')), "maxAccumulation": int(data.get('maxAccumulation')), "purchaseLimit": int(data.get('purchaseLimit')), "prizes": [{"value": int(p['value']), "weight": float(p['weight'])} for p in data.get('prizes', []) if p.get('value') and p.get('weight')]}
        db.reference('site_settings/spin_wheel_settings').set(settings)
        return jsonify(success=True)
    except (ValueError, TypeError): return jsonify(success=False, message="بيانات غير صالحة."), 400

# <<< بداية التعديل >>>
@bp.route('/settings/contest', methods=['POST'])
@admin_required
def save_contest_settings():
    data = request.get_json()
    if not data:
        return jsonify(success=False, message="لم يتم استلام أي بيانات."), 400
    
    try:
        is_enabled = bool(data.get('is_enabled'))
        winner_points = int(data.get('winner_points_reward'))
        voter_sp = int(data.get('voter_sp_reward'))

        if winner_points < 0 or voter_sp < 0:
            raise ValueError("لا يمكن أن تكون الجوائز سالبة.")

        settings = {
            'is_enabled': is_enabled,
            'winner_points_reward': winner_points,
            'voter_sp_reward': voter_sp
        }

        db.reference('site_settings/contest_settings').set(settings)
        return jsonify(success=True, message="تم حفظ إعدادات المنافسة بنجاح!")

    except (ValueError, TypeError) as e:
        return jsonify(success=False, message=f"بيانات غير صالحة. {e}"), 400
    except Exception as e:
        print(f"!!! Save Contest Settings Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500
# <<< نهاية التعديل >>>

@bp.route('/shop/add_product', methods=['POST'])
@admin_required
def add_product():
    try:
        sp = int(request.form.get('sp_amount')); cc = int(request.form.get('cc_price'))
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
        att = int(request.form.get('attempts_amount')); sp = int(request.form.get('sp_price'))
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
        prod = {"type": request.form.get('type'), "points_amount": int(request.form.get('points_amount')), "sp_price": int(request.form.get('sp_price')), "daily_limit": int(request.form.get('daily_limit', 1))}
        if not prod["type"] or prod["points_amount"] <= 0 or prod["sp_price"] <= 0 or prod["daily_limit"] <= 0: raise ValueError
        db.reference('site_settings/shop_products_points').push(prod); return jsonify(success=True)
    except (ValueError, TypeError): return jsonify(success=False, message="بيانات المنتج غير صالحة."), 400

@bp.route('/shop/delete_points_product/<pid>', methods=['POST'])
@admin_required
def delete_points_product(pid):
    if pid: db.reference(f'site_settings/shop_products_points/{pid}').delete(); return jsonify(success=True)

@bp.route('/reset_all_free_spins', methods=['POST'])
@admin_required
def reset_all_free_spins():
    settings = db.reference('site_settings/spin_wheel_settings').get() or {}; atts = settings.get('maxAttempts', 1); now = int(time.time()); updates = {}
    users_approved = (db.reference('registered_users').order_by_child('status').equal_to('approved').get() or {})
    for uid in users_approved: updates[f'user_spin_state/{uid}/freeAttempts'] = atts; updates[f'user_spin_state/{uid}/lastFreeUpdateTimestamp'] = now
    if updates: db.reference('/').update(updates)
    return jsonify(success=True)

@bp.route('/shop/add_avatar', methods=['POST'])
@admin_required
def add_avatar():
    if 'avatar_file' not in request.files: return jsonify(success=False, message="ملف الصورة مطلوب."), 400
    file = request.files['avatar_file']
    name = request.form.get('avatar_name', '').strip()
    try:
        price_personal = int(request.form.get('price_sp_personal', 0))
        price_gift = int(request.form.get('price_sp_gift', 0))
    except (ValueError, TypeError):
        return jsonify(success=False, message="الأسعار يجب أن تكون أرقاماً صحيحة."), 400

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
        new_avatar_ref.set({
            'name': name,
            'price_sp_personal': price_personal,
            'price_sp_gift': price_gift,
            'image_url': image_url,
            'storage_path': file_id,
            'added_at': int(time.time())
        })
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
    if action not in ['approve', 'reject']:
        return jsonify(success=False, message="إجراء غير صالح."), 400

    request_ref = db.reference(f'gift_requests/{request_id}')
    gift_request = request_ref.get()

    if not gift_request or gift_request.get('status') != 'pending':
        return jsonify(success=False, message="الطلب غير موجود أو تمت معالجته بالفعل."), 404
        
    if action == 'reject':
        request_ref.update({'status': 'rejected', 'processed_by': session.get('name')})
        return jsonify(success=True, message="تم رفض الطلب بنجاح.")
    
    try:
        gifter_id = gift_request.get('gifter_id')
        target_name = gift_request.get('target_user_name') 
        avatar_id = gift_request.get('avatar_id')
        avatar_url = gift_request.get('avatar_image_url')
        price_sp = gift_request.get('price_sp', 0)

        if not all([gifter_id, target_name, avatar_id, avatar_url]):
            raise ValueError("بيانات طلب الإهداء غير مكتملة.")

        gifter_wallet_ref = db.reference(f'wallets/{gifter_id}/sp')
        
        result = gifter_wallet_ref.transaction(lambda current_sp: (current_sp or 0) - price_sp if (current_sp or 0) >= price_sp else None)

        if result is None:
             request_ref.update({'status': 'failed', 'reason': 'رصيد غير كافٍ', 'processed_by': session.get('name')})
             return jsonify(success=False, message="فشلت الموافقة: رصيد المُهدي غير كافٍ."), 400

        db.reference(f'users/{target_name}').update({ 'avatar_url': avatar_url })
        
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
    if not data:
        return jsonify(success=False, message="No data received."), 400
    
    try:
        max_investments = data.get('max_investments')
        lock_hours = data.get('investment_lock_hours')
        
        if max_investments is None or lock_hours is None:
             raise ValueError("max_investments and investment_lock_hours are required")
        
        # Ensure values are non-negative integers
        max_investments_val = int(max_investments)
        lock_hours_val = int(lock_hours)
        
        if max_investments_val < 0 or lock_hours_val < 0:
            raise ValueError("Values cannot be negative.")

        db.reference('site_settings/investment_settings').set({
            'max_investments': max_investments_val,
            'investment_lock_hours': lock_hours_val
        })
        return jsonify(success=True)

    except (ValueError, TypeError) as e:
        return jsonify(success=False, message=f"بيانات غير صالحة: {e}"), 400
    except Exception as e:
        print(f"!!! Save Investment Settings Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="خطأ في الخادم."), 500
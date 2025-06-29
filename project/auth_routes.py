# --- START OF FILE project/auth_routes.py (WITH PASSWORD VERIFICATION FIX) ---

import os
import re
import sys
import time
from functools import wraps
from flask import (
    Blueprint, render_template, request, redirect, url_for, session, flash, jsonify
)
import pyrebase # <-- الإضافة الجديدة
from firebase_admin import auth, db
from .utils import check_user_status, login_required

# --- تهيئة Pyrebase للمصادقة ---
# يتم استخدام هذه المكتبة خصيصاً للتفاعل مع خدمات مصادقة Firebase (مثل تسجيل الدخول بكلمة المرور)
# التي لا يوفرها Admin SDK مباشرة.
try:
    firebase_config = {
        "apiKey": os.getenv("FIREBASE_API_KEY"),
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN"),
        "databaseURL": os.getenv("FIREBASE_DATABASE_URL"),
        "projectId": os.getenv("FIREBASE_PROJECT_ID"),
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET"),
        "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID"),
        "appId": os.getenv("FIREBASE_APP_ID"),
        "measurementId": os.getenv("FIREBASE_MEASUREMENT_ID")
    }
    firebase = pyrebase.initialize_app(firebase_config)
    pyrebase_auth = firebase.auth()
except Exception as e:
    print(f"!!! CRITICAL: Pyrebase initialization failed: {e}", file=sys.stderr)
    pyrebase_auth = None


bp = Blueprint('auth', __name__)

@bp.route('/login', methods=('GET', 'POST'))
def login_page():
    if 'user_id' in session:
        return redirect(url_for('views.home'))

    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')

        # <<< --- هذا هو التصحيح --- >>>
        # سنستخدم الآن pyrebase للتحقق من كلمة المرور
        if not pyrebase_auth:
            return jsonify(success=False, message="خدمة المصادقة غير مهيأة بشكل صحيح."), 503

        try:
            # محاولة تسجيل الدخول باستخدام البريد وكلمة المرور
            user_session = pyrebase_auth.sign_in_with_email_and_password(email, password)
            uid = user_session['localId']

            # إذا نجح تسجيل الدخول، نكمل باقي الخطوات كالمعتاد
            status, user_data = check_user_status(uid)

            if status == 'banned':
                return jsonify(success=False, status='banned', message='هذا الحساب محظور.')
            if status == 'pending':
                return jsonify(success=False, status='pending', message='حسابك قيد المراجعة من قبل الإدارة.')
            if status == 'not_found' or status == 'db_error' or user_data is None:
                return jsonify(success=False, message="فشل التحقق من بيانات المستخدم بعد تسجيل الدخول.")

            session.clear()
            session['logged_in'] = True
            session['user_id'] = uid
            session['name'] = user_data.get('name', email.split('@')[0])
            session['email'] = email
            session['role'] = user_data.get('role', 'user')
            
            # تحديث حالة الاتصال
            db.reference(f'online_visitors/{uid}').set({
                'name': session['name'],
                'online_since': int(time.time()),
                'last_seen': int(time.time())
            })
            
            return jsonify(success=True, redirect_url=url_for('views.home'))
        
        except Exception as e:
            # التعامل مع أخطاء تسجيل الدخول (مثل كلمة مرور خاطئة)
            print(f"Login attempt failed for {email}: {e}", file=sys.stderr)
            return jsonify(success=False, message="بيانات الدخول غير صحيحة. يرجى التأكد من البريد الإلكتروني وكلمة المرور.")
        # <<< --- نهاية التصحيح --- >>>
    
    # GET Request
    announcements_raw = db.reference('site_settings/announcements').get()
    announcements = list(announcements_raw.values()) if announcements_raw else []
    return render_template('login.html', announcements=announcements)


# ... (باقي الملف يبقى كما هو)
@bp.route('/register', methods=('GET', 'POST'))
def register_page():
    if request.method == 'POST':
        name = request.form.get('name').strip()
        email = request.form.get('email').strip().lower()
        password = request.form.get('password')

        if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
            return jsonify(success=False, message='صيغة البريد الإلكتروني غير صحيحة.')
        if len(password) < 6:
            return jsonify(success=False, message='كلمة المرور يجب أن تتكون من 6 أحرف على الأقل.')

        try:
            new_user = auth.create_user(email=email, password=password, display_name=name, disabled=True)
            uid = new_user.uid

            ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "").lower()
            role = 'admin' if email == ADMIN_EMAIL else 'user'
            status = 'approved' if email == ADMIN_EMAIL else 'pending'

            db.reference(f'registered_users/{uid}').set({
                'name': name,
                'email': email,
                'role': role,
                'status': status,
                'registered_at': int(time.time()),
                'uid': uid
            })

            if role == 'admin':
                auth.update_user(uid, disabled=False)
            
            message = "تم تسجيل حسابك بنجاح! سيتم مراجعته من قبل الإدارة وسيتم تفعيله قريباً."
            if role == 'admin':
                message = "تم تسجيل حساب المسؤول بنجاح! يمكنك الآن تسجيل الدخول."

            return jsonify(success=True, message=message)
            
        except auth.EmailAlreadyExistsError:
            return jsonify(success=False, message='هذا البريد الإلكتروني مسجل مسبقاً.')
        except Exception as e:
            print(f"!!! Registration Error: {e}", file=sys.stderr)
            return jsonify(success=False, message='حدث خطأ غير متوقع. يرجى المحاولة لاحقاً.'), 500

    return render_template('register.html')

@bp.route('/google-login', methods=['POST'])
def google_login():
    try:
        token_id = request.json.get('id_token')
        decoded_token = auth.verify_id_token(token_id)
        uid = decoded_token['uid']
        email = decoded_token.get('email')
        name = decoded_token.get('name', email.split('@')[0])
        
        status, user_data = check_user_status(uid)

        if status == 'not_found':
            ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "").lower()
            role = 'admin' if email == ADMIN_EMAIL else 'user'
            new_status = 'approved' if role == 'admin' else 'pending'
            
            db.reference(f'registered_users/{uid}').set({
                'name': name, 'email': email, 'role': role,
                'status': new_status, 'registered_at': int(time.time()), 'uid': uid
            })

            if new_status == 'pending':
                return jsonify(success=False, status='pending', message='تم إنشاء حسابك عبر Google بنجاح. حسابك الآن قيد المراجعة من الإدارة.')

            user_data = db.reference(f'registered_users/{uid}').get()

        elif status == 'banned':
            return jsonify(success=False, status='banned', message='هذا الحساب محظور.')
        elif status == 'pending':
            return jsonify(success=False, status='pending', message='حسابك ما زال قيد المراجعة.')

        session.clear()
        session['logged_in'] = True
        session['user_id'] = uid
        session['name'] = user_data.get('name', name)
        session['email'] = email
        session['role'] = user_data.get('role', 'user')

        db.reference(f'online_visitors/{uid}').set({
            'name': session['name'], 'online_since': int(time.time()), 'last_seen': int(time.time())
        })

        return jsonify(success=True, redirect_url=url_for('views.home'))
        
    except auth.InvalidIdTokenError:
        return jsonify(success=False, message="توكن المصادقة غير صالح."), 401
    except Exception as e:
        print(f"!!! Google Login Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم."), 500
        

@bp.route('/logout')
@login_required
def logout():
    uid = session.get('user_id')
    if uid:
        db.reference(f'online_visitors/{uid}').delete()
    session.clear()
    flash('تم تسجيل خروجك بنجاح.', 'success')
    return redirect(url_for('auth.login_page'))
    
@bp.route('/forgot_password', methods=('GET', 'POST'))
def forgot_password_page():
    if request.method == 'POST':
        email = request.form.get('email')
        try:
            link = auth.generate_password_reset_link(email, action_code_settings=None)
            return jsonify(success=True, message="إذا كان بريدك الإلكتروني موجوداً، فسيتم إرسال رابط لإعادة تعيين كلمة المرور.")
        except auth.UserNotFoundError:
            return jsonify(success=True, message="إذا كان بريدك الإلكتروني موجوداً، فسيتم إرسال رابط لإعادة تعيين كلمة المرور.")
        except Exception as e:
            return jsonify(success=False, message=str(e)), 500
    
    return render_template('forgot_password.html')
# --- START OF FILE project/auth_routes.py ---

import os
import time
import sys
from functools import wraps
from flask import (
    Blueprint, render_template, request, jsonify, redirect, url_for, session, flash
)
import pyrebase
from firebase_admin import auth, db
# *** התיקון כאן (الحل الجذري والنهائي) | THE FIX (The final and definitive solution) ***
# استيراد الاستثناء المحدد للتعامل معه
from google.auth.exceptions import RefreshError

# --- تهيئة Pyrebase (للتفاعل مع مصادقة العميل من جهة الخادم) ---
# يتم تهيئتها مرة واحدة عند بدء تشغيل التطبيق لضمان الكفاءة وتجنب الأخطاء
try:
    firebase_web_config = {
        "apiKey": os.getenv("FIREBASE_API_KEY"),
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN"),
        "databaseURL": os.getenv("FIREBASE_DATABASE_URL"),
        "projectId": os.getenv("FIREBASE_PROJECT_ID"),
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET"),
        "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID"),
        "appId": os.getenv("FIREBASE_APP_ID"),
        "measurementId": os.getenv("FIREBASE_MEASUREMENT_ID")
    }
    # التأكد من أن جميع الإعدادات موجودة قبل التهيئة
    if all(firebase_web_config.values()):
        firebase = pyrebase.initialize_app(firebase_web_config)
        pyrebase_auth = firebase.auth()
    else:
        firebase = None
        pyrebase_auth = None
        print("!!! WARNING: Pyrebase web config is incomplete. Standard login will fail.", file=sys.stderr)
except Exception as e:
    firebase = None
    pyrebase_auth = None
    print(f"!!! CRITICAL: Pyrebase initialization failed: {e}", file=sys.stderr)


# --- تعريف Blueprint ---
bp = Blueprint('auth', __name__, url_prefix='/auth')

# --- Decorators للتحقق من صلاحيات المستخدم ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            if request.is_json:
                return jsonify(success=False, message="Authentication required"), 401
            return redirect(url_for('auth.login_page'))
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            if request.is_json: return jsonify(success=False, message="Authentication required"), 401
            return redirect(url_for('auth.login_page'))
        if session.get('role') != 'admin':
            if request.is_json: return jsonify(success=False, message="Admin access required"), 403
            return redirect(url_for('views.home'))
        return f(*args, **kwargs)
    return decorated_function


# --- دوال مساعدة ---
def check_user_status(uid):
    # هذه الدالة الآن تعالج خطأ مصادقة الخادم بنفسها
    try:
        ref_registered_users = db.reference('registered_users/')
        ref_banned_users = db.reference('banned_users/')
        
        if ref_banned_users.child(uid).get():
            return 'banned', None
        
        user_data = ref_registered_users.child(uid).get()
        if not user_data:
            return 'not_found', None
            
        return user_data.get('status', 'pending'), user_data
    except RefreshError as e:
        # إذا فشلت المصادقة هنا، نمرر الاستثناء للأعلى
        raise e
    except Exception as e:
        # لأي أخطاء أخرى في قاعدة البيانات
        print(f"Error in check_user_status: {e}", file=sys.stderr)
        return 'db_error', None


# --- Routes ---
@bp.route('/login', methods=['GET', 'POST'])
def login_page():
    if 'user_id' in session:
        return redirect(url_for('views.home'))
        
    if request.method == 'POST':
        if not pyrebase_auth:
            return jsonify({"success": False, "message": "خدمة المصادقة غير مهيأة بشكل صحيح."}), 500

        email = request.form.get('email', '').strip()
        password = request.form.get('password')
        if not email or not password:
            return jsonify(success=False, message="البريد الإلكتروني وكلمة المرور مطلوبان."), 400

        try:
            user = pyrebase_auth.sign_in_with_email_and_password(email, password)
            uid = user['localId']
            
            status, db_user_data = check_user_status(uid)
            
            if status == 'db_error':
                return jsonify(success=False, message="حدث خطأ أثناء الوصول لبيانات المستخدم."), 500
            if status == 'banned':
                return jsonify(success=False, message="هذا الحساب محظور."), 403
            if status == 'pending' or status == 'not_found' or status == 'rejected':
                 return jsonify(success=False, status='pending', message="حسابك غير فعال أو قيد المراجعة."), 403
            
            session.clear()
            session['user_id'] = uid
            session['name'] = db_user_data.get('name', 'مستخدم')
            session['email'] = db_user_data.get('email')
            session['role'] = db_user_data.get('role', 'user')
            session['logged_in'] = True

            token = auth.create_custom_token(uid)
            return jsonify(success=True, redirect_url=url_for('views.home'), token=token.decode('utf-8'))
        
        except RefreshError as e:
            print(f"Server Authentication Error (likely clock sync issue): {e}", file=sys.stderr)
            message = "حدث خطأ في مصادقة الخادم. يرجى التأكد من أن ساعة جهاز الخادم مضبوطة بشكل صحيح."
            return jsonify(success=False, message=message), 500
        except Exception as e:
            error_message = "بيانات الدخول غير صحيحة. يرجى التأكد والمحاولة مرة أخرى."
            print(f"User Login Error: {e}", file=sys.stderr)
            return jsonify(success=False, message=error_message), 401

    announcements_list = []
    try:
        announcements_data = db.reference('site_settings/announcements').get()
        if announcements_data:
            announcements_list = list(announcements_data.values())
    except Exception as e:
        print(f"!!! DB Connection Warning: Could not fetch announcements for login page. Reason: {e}", file=sys.stderr)
    
    return render_template('login.html', announcements=announcements_list)


@bp.route('/google_login', methods=['POST'])
def google_login():
    try:
        id_token = request.json.get('id_token')
        if not id_token:
            return jsonify(success=False, message="Token not provided"), 400
        
        decoded_token = auth.verify_id_token(id_token)
        uid = decoded_token['uid']
        
        status, db_user_data = check_user_status(uid)

        if status == 'db_error':
            return jsonify(success=False, message="حدث خطأ أثناء الوصول لبيانات المستخدم."), 500
        if status == 'banned':
            return jsonify(success=False, status='banned', message="هذا الحساب محظور."), 403
        if status == 'approved':
            session.clear()
            session['user_id'] = uid
            session['name'] = db_user_data.get('name', 'مستخدم')
            session['email'] = db_user_data.get('email')
            session['role'] = db_user_data.get('role', 'user')
            session['logged_in'] = True
            return jsonify(success=True, redirect_url=url_for('views.home'))
            
        elif status in ['pending', 'rejected']:
             return jsonify(success=False, status='pending', message="حسابك غير فعال أو قيد المراجعة.")
        
        ADMIN_EMAIL = os.getenv('ADMIN_EMAIL')
        user_email = decoded_token.get('email')
        is_admin = user_email and user_email.lower() == ADMIN_EMAIL.lower()
        
        new_user_data = {
            'uid': uid, 'name': decoded_token.get('name', 'مستخدم جوجل'), 'email': user_email,
            'status': 'approved' if is_admin else 'pending',
            'registered_at': int(time.time()), 'role': 'admin' if is_admin else 'user',
            'provider': 'google.com'
        }
        db.reference(f'registered_users/{uid}').set(new_user_data)
        
        if is_admin:
            auth.update_user(uid, disabled=False)
            session.clear()
            session['user_id'] = uid
            session['name'] = new_user_data['name']
            session['email'] = new_user_data['email']
            session['role'] = 'admin'
            session['logged_in'] = True
            return jsonify(success=True, redirect_url=url_for('views.home'))
        else:
            return jsonify(success=False, status='pending', message="تم استلام طلب تسجيلك عبر جوجل. حسابك الآن قيد المراجعة من قبل الإدارة.")

    except auth.InvalidIdTokenError as e:
        return jsonify(success=False, message=f"فشل التحقق من هوية المستخدم: {e}"), 401
    except RefreshError as e:
        print(f"Server Authentication Error (likely clock sync issue): {e}", file=sys.stderr)
        message = "حدث خطأ في مصادقة الخادم. يرجى التأكد من أن ساعة جهاز الخادم مضبوطة بشكل صحيح."
        return jsonify(success=False, message=message), 500
    except Exception as e:
        print(f"Google Login Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ غير متوقع أثناء تسجيل الدخول."), 500


@bp.route('/register', methods=('GET', 'POST'))
def register_page():
    if 'user_id' in session:
        return redirect(url_for('views.home'))

    if request.method == 'POST':
        if not pyrebase_auth:
            return jsonify({"success": False, "message": "خطأ في إعدادات الخادم. التسجيل غير متاح حالياً."}), 500
            
        name = request.form.get('name', '').strip()
        email = request.form.get('email', '').strip()
        password = request.form.get('password')

        if not all([name, email, password]):
            return jsonify(success=False, message="جميع الحقول مطلوبة."), 400
        if len(password) < 6:
            return jsonify(success=False, message="كلمة المرور يجب أن لا تقل عن 6 أحرف."), 400

        try:
            new_user = auth.create_user(email=email, password=password, display_name=name, disabled=True)
            uid = new_user.uid

            ADMIN_EMAIL = os.getenv('ADMIN_EMAIL')
            is_admin = email.lower() == ADMIN_EMAIL.lower()

            db.reference(f'registered_users/{uid}').set({
                'uid': uid, 'name': name, 'email': email,
                'status': 'approved' if is_admin else 'pending',
                'role': 'admin' if is_admin else 'user',
                'registered_at': int(time.time()),
                'provider': 'password'
            })

            if is_admin:
                auth.update_user(uid, disabled=False)
                return jsonify(success=True, message="تم تسجيل حساب المدير بنجاح! يمكنك الآن تسجيل الدخول.")

            return jsonify(success=True, message="تم إرسال طلب تسجيلك بنجاح. سيتم مراجعته من قبل الإدارة.")

        except auth.EmailAlreadyExistsError:
            return jsonify(success=False, message="هذا البريد الإلكتروني مسجل بالفعل."), 409
        except Exception as e:
            print(f"Registration Error: {e}", file=sys.stderr)
            return jsonify(success=False, message=f"حدث خطأ غير متوقع: {e}"), 500

    return render_template('register.html')

@bp.route('/logout')
@login_required
def logout():
    user_id = session.get('user_id')
    if user_id:
        try:
            db.reference(f'online_visitors/{user_id}').delete()
        except Exception as e:
            print(f"!!! Logout DB Error: Could not remove online visitor '{user_id}'. Reason: {e}", file=sys.stderr)
    
    session.clear()
    flash('تم تسجيل خروجك بنجاح.', 'success')
    return redirect(url_for('auth.login_page'))


@bp.route('/forgot-password', methods=('GET', 'POST'))
def forgot_password_page():
    if request.method == 'POST':
        if not pyrebase_auth:
            return jsonify({"success": False, "message": "الخدمة غير متاحة حالياً."}), 500
            
        email = request.form.get('email')
        if not email:
            return jsonify(success=False, message="الرجاء إدخال البريد الإلكتروني."), 400
        
        try:
            pyrebase_auth.send_password_reset_email(email)
            return jsonify(success=True, message="تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.")
        except Exception as e:
            print(f"Forgot Password Error: {e}", file=sys.stderr)
            return jsonify(success=True, message="إذا كان بريدك الإلكتروني مسجلاً، فستصلك رسالة لإعادة التعيين.")
            
    return render_template('forgot_password.html')
# --- END OF FILE project/auth_routes.py ---
# --- START OF FILE app.py ---

from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import firebase_admin
from firebase_admin import credentials, db, auth
import os
import time
import sys
from dotenv import load_dotenv
import re
import random
import json
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps

# --- تحميل متغيرات البيئة ---
load_dotenv()

# --- الإعدادات الأولية ---
try:
    FIREBASE_DATABASE_URL = os.getenv('FIREBASE_DATABASE_URL')
    SERVICE_ACCOUNT_FILE = os.getenv('FIREBASE_SERVICE_ACCOUNT')

    # بناء الـ dictionary الخاص بإعدادات الواجهة الأمامية
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
    
    # التحقق من وجود القيم الأساسية
    required_keys_for_frontend = ["apiKey", "authDomain", "databaseURL", "projectId"]
    if any(not firebase_config.get(key) for key in required_keys_for_frontend):
        raise ValueError("بعض متغيرات البيئة الأساسية لـ Firebase مفقودة.")
    
    if not SERVICE_ACCOUNT_FILE or not os.path.exists(SERVICE_ACCOUNT_FILE):
        raise ValueError(f"ملف مفتاح الخدمة '{SERVICE_ACCOUNT_FILE}' غير موجود أو المسار خاطئ.")

except Exception as e:
    print(f"!!! خطأ حاسم في إعدادات البيئة: {e}", file=sys.stderr)
    sys.exit(1)


BANNED_WORDS = ["منيك", "شرموطة", "بتنتاك", "بنيك", "كس اختك", "كسختك", "امك", "اختك"]
def is_abusive(text):
    if not text: return False
    pattern = r'\b(' + '|'.join(re.escape(word) for word in BANNED_WORDS) + r')\b'
    return bool(re.search(pattern, text, re.IGNORECASE))

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', os.urandom(24))
app.config['JSON_AS_ASCII'] = False

try:
    cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred, {'databaseURL': FIREBASE_DATABASE_URL})
    # تعريف جميع المراجع
    ref_users = db.reference('users/')
    ref_banned_users = db.reference('banned_users/')
    ref_site_settings = db.reference('site_settings/')
    ref_candidates = db.reference('candidates/')
    ref_activity_log = db.reference('activity_log/')
    ref_points_history = db.reference('points_history/')
    ref_user_messages = db.reference('user_messages/')
    ref_registered_users = db.reference('registered_users/')
    print("تم الاتصال بـ Firebase بنجاح!")
except Exception as e:
    print(f"!!! خطأ فادح: فشل الاتصال بـ Firebase: {e}", file=sys.stderr)
    sys.exit(1)

# --- Decorators لحماية المسارات ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return jsonify(success=False, message="الجلسة انتهت، يرجى تسجيل الدخول مرة أخرى.", redirect_to_login=True), 401
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    @login_required
    def decorated_function(*args, **kwargs):
        if session.get('role') != 'admin':
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return jsonify(success=False, message="ليس لديك صلاحية الوصول.", redirect_to_login=True), 403
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated_function

# --- المسارات الرئيسية والتسجيل والدخول ---
@app.route('/')
def home():
    if 'user_id' in session:
        if session.get('role') == 'admin':
            return redirect(url_for('admin_panel'))
        return redirect(url_for('user_view'))
    return redirect(url_for('login_page'))

@app.route('/login', methods=['GET', 'POST'])
def login_page():
    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')

        if not email or not password:
            return jsonify(success=False, message="البريد الإلكتروني وكلمة المرور مطلوبان.")
        
        try:
            all_users = ref_registered_users.order_by_child('email').equal_to(email).get()
            
            if not all_users:
                return jsonify(success=False, message="البريد الإلكتروني أو كلمة المرور غير صحيحة.")

            user_id, target_user = list(all_users.items())[0]
            
            if not isinstance(target_user, dict) or not check_password_hash(target_user.get('password', ''), password):
                return jsonify(success=False, message="البريد الإلكتروني أو كلمة المرور غير صحيحة.")
            
            status = target_user.get('status')
            if status != 'approved':
                message = "حسابك ما زال قيد المراجعة." if status == 'pending' else "عذراً، تم رفض طلب انضمامك."
                return jsonify(success=False, message=message)

            session.clear()
            session['logged_in'] = True
            session['user_id'] = user_id
            session['name'] = target_user.get('name')
            session['role'] = target_user.get('role', 'user')
            
            custom_token_bytes = auth.create_custom_token(user_id)
            redirect_url = url_for('admin_panel') if session['role'] == 'admin' else url_for('user_view')
            
            return jsonify(success=True, redirect_url=redirect_url, token=custom_token_bytes.decode('utf-8'))

        except Exception as e:
            print(f"!!! Login Error: {e}", file=sys.stderr)
            return jsonify(success=False, message="حدث خطأ في الخادم أثناء محاولة تسجيل الدخول."), 500

    if 'user_id' in session:
        return redirect(url_for('home'))
    
    announcements_data = ref_site_settings.child('announcements').get() or {}
    announcements = list(announcements_data.values())
    return render_template('login.html', announcements=announcements, firebase_config=firebase_config, firebase_token="")


@app.route('/register', methods=['GET', 'POST'])
def register_page():
    if 'user_id' in session: return redirect(url_for('home'))
    
    if request.method == 'POST':
        name = request.form.get('name', '').strip()
        email = request.form.get('email', '').strip().lower()
        phone = request.form.get('phone_number', '').strip()
        password = request.form.get('password', '')
        password_confirm = request.form.get('password_confirm', '')

        # --- التحقق الشامل من المدخلات ---
        if not all([name, email, phone, password, password_confirm]):
            return jsonify(success=False, message="جميع الحقول مطلوبة."), 400

        if password != password_confirm:
            return jsonify(success=False, message="كلمتا المرور غير متطابقتين."), 400

        if len(password) < 6:
            return jsonify(success=False, message="كلمة المرور يجب أن تتكون من 6 أحرف على الأقل."), 400
            
        if not re.match(r'^\+[1-9]\d{6,14}$', phone):
            return jsonify(success=False, message="رقم الهاتف غير صالح. يجب أن يكون بالصيغة الدولية ويبدأ بعلامة + (مثال: +962791234567)."), 400
        
        admin_email = os.getenv('ADMIN_EMAIL')
        is_admin_registering = admin_email and email == admin_email

        try:
            # --- محاولة إنشاء الحساب في Firebase ---
            new_auth_user = auth.create_user(
                email=email,
                phone_number=phone,
                display_name=name,
                password=password, # إرسال كلمة المرور مباشرة ليقوم Firebase بالتحقق منها
                disabled=not is_admin_registering
            )
            uid = new_auth_user.uid

            # --- تخزين كلمة المرور المشفرة في قاعدة البيانات الخاصة بك ---
            hashed_password = generate_password_hash(password)
            
            user_ref = ref_registered_users.child(uid)
            user_data = {
                'uid': uid, 
                'name': name, 
                'email': email, 
                'phone_number': phone,
                'password': hashed_password, 
                'role': 'admin' if is_admin_registering else 'user', 
                'status': 'approved' if is_admin_registering else 'pending',
                'registered_at': int(time.time())
            }
            user_ref.set(user_data)
        
        # --- معالجة الأخطاء المحددة من Firebase ---
        except auth.EmailAlreadyExistsError:
            return jsonify(success=False, message="هذا البريد الإلكتروني مسجل بالفعل."), 409
        except auth.PhoneNumberAlreadyExistsError:
             return jsonify(success=False, message="رقم الهاتف هذا مسجل بالفعل."), 409
        except auth.InvalidEmailError:
             return jsonify(success=False, message="صيغة البريد الإلكتروني غير صالحة."), 400
        except auth.InvalidPasswordError:
             return jsonify(success=False, message="كلمة المرور ضعيفة جداً أو غير صالحة. يجب أن تتكون من 6 أحرف على الأقل."), 400
        except auth.AuthError as e:
            print(f"!!! Firebase Auth Error during registration: {e}", file=sys.stderr)
            return jsonify(success=False, message="حدث خطأ غير متوقع في المصادقة. يرجى المحاولة مرة أخرى."), 400
        except Exception as e:
            print(f"!!! Generic Registration Error: {e}", file=sys.stderr)
            return jsonify(success=False, message="حدث خطأ غير متوقع في الخادم أثناء التسجيل."), 500
        
        message = "تم تسجيل حساب الأدمن بنجاح. يمكنك الآن تسجيل الدخول." if is_admin_registering else "تم إرسال طلب تسجيلك بنجاح. ستتم مراجعته من قبل الإدارة."
        return jsonify(success=True, message=message)

    return render_template('register.html', firebase_config=firebase_config, firebase_token="")


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login_page'))

# --- الصفحات المحمية ---
@app.route('/dashboard')
@login_required
def dashboard_page():
    user_info = ref_registered_users.child(session['user_id']).get()
    if not user_info:
        session.clear()
        return redirect(url_for('login_page'))
    try:
        token_bytes = auth.create_custom_token(session['user_id'])
        token = token_bytes.decode('utf-8')
    except Exception as e:
        print(f"Error generating token: {e}", file=sys.stderr)
        session.clear()
        return redirect(url_for('login_page'))
    return render_template('dashboard.html', user=user_info, firebase_config=firebase_config, firebase_token=token)

@app.route('/admin')
@admin_required
def admin_panel():
    try:
        token_bytes = auth.create_custom_token(session['user_id'])
        token = token_bytes.decode('utf-8')
    except Exception as e:
        print(f"Error generating token: {e}", file=sys.stderr)
        session.clear()
        return redirect(url_for('login_page'))
    return render_template('admin.html', firebase_config=firebase_config, firebase_token=token)

@app.route('/users')
@login_required
def user_view():
    try:
        token_bytes = auth.create_custom_token(session['user_id'])
        token = token_bytes.decode('utf-8')
    except Exception as e:
        print(f"Error generating token: {e}", file=sys.stderr)
        session.clear()
        return redirect(url_for('login_page'))
    return render_template('user_view.html', firebase_config=firebase_config, firebase_token=token)


# --- واجهات API ---

@app.route('/add', methods=['POST'])
@admin_required
def add_user():
    name = request.form.get('name', '').strip()
    points_str = request.form.get('points', '0')
    original_name = request.form.get('original_name', '').strip()
    if not name: return jsonify(success=False, message="اسم الزاحف مطلوب."), 400
    try: points = int(points_str)
    except (ValueError, TypeError): return jsonify(success=False, message="النقاط يجب أن تكون رقماً صحيحاً."), 400

    if not original_name and ref_users.child(name).get():
        return jsonify(success=False, message="هذا الاسم موجود بالفعل."), 409

    if original_name and original_name != name:
        if ref_users.child(name).get():
             return jsonify(success=False, message=f"الاسم الجديد '{name}' موجود بالفعل. لا يمكن التغيير إليه."), 409
        old_data = ref_users.child(original_name).get()
        if old_data:
            ref_users.child(name).set(old_data)
            ref_users.child(original_name).delete()
            old_history = ref_points_history.child(original_name).get()
            if old_history: 
                ref_points_history.child(name).set(old_history)
                ref_points_history.child(original_name).delete()
            if ref_candidates.child(original_name).get(): 
                ref_candidates.child(name).set(True)
                ref_candidates.child(original_name).delete()

    user_data = ref_users.child(name).get() or {}
    current_likes = user_data.get('likes', 0)
    ref_users.child(name).update({'points': points, 'likes': current_likes, 'name': name})
    
    ref_points_history.child(name).push({'points': points, 'timestamp': int(time.time())})
    return jsonify(success=True)

@app.route('/delete/<username>', methods=['POST'])
@admin_required
def delete_user(username):
    if not ref_users.child(username).get():
        return jsonify(success=False, message="المستخدم غير موجود"), 404
    ref_users.child(username).delete()
    ref_candidates.child(username).delete()
    ref_points_history.child(username).delete()
    return jsonify(success=True)

@app.route('/like/<username>', methods=['POST'])
@login_required 
def like_user(username):
    action = request.args.get('action', 'like')
    user_id = session['user_id']
    user_name = session['name']

    if action == 'unlike':
        ref_users.child(f'{username}/likes').transaction(lambda current: (current or 1) - 1)
    else:
        ref_users.child(f'{username}/likes').transaction(lambda current: (current or 0) + 1)
        ref_activity_log.push({
            'type': 'like', 
            'text': f"'{user_name}' أعجب بـ '{username}'", 
            'timestamp': int(time.time()), 
            'user_id': user_id,
            'user_name': user_name
        })
    return jsonify(success=True)

@app.route('/api/nominate', methods=['POST'])
@login_required
def nominate_user():
    name = request.form.get('name', '').strip()
    user_id = session['user_id']
    user_name = session['name']
    
    if not name: return jsonify(success=False, message="الاسم مطلوب للترشيح."), 400
    if is_abusive(name): return jsonify(success=False, message="الرجاء استخدام كلمات لائقة."), 403
    
    text = f"'{user_name}' رشح '{name}' للانضمام"
    ref_activity_log.push({
        'type': 'nomination', 
        'text': text, 
        'timestamp': int(time.time()), 
        'user_id': user_id,
        'user_name': user_name
    })
    ref_candidates.child(name).set(True)
    return jsonify(success=True, message="تم إرسال طلب الترشيح بنجاح!")

@app.route('/api/report', methods=['POST'])
@login_required
def report_user():
    reason = request.form.get('reason', '').strip()
    reported_user = request.form.get('reported_user', '').strip()
    user_id = session['user_id']
    user_name = session['name']
    
    if not reason or not reported_user: return jsonify(success=False, message="يجب اختيار زاحف وذكر السبب."), 400
    if is_abusive(reason) or is_abusive(reported_user): return jsonify(success=False, message="الرجاء استخدام كلمات لائقة."), 403
    
    text = f"بلاغ من '{user_name}' ضد '{reported_user}': {reason}"
    ref_activity_log.push({
        'type': 'report', 
        'text': text, 
        'timestamp': int(time.time()), 
        'user_id': user_id,
        'user_name': user_name
    })
    return jsonify(success=True, message=f"تم إرسال بلاغك بخصوص {reported_user}. شكراً لك.")

@app.route('/api/user_history/<username>')
@login_required
def get_user_history(username):
    history_data = ref_points_history.child(username).get() or {}
    history_list = list(history_data.values())
    
    if not history_list:
        user_data = ref_users.child(username).get() or {}
        current_points = user_data.get('points', 0)
        current_time = int(time.time())
        return jsonify([{'timestamp': current_time - 86400, 'points': current_points}, {'timestamp': current_time, 'points': current_points}])

    if len(history_list) == 1:
        first_point = history_list[0]
        history_list.insert(0, {'points': first_point['points'], 'timestamp': first_point['timestamp'] - 86400})

    return jsonify(sorted(history_list, key=lambda x: x.get('timestamp', 0)))

@app.route('/api/admin/ban_user', methods=['POST'])
@admin_required
def ban_user():
    user_id_to_ban = request.form.get('user_id_to_ban', '').strip()
    user_name_to_ban = request.form.get('user_name_to_ban', 'مستخدم').strip()
    
    if not user_id_to_ban: 
        return jsonify(success=False, message="معرف المستخدم مطلوب للحظر."), 400
        
    ref_banned_users.child(user_id_to_ban).set({
        'banned': True, 
        'name': user_name_to_ban,
        'timestamp': int(time.time()),
        'banned_by': session.get('name', 'Admin')
    })
    return jsonify(success=True, message=f"تم حظر المستخدم '{user_name_to_ban}' بنجاح.")

@app.route('/api/admin/unban_user/<user_id>', methods=['POST'])
@admin_required
def unban_user(user_id):
    if not ref_banned_users.child(user_id).get():
        return jsonify(success=False, message="هذا المستخدم غير محظور أصلاً."), 404
    ref_banned_users.child(user_id).delete()
    return jsonify(success=True, message=f"تم رفع الحظر عن المستخدم.")

@app.route('/api/admin/candidate/<action>/<username>', methods=['POST'])
@admin_required
def manage_candidate(action, username):
    if action == 'add': ref_candidates.child(username).set(True)
    elif action == 'remove': ref_candidates.child(username).delete()
    return jsonify(success=True)

@app.route('/api/admin/announcements/add', methods=['POST'])
@admin_required
def add_announcement():
    text = request.form.get('text', '').strip()
    if text: ref_site_settings.child('announcements').push({'text': text})
    return jsonify(success=True)

@app.route('/api/admin/announcements/delete/<item_id>', methods=['POST'])
@admin_required
def delete_announcement(item_id):
    ref_site_settings.child(f'announcements/{item_id}').delete()
    return jsonify(success=True)

@app.route('/api/admin/honor_roll/add', methods=['POST'])
@admin_required
def add_to_honor_roll():
    name = request.form.get('name', '').strip()
    if name: ref_site_settings.child('honor_roll').push({'name': name})
    return jsonify(success=True)

@app.route('/api/admin/honor_roll/delete/<item_id>', methods=['POST'])
@admin_required
def delete_from_honor_roll(item_id):
    ref_site_settings.child(f'honor_roll/{item_id}').delete()
    return jsonify(success=True)

@app.route('/api/admin/user_message/send', methods=['POST'])
@admin_required
def send_user_message():
    user_id = request.form.get('user_id', '').strip()
    user_name = request.form.get('user_name', '').strip()
    message = request.form.get('message', '').strip()
    
    if not user_id or not message: 
        return jsonify(success=False, message="معرف المستخدم والرسالة مطلوبان."), 400
    
    # START: تعديل - استخدام push لإنشاء معرف فريد
    ref_user_messages.child(user_id).push({'text': message, 'timestamp': int(time.time())})
    # END: تعديل
    return jsonify(success=True, message=f"تم إرسال الرسالة إلى {user_name}")

@app.route('/api/admin/settings/spin_wheel', methods=['POST'])
@admin_required
def save_spin_wheel_settings():
    settings = request.get_json()
    if settings: ref_site_settings.child('spin_wheel_settings').set(settings)
    return jsonify(success=True, message="تم حفظ إعدادات عجلة الحظ!")

@app.route('/api/admin/manage_user/<user_id>/<action>', methods=['POST'])
@admin_required
def manage_user(user_id, action):
    user_ref = ref_registered_users.child(user_id)
    if not user_ref.get():
        return jsonify(success=False, message="المستخدم غير موجود في قاعدة البيانات."), 404
    
    if action not in ['approve', 'reject']: 
        return jsonify(success=False, message="إجراء غير صالح."), 400
        
    try:
        if action == 'approve':
            auth.update_user(user_id, disabled=False)
            user_ref.update({'status': 'approved'})
            message = "تم قبول المستخدم وتفعيل حسابه بنجاح."
        else:
            user_ref.update({'status': 'rejected'})
            try:
                auth.delete_user(user_id)
            except auth.UserNotFoundError:
                print(f"User {user_id} not found in Auth for deletion, but status set to rejected.")
            message = "تم رفض المستخدم وحذف حسابه."
            
        return jsonify(success=True, message=message)

    except Exception as e:
        print(f"!!! User Management Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء معالجة الطلب."), 500

@app.route('/api/settings/spin_wheel', methods=['GET'])
@login_required
def get_spin_wheel_settings():
    return jsonify(ref_site_settings.child('spin_wheel_settings').get() or {})

@app.route('/api/check_my_ban_status')
@login_required
def check_my_ban_status():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'is_banned': False})
    
    banned_status = ref_banned_users.child(user_id).get()
    is_banned = banned_status is not None
    return jsonify({'is_banned': is_banned})

@app.route('/api/spin_wheel', methods=['POST'])
@login_required
def spin_wheel_api():
    settings = ref_site_settings.child('spin_wheel_settings').get() or {}
    if not settings.get('enabled', False): return jsonify(success=False, message="عجلة الحظ معطلة."), 403
    prizes_config = settings.get('prizes', [])
    if not prizes_config: return jsonify(success=False, message="خطأ في إعدادات الجوائز."), 500

    prizes = [float(p['value']) for p in prizes_config]
    weights = [float(p['weight']) for p in prizes_config]

    if not prizes or not weights or sum(weights) <= 0: return jsonify(success=False, message="خطأ في أوزان الجوائز."), 500

    chosen_prize = random.choices(prizes, weights=weights, k=1)[0]
    session['last_prize_won'] = chosen_prize
    return jsonify(success=True, prize=chosen_prize)

@app.route('/api/donate_points', methods=['POST'])
@login_required
def donate_points_api():
    username = request.form.get('username', '').strip()
    points_to_donate = session.pop('last_prize_won', 0)
    
    if not username or points_to_donate <= 0: 
        return jsonify(success=False, message="بيانات التبرع غير صالحة."), 400
        
    user_ref = ref_users.child(username)
    if not user_ref.get(): 
        return jsonify(success=False, message=f"المستخدم '{username}' غير موجود."), 404
        
    try:
        user_ref.child('points').transaction(lambda current_points: (current_points or 0) + float(points_to_donate))
        
        timestamp = int(time.time())
        user_id = session['user_id']
        user_name = session['name']
        
        ref_activity_log.push({
            'type': 'gift', 
            'text': f"'{user_name}' تبرع بـ {int(points_to_donate):,} نقطة إلى '{username}'.", 
            'timestamp': timestamp, 
            'user_id': user_id,
            'user_name': user_name
        })
        
        final_points = (user_ref.get() or {}).get('points', points_to_donate)
        ref_points_history.child(username).push({'points': final_points, 'timestamp': timestamp})
        
        return jsonify(success=True, message=f"تم التبرع بـ {int(points_to_donate):,} نقطة بنجاح!")
    except Exception as e:
        print(f"Donation Error: {e}", file=sys.stderr)
        session['last_prize_won'] = points_to_donate
        return jsonify(success=False, message="حدث خطأ أثناء التبرع."), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
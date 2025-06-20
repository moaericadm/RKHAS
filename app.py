

from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import firebase_admin
from firebase_admin import credentials, db
import os
import time
import sys
from dotenv import load_dotenv
import re
import random
import json

# --- تحميل متغيرات البيئة ---
load_dotenv()

# --- الإعدادات الأولية ---
try:
    FIREBASE_DATABASE_URL = os.getenv('FIREBASE_DATABASE_URL')
    SERVICE_ACCOUNT_FILE = os.getenv('FIREBASE_SERVICE_ACCOUNT')
    ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD')
    
    firebase_config = {
        "apiKey": os.getenv("FIREBASE_API_KEY"), 
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN"),
        "databaseURL": FIREBASE_DATABASE_URL, 
        "projectId": os.getenv("FIREBASE_PROJECT_ID"),
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET"), 
        "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID"),
        "appId": os.getenv("FIREBASE_APP_ID"), 
        "measurementId": os.getenv("FIREBASE_MEASUREMENT_ID")
    }
    
    required_config_keys = ["apiKey", "authDomain", "databaseURL", "projectId"]
    missing_keys = [key for key, value in firebase_config.items() if key in required_config_keys and not value]
    if missing_keys:
        raise ValueError(f"متغيرات البيئة التالية لـ Firebase مفقودة أو فارغة: {', '.join(missing_keys)}")
    
    if not SERVICE_ACCOUNT_FILE or not ADMIN_PASSWORD:
        raise ValueError("متغيرات FIREBASE_SERVICE_ACCOUNT أو ADMIN_PASSWORD مفقودة.")

except Exception as e:
    print(f"!!! خطأ حاسم في إعدادات البيئة (app.py): {e}", file=sys.stderr)
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
    ref_users = db.reference('users/')
    ref_banned_visitors = db.reference('banned_visitors/')
    ref_site_settings = db.reference('site_settings/')
    ref_candidates = db.reference('candidates/')
    ref_activity_log = db.reference('activity_log/')
    ref_points_history = db.reference('points_history/')
    ref_visitor_messages = db.reference('visitor_messages/')
    print("تم الاتصال بـ Firebase بنجاح (app.py)!")
except Exception as e:
    print(f"!!! خطأ فادح: فشل الاتصال بـ Firebase (app.py): {e}", file=sys.stderr)
    sys.exit(1)

@app.route('/')
def home(): return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if 'admin_logged_in' in session: return redirect(url_for('admin_panel'))
    if request.method == 'POST':
        if request.form.get('password') == ADMIN_PASSWORD:
            session['admin_logged_in'] = True
            return jsonify(success=True, redirect_url=url_for('admin_panel'))
        return jsonify(success=False, message="كلمة المرور غير صحيحة.")
    announcements_data = ref_site_settings.child('announcements').get() or {}
    announcements = list(announcements_data.values())
    return render_template('login.html', announcements=announcements)

@app.route('/admin')
def admin_panel():
    if 'admin_logged_in' not in session: return redirect(url_for('login'))
    return render_template('admin.html', firebase_config=firebase_config)

@app.route('/users')
def user_view():
    return render_template('user_view.html', firebase_config=firebase_config)

@app.route('/logout')
def logout(): session.pop('admin_logged_in', None); return redirect(url_for('login'))

@app.route('/add', methods=['POST'])
def add_user():
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    name = request.form.get('name', '').strip()
    points_str = request.form.get('points', '0')
    original_name = request.form.get('original_name', '').strip()
    if not name: return jsonify(success=False, message="اسم الزاحف مطلوب."), 400
    try: points = int(points_str)
    except (ValueError, TypeError): return jsonify(success=False, message="النقاط يجب أن تكون رقماً صحيحاً."), 400
    
    if original_name and original_name != name:
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
    ref_users.child(name).update({'points': points, 'likes': current_likes})
    
    updated_user_data = ref_users.child(name).get()
    new_total_points = updated_user_data.get('points', points) if updated_user_data else points
    ref_points_history.child(name).push({'points': new_total_points, 'timestamp': int(time.time())})
    
    return jsonify(success=True)

@app.route('/delete/<username>', methods=['POST'])
def delete_user(username):
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    ref_users.child(username).delete()
    ref_candidates.child(username).delete()
    ref_points_history.child(username).delete()
    return jsonify(success=True)

@app.route('/like/<username>', methods=['POST'])
def like_user(username):
    visitor_name = request.form.get('visitor_name', 'زائر').strip()
    action = request.args.get('action', 'like') 
    if action == 'unlike':
        ref_users.child(f'{username}/likes').transaction(lambda current: (current or 1) - 1)
    else:
        ref_users.child(f'{username}/likes').transaction(lambda current: (current or 0) + 1)
        ref_activity_log.push({'type': 'like', 'text': f"'{visitor_name}' أعجب بـ '{username}'", 'timestamp': int(time.time()), 'visitor_name': visitor_name})
    return jsonify(success=True)

@app.route('/api/nominate', methods=['POST'])
def nominate_user():
    name = request.form.get('name', '').strip()
    visitor_name = request.form.get('visitor_name', 'زائر').strip()
    if is_abusive(name) or is_abusive(visitor_name):
        ref_banned_visitors.child(visitor_name).set({'banned': True, 'timestamp': int(time.time())})
        return jsonify(success=False, message="تم حظرك لاستخدام كلمات غير لائقة.", action="ban"), 403
    if not name: return jsonify(success=False, message="الاسم مطلوب للترشيح."), 400
    text = f"'{visitor_name}' رشح '{name}' للانضمام"
    ref_activity_log.push({'type': 'nomination', 'text': text, 'timestamp': int(time.time()), 'visitor_name': visitor_name})
    return jsonify(success=True, message="تم إرسال طلب الترشيح بنجاح!")

@app.route('/api/report', methods=['POST'])
def report_user():
    reason = request.form.get('reason', '').strip()
    visitor_name = request.form.get('visitor_name', 'الطالب').strip()
    reported_user = request.form.get('reported_user', '').strip()
    if is_abusive(reason) or is_abusive(visitor_name) or is_abusive(reported_user):
        ref_banned_visitors.child(visitor_name).set({'banned': True, 'timestamp': int(time.time())})
        return jsonify(success=False, message="تم حظرك لاستخدام كلمات غير لائقة.", action="ban"), 403
    if not reason: return jsonify(success=False, message="سبب الإبلاغ مطلوب."), 400
    if not reported_user: return jsonify(success=False, message="يجب اختيار زاحف للإبلاغ عنه."), 400
    text = f"بلاغ من '{visitor_name}' ضد '{reported_user}': {reason}"
    ref_activity_log.push({'type': 'report', 'text': text, 'timestamp': int(time.time()), 'visitor_name': visitor_name})
    return jsonify(success=True, message=f"تم إرسال بلاغك بخصوص {reported_user}. شكراً لك.")

@app.route('/api/user_history/<username>')
def get_user_history(username):
    history_data = ref_points_history.child(username).get()
    if isinstance(history_data, dict):
        history_list = list(history_data.values())
        if len(history_list) == 1:
             history_list.insert(0,{'points': history_list[0]['points'], 'timestamp': history_list[0]['timestamp'] - (3600*24) }) 
        return jsonify(sorted(history_list, key=lambda x: x.get('timestamp', 0)))
    else: 
        user_data = ref_users.child(username).get() or {}
        current_points = user_data.get('points', 0)
        current_time = int(time.time())
        return jsonify([
            {'timestamp': current_time - (3600*24), 'points': current_points},
            {'timestamp': current_time, 'points': current_points}
        ])

@app.route('/api/check_ban_status/<visitor_name>')
def check_ban_status(visitor_name):
    return jsonify({'is_banned': ref_banned_visitors.child(visitor_name).get() is not None})

@app.route('/api/admin/ban_visitor', methods=['POST'])
def ban_visitor():
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    name_to_ban = request.form.get('name_to_ban', '').strip()
    if not name_to_ban: return jsonify(success=False, message="اسم الزائر مطلوب للحظر."), 400
    ref_banned_visitors.child(name_to_ban).set({'banned': True, 'timestamp': int(time.time())})
    return jsonify(success=True, message=f"تم حظر الزائر '{name_to_ban}' بنجاح.")

@app.route('/api/admin/unban_visitor/<visitor_name>', methods=['POST'])
def unban_visitor(visitor_name):
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    ref_banned_visitors.child(visitor_name).delete()
    return jsonify(success=True, message=f"تم رفع الحظر عن '{visitor_name}'.")

@app.route('/api/admin/candidate/<action>/<username>', methods=['POST'])
def manage_candidate(action, username):
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    if action == 'add': ref_candidates.child(username).set(True)
    elif action == 'remove': ref_candidates.child(username).delete()
    return jsonify(success=True)

@app.route('/api/admin/announcements/add', methods=['POST'])
def add_announcement():
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    text = request.form.get('text', '').strip()
    if not text: return jsonify(success=False, message="نص الإعلان مطلوب."), 400
    ref_site_settings.child('announcements').push({'text': text})
    return jsonify(success=True)

@app.route('/api/admin/announcements/delete/<item_id>', methods=['POST'])
def delete_announcement(item_id):
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    ref_site_settings.child(f'announcements/{item_id}').delete()
    return jsonify(success=True)

@app.route('/api/admin/honor_roll/add', methods=['POST'])
def add_to_honor_roll():
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    name = request.form.get('name', '').strip()
    if name: ref_site_settings.child('honor_roll').push({'name': name})
    return jsonify(success=True)

@app.route('/api/admin/honor_roll/delete/<item_id>', methods=['POST'])
def delete_from_honor_roll(item_id):
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    ref_site_settings.child(f'honor_roll/{item_id}').delete()
    return jsonify(success=True)

@app.route('/api/admin/visitor_message/send', methods=['POST'])
def send_visitor_message():
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    visitor_name = request.form.get('visitor_name', '').strip()
    message = request.form.get('message', '').strip()
    if not visitor_name or not message: return jsonify(success=False, message="اسم الزائر والرسالة مطلوبان."), 400
    ref_visitor_messages.child(visitor_name).push({'text': message, 'timestamp': int(time.time())})
    return jsonify(success=True, message=f"تم إرسال الرسالة إلى {visitor_name}")

# --- START: NEW AND UPDATED SPIN WHEEL ROUTES ---

def get_default_spin_wheel_settings():
    return {
        "enabled": True,
        "cooldownHours": 24,
        "maxAttempts": 1,
        "prizes": [
            {"value": 100, "weight": 35},
            {"value": 250, "weight": 25},
            {"value": 500, "weight": 18},
            {"value": 1000, "weight": 10},
            {"value": 2500, "weight": 6},
            {"value": 5000, "weight": 3},
            {"value": 10000, "weight": 1.5},
            {"value": 50000, "weight": 1},
            {"value": 1000000, "weight": 0.5}
        ]
    }

@app.route('/api/settings/spin_wheel', methods=['GET'])
def get_spin_wheel_settings():
    settings = ref_site_settings.child('spin_wheel_settings').get()
    if not settings:
        settings = get_default_spin_wheel_settings()
    return jsonify(settings)

@app.route('/api/admin/settings/spin_wheel', methods=['POST'])
def save_spin_wheel_settings():
    if 'admin_logged_in' not in session:
        return jsonify(success=False, message="غير مصرح به"), 401
    
    try:
        data = request.get_json()
        if not data:
            return jsonify(success=False, message="لم يتم إرسال بيانات."), 400
        
        # Basic validation
        cooldown = int(data.get('cooldownHours', 24))
        attempts = int(data.get('maxAttempts', 1))
        prizes = data.get('prizes', [])
        enabled = data.get('enabled', True)

        if cooldown <= 0 or attempts <= 0 or not prizes:
             return jsonify(success=False, message="بيانات الإعدادات غير صالحة."), 400

        settings_to_save = {
            'enabled': enabled,
            'cooldownHours': cooldown,
            'maxAttempts': attempts,
            'prizes': prizes
        }

        ref_site_settings.child('spin_wheel_settings').set(settings_to_save)
        return jsonify(success=True, message="تم حفظ إعدادات عجلة الحظ بنجاح!")
    except Exception as e:
        print(f"Error saving spin wheel settings: {e}", file=sys.stderr)
        return jsonify(success=False, message=f"حدث خطأ أثناء حفظ الإعدادات: {e}"), 500

@app.route('/api/spin_wheel', methods=['POST'])
def spin_wheel_api():
    settings = ref_site_settings.child('spin_wheel_settings').get()
    if not settings:
        settings = get_default_spin_wheel_settings()

    if not settings.get('enabled', False):
        return jsonify(success=False, message="عذراً، ميزة عجلة الحظ معطلة حالياً من قبل الإدارة."), 403
    
    prize_config = settings.get('prizes', [])
    if not prize_config:
        return jsonify(success=False, message="خطأ في إعدادات الجوائز. يرجى مراجعة الإدارة."), 500

    prizes = [p['value'] for p in prize_config]
    weights = [p['weight'] for p in prize_config]

    if not prizes or not weights or len(prizes) != len(weights):
        print("Error: Prizes and weights mismatch or empty in /api/spin_wheel", file=sys.stderr)
        return jsonify(success=False, message="خطأ في إعدادات الجوائز."), 500

    chosen_prize = random.choices(prizes, weights=weights, k=1)[0]
    
    return jsonify(success=True, prize=chosen_prize)

# --- END: NEW AND UPDATED SPIN WHEEL ROUTES ---


@app.route('/api/donate_points', methods=['POST'])
def donate_points_api():
    username_to_donate = request.form.get('username', '').strip()
    points_str = request.form.get('points', '0').strip()
    visitor_name = request.form.get('visitor_name', 'زائر مجهول').strip()

    if not username_to_donate or not points_str:
        return jsonify(success=False, message="البيانات المطلوبة (اسم المستخدم والنقاط) غير مكتملة."), 400

    try:
        points_to_add = int(points_str)
        if points_to_add <= 0:
            raise ValueError("Points must be a positive integer.")
    except ValueError:
        return jsonify(success=False, message="قيمة النقاط غير صالحة."), 400

    user_to_donate_ref = ref_users.child(username_to_donate)
    user_exists = user_to_donate_ref.get()

    if not user_exists:
        return jsonify(success=False, message=f"المستخدم '{username_to_donate}' غير موجود للتبرع له."), 404

    try:
        def transaction_update(current_data):
            # This handles both old structure (just points) and new (dict with points and likes)
            if current_data is None:
                current_data = {'points': 0, 'likes': 0}
            elif isinstance(current_data, int): # Handle legacy format
                current_data = {'points': current_data, 'likes': 0}
            
            current_data['points'] = current_data.get('points', 0) + points_to_add
            return current_data

        user_to_donate_ref.transaction(transaction_update)
        
        timestamp = int(time.time())
        activity_text = f"'{visitor_name}' تبرع بـ {points_to_add:,} نقطة إلى '{username_to_donate}' عن طريق عجلة الحظ."
        ref_activity_log.push({
            'type': 'gift', 
            'text': activity_text, 
            'timestamp': timestamp,
            'visitor_name': visitor_name
        })

        final_points_data = user_to_donate_ref.get()
        final_points = final_points_data.get('points', 0) if isinstance(final_points_data, dict) else (final_points_data or points_to_add)

        ref_points_history.child(username_to_donate).push({
            'points': final_points,
            'timestamp': timestamp
        })
        
        return jsonify(success=True, message=f"تم التبرع بـ {points_to_add:,} نقطة إلى {username_to_donate} بنجاح! شكراً لك.")
    except Exception as e:
        print(f"Error donating points: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ أثناء عملية التبرع."), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host='0.0.0.0', port=port)

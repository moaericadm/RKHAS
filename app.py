from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import firebase_admin
from firebase_admin import credentials, db
import os
import time
import sys
from dotenv import load_dotenv
import re

# --- تحميل متغيرات البيئة ---
load_dotenv()

# --- الإعدادات الأولية والتأكد من المتغيرات ---
try:
    FIREBASE_DATABASE_URL = os.getenv('FIREBASE_DATABASE_URL')
    SERVICE_ACCOUNT_FILE = os.getenv('FIREBASE_SERVICE_ACCOUNT')
    ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD')
    SITE_OWNER_NAME = "صاحب"
    firebase_config = {
        "apiKey": os.getenv("FIREBASE_API_KEY"), "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN"),
        "databaseURL": FIREBASE_DATABASE_URL, "projectId": os.getenv("FIREBASE_PROJECT_ID"),
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET"), "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID"),
        "appId": os.getenv("FIREBASE_APP_ID"), "measurementId": os.getenv("FIREBASE_MEASUREMENT_ID")
    }
    if not all(firebase_config.values()) or not SERVICE_ACCOUNT_FILE or not ADMIN_PASSWORD:
        missing = [k for k, v in firebase_config.items() if not v]
        if not SERVICE_ACCOUNT_FILE: missing.append("FIREBASE_SERVICE_ACCOUNT")
        if not ADMIN_PASSWORD: missing.append("ADMIN_PASSWORD")
        raise ValueError(f"متغيرات البيئة التالية مفقودة أو فارغة في ملف .env: {', '.join(missing)}")
except Exception as e:
    print(f"!!! خطأ حاسم في إعدادات البيئة: {e}", file=sys.stderr)
    sys.exit(1)

BANNED_WORDS = ["صاحب الصفحة المنيك", "يا ابن الشرموطة", "يا منيك", "انت بتنتاك", "بنيك اختك", "كس اختك", "كسختك", "امك", "اختك"]
def is_abusive_towards_owner(text):
    lower_text = text.lower()
    if SITE_OWNER_NAME.lower() not in lower_text: return False
    for word in BANNED_WORDS:
        if re.search(r'\b' + re.escape(word.lower()) + r'\b', lower_text): return True
    return False

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', os.urandom(24))
app.config['JSON_AS_ASCII'] = False

try:
    cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred, {'databaseURL': FIREBASE_DATABASE_URL})
    ref = db.reference('users/')
    announcement_ref = db.reference('site_settings/announcement')
    notifications_ref = db.reference('notifications/')
    candidates_ref = db.reference('candidates/')
    honor_roll_ref = db.reference('site_settings/honor_roll')
    points_history_ref = db.reference('points_history/')
    activity_log_ref = db.reference('activity_log/')
    banned_users_ref = db.reference('banned_users/')
    print("تم الاتصال بـ Firebase بنجاح!")
except Exception as e:
    print(f"!!! خطأ فادح: فشل الاتصال بـ Firebase: {e}", file=sys.stderr)
    sys.exit(1)

def get_users_sorted():
    users = ref.get() or {}
    candidates = candidates_ref.get() or {}
    user_list = [{'name': key, 'points': int(data.get('points', 0)), 'likes': int(data.get('likes', 0)), 'is_candidate': key in candidates} for key, data in users.items() if data and isinstance(data, dict)]
    user_list.sort(key=lambda x: x['points'], reverse=True)
    return user_list

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
    announcement = announcement_ref.get()
    return render_template('login.html', announcement=announcement)

@app.route('/admin')
def admin_panel():
    if 'admin_logged_in' not in session: return redirect(url_for('login'))
    return render_template('admin.html', firebase_config=firebase_config)

@app.route('/users')
def user_view(): return render_template('user_view.html', firebase_config=firebase_config)

@app.route('/logout')
def logout(): session.pop('admin_logged_in', None); return redirect(url_for('login'))

@app.route('/add', methods=['POST'])
def add_user():
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    try:
        name = request.form.get('name', '').strip()
        points = int(request.form.get('points', 0))
        original_name = request.form.get('original_name', '').strip()
        if not name: return jsonify(success=False, message="اسم الزاحف مطلوب."), 400
        if original_name and original_name != name:
            old_data = ref.child(original_name).get()
            if old_data:
                ref.child(name).set(old_data)
                ref.child(original_name).delete()
            if candidates_ref.child(original_name).get():
                candidates_ref.child(name).set(True)
                candidates_ref.child(original_name).delete()
        user_data = ref.child(name).get()
        current_likes = user_data.get('likes', 0) if user_data else 0
        ref.child(name).update({'points': points, 'likes': current_likes})
        points_history_ref.child(name).push({'points': points, 'timestamp': int(time.time())})
        return jsonify(success=True)
    except Exception as e: return jsonify(success=False, message=str(e)), 500

@app.route('/api/user_history/<username>')
def get_user_history(username):
    history_data = points_history_ref.child(username).get()
    if not history_data:
        user_data = ref.child(username).get()
        current_points = user_data.get('points', 0) if user_data else 0
        dummy_history = [{'timestamp': int(time.time()) - (86400 * 2), 'points': int(current_points * 0.7)}, {'timestamp': int(time.time()) - 86400, 'points': int(current_points * 0.9)}, {'timestamp': int(time.time()), 'points': current_points}]
        return jsonify(dummy_history)
    return jsonify(sorted(history_data.values(), key=lambda x: x.get('timestamp', 0)))

@app.route('/api/users')
def api_get_users(): return jsonify(get_users_sorted())

@app.route('/delete/<username>', methods=['POST'])
def delete_user(username):
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    try:
        ref.child(username).delete(); candidates_ref.child(username).delete(); points_history_ref.child(username).delete()
        return jsonify(success=True)
    except Exception as e: return jsonify(success=False, message=str(e)), 500

@app.route('/like/<username>', methods=['POST'])
def like_user(username):
    try:
        visitor_name = request.form.get('visitor_name', 'زائر').strip()
        ref.child(f'{username}/likes').transaction(lambda current: (current or 0) + 1)
        activity_log_ref.push({'type': 'like', 'text': f"'{visitor_name}' أعجب بـ '{username}'", 'timestamp': int(time.time()), 'visitor_name': visitor_name})
        return jsonify(success=True)
    except Exception as e: return jsonify(success=False, message=str(e)), 500

@app.route('/api/nominate', methods=['POST'])
def nominate_user():
    try:
        name = request.form.get('name', '').strip()
        visitor_name = request.form.get('visitor_name', 'زائر').strip()
        if is_abusive_towards_owner(name):
            text = f"محاولة إساءة من '{visitor_name}': {name}"
            notifications_ref.push({'type': 'violation', 'text': text, 'timestamp': int(time.time()), 'status': 'unread'})
            activity_log_ref.push({'type': 'violation', 'text': text, 'timestamp': int(time.time()), 'visitor_name': visitor_name})
            return jsonify(success=False, message="انحظرت يا ساقط", action="ban"), 403
        if not name: return jsonify(success=False, message="الاسم مطلوب للترشيح."), 400
        text = f"'{visitor_name}' رشح '{name}' للانضمام"
        notifications_ref.push({'type': 'nomination', 'text': text, 'timestamp': int(time.time()), 'status': 'unread'})
        activity_log_ref.push({'type': 'nomination', 'text': text, 'timestamp': int(time.time()), 'visitor_name': visitor_name})
        return jsonify(success=True, message="تم إرسال طلب الترشيح بنجاح!")
    except Exception as e: return jsonify(success=False, message=str(e)), 500

@app.route('/api/report', methods=['POST'])
def report_user():
    try:
        reason = request.form.get('reason', '').strip()
        visitor_name = request.form.get('visitor_name', 'الطالب').strip()
        if is_abusive_towards_owner(reason):
            text = f"محاولة إساءة من '{visitor_name}': {reason}"
            notifications_ref.push({'type': 'violation', 'text': text, 'timestamp': int(time.time()), 'status': 'unread'})
            activity_log_ref.push({'type': 'violation', 'text': text, 'timestamp': int(time.time()), 'visitor_name': visitor_name})
            return jsonify(success=False, message="بتسب يبن القحبة طيب حظرتك.", action="ban"), 403
        reported_user = request.form.get('reported_user', '').strip()
        if not reason: return jsonify(success=False, message="سبب الإبلاغ مطلوب."), 400
        text = f"بلاغ من '{visitor_name}' ضد '{reported_user}': {reason}"
        notifications_ref.push({'type': 'report', 'text': text, 'timestamp': int(time.time()), 'status': 'unread'})
        activity_log_ref.push({'type': 'report', 'text': text, 'timestamp': int(time.time()), 'visitor_name': visitor_name})
        return jsonify(success=True, message=f"تم إرسال بلاغك بخصوص {reported_user}. شكراً لك.")
    except Exception as e: return jsonify(success=False, message=str(e)), 500

@app.route('/api/admin/announcement', methods=['POST'])
def set_announcement():
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    try:
        text = request.form.get('text', '').strip()
        if text: announcement_ref.set({'text': text, 'timestamp': int(time.time())})
        else: announcement_ref.delete()
        return jsonify(success=True)
    except Exception as e: return jsonify(success=False, message=str(e)), 500

@app.route('/api/admin/candidate/<action>/<username>', methods=['POST'])
def manage_candidate(action, username):
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    try:
        if action == 'add': candidates_ref.child(username).set(True)
        elif action == 'remove': candidates_ref.child(username).delete()
        return jsonify(success=True)
    except Exception as e: return jsonify(success=False, message=str(e)), 500

@app.route('/api/admin/notifications')
def get_notifications():
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    notifications = notifications_ref.get() or {}
    return jsonify(sorted(list({'id': k, **v} for k, v in notifications.items()), key=lambda x: x.get('timestamp', 0), reverse=True))

@app.route('/api/admin/notifications/mark_read/<notif_id>', methods=['POST'])
def mark_notification_read(notif_id):
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    try:
        notifications_ref.child(f'{notif_id}/status').set('read')
        return jsonify(success=True)
    except Exception as e: return jsonify(success=False, message=str(e)), 500
    
@app.route('/api/admin/honor_roll', methods=['GET'])
def get_honor_roll():
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    honor_roll = honor_roll_ref.get() or {}
    return jsonify([{'id': k, 'name': v['name']} for k, v in honor_roll.items()])

@app.route('/api/admin/honor_roll/add', methods=['POST'])
def add_to_honor_roll():
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    try:
        name = request.form.get('name', '').strip()
        if not name: return jsonify(success=False, message="الاسم مطلوب."), 400
        honor_roll_ref.push({'name': name})
        return jsonify(success=True)
    except Exception as e: return jsonify(success=False, message=str(e)), 500

@app.route('/api/admin/honor_roll/delete/<item_id>', methods=['POST'])
def delete_from_honor_roll(item_id):
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    try:
        honor_roll_ref.child(item_id).delete()
        return jsonify(success=True)
    except Exception as e: return jsonify(success=False, message=str(e)), 500

@app.route('/api/admin/activity_log')
def get_activity_log():
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    log = activity_log_ref.get() or {}
    return jsonify(sorted(list({'id': k, **v} for k, v in log.items()), key=lambda x: x.get('timestamp', 0), reverse=True))

@app.route('/api/admin/ban_user', methods=['POST'])
def ban_user():
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    try:
        name_to_ban = request.form.get('name_to_ban', '').strip()
        if not name_to_ban: return jsonify(success=False, message="الاسم مطلوب للحظر."), 400
        banned_users_ref.child(name_to_ban).set(True)
        if ref.child(name_to_ban).get():
            ref.child(name_to_ban).delete()
        return jsonify(success=True, message=f"تم حظر ابن العايب  '{name_to_ban}' وحذفه من القوائم.")
    except Exception as e: return jsonify(success=False, message=str(e)), 500

@app.route('/api/check_ban_status/<visitor_name>')
def check_ban_status(visitor_name):
    is_banned = banned_users_ref.child(visitor_name).get() is not None
    return jsonify({'is_banned': is_banned})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)

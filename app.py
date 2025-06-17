from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import firebase_admin
from firebase_admin import credentials, db
import os
import time

# --- الإعدادات الأولية ---
FIREBASE_DATABASE_URL = 'https://nnmy-9e611-default-rtdb.firebaseio.com/'
SERVICE_ACCOUNT_FILE = 'serviceAccountKey.json'
ADMIN_PASSWORD = 'WaRn123'

app = Flask(__name__)
app.secret_key = os.urandom(24)
app.config['JSON_AS_ASCII'] = False

try:
    cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred, {'databaseURL': FIREBASE_DATABASE_URL})
    ref = db.reference('users/')
    leader_ref = db.reference('leader_info/')
    print("تم الاتصال بـ Firebase بنجاح!")
except Exception as e:
    print(f"!!! خطأ فادح: فشل الاتصال بـ Firebase: {e}")

def get_users_sorted():
    """تجلب قائمة المستخدمين وتستخدم المفتاح الرئيسي كاسم."""
    users = ref.get()
    if not users: return []
    user_list = []
    for key, data in users.items():
        if data and isinstance(data, dict):
            user_list.append({
                'name': key,
                'points': int(data.get('points', 0)),
                'likes': int(data.get('likes', 0))
            })
    user_list.sort(key=lambda x: x['points'], reverse=True)
    return user_list

# --- الصفحات الرئيسية ---
@app.route('/')
def home():
    return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if 'admin_logged_in' in session: return redirect(url_for('admin_panel'))
    if request.method == 'POST':
        password = request.form.get('password')
        if password == ADMIN_PASSWORD:
            session['admin_logged_in'] = True
            return jsonify(success=True, redirect_url=url_for('admin_panel'))
        else:
            return jsonify(success=False, message="كلمة المرور غير صحيحة!! مفكر حالك مشرف يرخيص الكس")
    return render_template('login.html')

@app.route('/admin')
def admin_panel():
    if 'admin_logged_in' not in session: return redirect(url_for('login'))
    return render_template('admin.html')

@app.route('/users')
def user_view():
    firebase_config = {
        "apiKey": "AIzaSyC-9BvZN4I8hXs_XG2KeJwKtPYGsC_oASI",
        "authDomain": "nnmy-9e611.firebaseapp.com",
        "databaseURL": "https://nnmy-9e611-default-rtdb.firebaseio.com",
        "projectId": "nnmy-9e611",
        "storageBucket": "nnmy-9e611.appspot.com",
        "messagingSenderId": "29564441398",
        "appId": "1:29564441398:web:f1591de3d8316dd1e21997",
        "measurementId": "G-K696L72B3B"
    }
    return render_template('user_view.html', firebase_config=firebase_config)

@app.route('/logout')
def logout():
    session.pop('admin_logged_in', None)
    return redirect(url_for('login'))


# --- API Routes ---
@app.route('/api/users')
def api_get_users():
    users = get_users_sorted()
    return jsonify(users)

@app.route('/add', methods=['POST'])
def add_user():
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    try:
        name = request.form.get('name')
        points = int(request.form.get('points'))
        user_data = ref.child(name).get()
        current_likes = user_data.get('likes', 0) if user_data else 0
        ref.child(name).update({'points': points, 'likes': current_likes})
        
        all_users = get_users_sorted()
        if all_users:
            current_leader = leader_ref.get()
            if not current_leader or current_leader.get('name') != all_users[0]['name']:
                leader_ref.set({'name': all_users[0]['name'], 'timestamp': int(time.time())})
        
        return jsonify(success=True)
    except Exception as e:
        return jsonify(success=False, message=str(e)), 500

@app.route('/delete/<username>', methods=['POST'])
def delete_user(username):
    if 'admin_logged_in' not in session: return jsonify(error="Unauthorized"), 401
    try:
        ref.child(username).delete()
        return jsonify(success=True)
    except Exception as e:
        return jsonify(success=False, message=str(e)), 500

@app.route('/like/<username>', methods=['POST'])
def like_user(username):
    try:
        action = request.form.get('action', 'like')
        user_ref = ref.child(username).child('likes')
        def transaction_update(current_value):
            current_value = current_value or 0
            if action == 'like': return current_value + 1
            elif action == 'unlike' and current_value > 0: return current_value - 1
            return current_value
        user_ref.transaction(transaction_update)
        return jsonify(success=True)
    except Exception as e:
        return jsonify(success=False, message=str(e)), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0')

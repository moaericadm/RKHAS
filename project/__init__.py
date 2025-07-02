# --- START OF FILE project/__init__.py ---
import os
import sys
from flask import Flask, session
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, auth, db
from flask_apscheduler import APScheduler
import random
import time

load_dotenv()

try:
    if not firebase_admin._apps:
        SERVICE_ACCOUNT_FILE = os.getenv('FIREBASE_SERVICE_ACCOUNT')
        FIREBASE_DATABASE_URL = os.getenv('FIREBASE_DATABASE_URL')
        if not SERVICE_ACCOUNT_FILE or not os.path.exists(SERVICE_ACCOUNT_FILE):
            raise ValueError(f"ملف مفتاح الخدمة '{SERVICE_ACCOUNT_FILE}' غير موجود أو المسار خاطئ.")
        creds = credentials.Certificate(SERVICE_ACCOUNT_FILE)
        firebase_admin.initialize_app(creds, {'databaseURL': FIREBASE_DATABASE_URL})
        print(">> Firebase Admin Initialized Successfully!")
except Exception as e:
    print(f"!!! CRITICAL: Firebase Admin initialization failed: {e}", file=sys.stderr)
    sys.exit(1)

scheduler = APScheduler()

def clean_old_notifications():
    """
    هذه الوظيفة تعمل في الخلفية لحذف الإشعارات القديمة من live_feed.
    """
    with scheduler.app.app_context():
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Running Old Notifications Cleaner...")
        feed_ref = db.reference('live_feed')
        
        cutoff_timestamp = int(time.time()) - 60
        
        old_notifications = feed_ref.order_by_child('timestamp').end_at(cutoff_timestamp).get()
        
        if old_notifications:
            updates = {key: None for key in old_notifications.keys()}
            feed_ref.update(updates)
            print(f"Cleaner removed {len(updates)} old notifications.")

def clean_old_nudges():
    """
    هذه الوظيفة تعمل في الخلفية لحذف النكزات القديمة (العامة والخاصة).
    """
    with scheduler.app.app_context():
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Running Old Nudges Cleaner...")
        updates = {}
        cutoff_timestamp = int(time.time()) - 30

        public_nudges_ref = db.reference('public_nudges')
        old_public_nudges = public_nudges_ref.order_by_child('timestamp').end_at(cutoff_timestamp).get()
        if old_public_nudges:
            for key in old_public_nudges:
                updates[f'public_nudges/{key}'] = None
        
        all_user_nudges = db.reference('user_nudges').get()
        if all_user_nudges:
            for user_id, nudges in all_user_nudges.items():
                if 'incoming' in nudges:
                    for nudge_id, nudge_data in nudges['incoming'].items():
                        if nudge_data.get('timestamp', 0) < cutoff_timestamp:
                            updates[f'user_nudges/{user_id}/incoming/{nudge_id}'] = None
        
        if updates:
            db.reference('/').update(updates)
            print(f"Nudge Cleaner removed {len(updates)} old nudges.")


def manage_popularity_contest():
    with scheduler.app.app_context():
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Running Popularity Contest check...")
        contest_ref = db.reference('popularity_contest')
        settings_ref = db.reference('site_settings/contest_settings')
        
        all_crawlers_now = db.reference('users').get() or {}

        settings = settings_ref.get()
        if not settings or not settings.get('is_enabled', False):
            if contest_ref.get(): contest_ref.set(None)
            print("Contest system is disabled. Exiting task.")
            return

        current_contest = contest_ref.get()

        if current_contest and current_contest.get('status') == 'active':
            contestant1_name = current_contest.get('contestant1_name')
            contestant2_name = current_contest.get('contestant2_name')

            if not contestant1_name or not contestant2_name or contestant1_name not in all_crawlers_now or contestant2_name not in all_crawlers_now:
                print(f"Invalid contest found (missing contestant). Cancelling contest between '{contestant1_name}' and '{contestant2_name}'.")
                contest_ref.set(None)
                current_contest = None
            else:
                end_timestamp = current_contest.get('end_timestamp', 0)
                if time.time() >= end_timestamp:
                    print("Contest finished. Processing results...")
                    votes = current_contest.get('votes', {})
                    name1 = current_contest.get('contestant1_name')
                    name2 = current_contest.get('contestant2_name')
                    votes1_count = len(votes.get(name1, {}))
                    votes2_count = len(votes.get(name2, {}))
                    winner_name = None
                    winning_voters = {}
                    if votes1_count > votes2_count:
                        winner_name = name1
                        winning_voters = votes.get(name1, {})
                    elif votes2_count > votes1_count:
                        winner_name = name2
                        winning_voters = votes.get(name2, {})
                    
                    if winner_name:
                        winner_reward = settings.get('winner_points_reward', 0)
                        voter_reward = settings.get('voter_sp_reward', 0)
                        if winner_reward > 0:
                            db.reference(f'users/{winner_name}/points').transaction(lambda p: (p or 0) + winner_reward)
                            print(f"Awarded {winner_reward} points to crawler {winner_name}.")
                        if voter_reward > 0 and winning_voters:
                            for uid in winning_voters.keys():
                                db.reference(f'wallets/{uid}/sp').transaction(lambda sp: (sp or 0) + voter_reward)
                                db.reference(f'user_messages/{uid}').push({
                                    'text': f"🎉 مبروك! لقد فزت بـ {voter_reward} SP لتصويتك للزاحف الفائز '{winner_name}'.",
                                    'timestamp': int(time.time())
                                })
                            print(f"Awarded {voter_reward} SP to {len(winning_voters)} winning voters.")
                    contest_ref.child('status').set('completed')
                    current_contest = None

        if not current_contest:
            print("No active contest found. Starting a new one...")
            if len(all_crawlers_now) >= 2:
                crawler_names = list(all_crawlers_now.keys())
                try:
                    contestants = random.sample(crawler_names, 2)
                    new_contest_data = {
                        'contestant1_name': contestants[0],
                        'contestant2_name': contestants[1],
                        'end_timestamp': int(time.time()) + (24 * 3600),
                        'status': 'active',
                        'votes': {}
                    }
                    contest_ref.set(new_contest_data)
                    print(f"New contest started between '{contestants[0]}' and '{contestants[1]}'.")
                except ValueError:
                    print("Not enough crawlers to start a contest.")
            else:
                print("Not enough users to start a new contest.")


def create_app():
    app = Flask(__name__, instance_relative_config=True, template_folder='../templates', static_folder='../static')
    app.config.from_mapping(
        SECRET_KEY=os.getenv('FLASK_SECRET_KEY', os.urandom(24)),
        JSON_AS_ASCII=False,
        SCHEDULER_API_ENABLED=True 
    )
    
    if not scheduler.running:
        scheduler.init_app(app)
        scheduler.start()
    
    if not scheduler.get_job('manage_contest_job'):
        scheduler.add_job(
            id='manage_contest_job', 
            func=manage_popularity_contest, 
            trigger='interval', 
            minutes=1
        )
        print(">> Popularity Contest management job scheduled.")

    if not scheduler.get_job('clean_notifications_job'):
        scheduler.add_job(
            id='clean_notifications_job', 
            func=clean_old_notifications, 
            trigger='interval', 
            minutes=5
        )
        print(">> Notifications Cleaner job scheduled.")
        
    if not scheduler.get_job('clean_nudges_job'):
        scheduler.add_job(
            id='clean_nudges_job', 
            func=clean_old_nudges, 
            trigger='interval', 
            minutes=1
        )
        print(">> Nudges Cleaner job scheduled.")

    # *** بداية التعديل: تغيير اسم الملف والمسار ***
    from . import auth_routes, views, admin_api, user_interactions_api, spin_wheel_api, stock_prediction_api, rps_pvp_api
    app.register_blueprint(auth_routes.bp, url_prefix='/auth')
    app.register_blueprint(views.bp)
    app.register_blueprint(admin_api.bp, url_prefix='/api/admin')
    app.register_blueprint(user_interactions_api.bp, url_prefix='/api')
    app.register_blueprint(spin_wheel_api.bp, url_prefix='/api/spin_wheel')
    app.register_blueprint(stock_prediction_api.bp, url_prefix='/api/stock_game')
    app.register_blueprint(rps_pvp_api.bp, url_prefix='/api/rps_pvp') # تم تغيير المسار
    # *** نهاية التعديل ***

    @app.after_request
    def apply_coop_header(response):
        response.headers['Cross-Origin-Opener-Policy'] = 'same-origin-allow-popups'
        return response
        
    @app.context_processor
    def inject_firebase_config():
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
        
        context_data = {'firebase_config': firebase_config, 'firebase_token': ""}
        uid_from_session = session.get('user_id')
        if uid_from_session:
            try:
                context_data['firebase_token'] = auth.create_custom_token(uid_from_session).decode('utf-8')
            except Exception as e:
                print(f"!!! CRITICAL: Failed to create custom token for user '{uid_from_session}'. Error: {e}", file=sys.stderr)
        return context_data

    return app
# --- END OF FILE project/__init__.py ---
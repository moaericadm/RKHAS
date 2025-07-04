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
from . import scheduled_tasks

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
    
    # --- بداية التعديل: جدولة المهام عند بدء تشغيل التطبيق ---
    with app.app_context():
        # جدولة المهام الدائمة
        if not scheduler.get_job('manage_contest_job'):
            scheduler.add_job(id='manage_contest_job', func=scheduled_tasks.manage_popularity_contest, trigger='interval', minutes=1, args=[app])
            print(">> Popularity Contest management job scheduled.")

        if not scheduler.get_job('clean_notifications_job'):
            scheduler.add_job(id='clean_notifications_job', func=scheduled_tasks.clean_old_notifications, trigger='interval', minutes=5, args=[app])
            print(">> Notifications Cleaner job scheduled.")
            
        if not scheduler.get_job('clean_nudges_job'):
            scheduler.add_job(id='clean_nudges_job', func=scheduled_tasks.clean_old_nudges, trigger='interval', minutes=1, args=[app])
            print(">> Nudges Cleaner job scheduled.")

        # جدولة حاكم السوق الآلي (SAM) بناءً على الإعدادات المحفوظة
        governor_settings = db.reference('site_settings/market_governor').get() or {}
        if governor_settings.get('enabled', False):
            hours = governor_settings.get('interval_hours', 0)
            minutes = governor_settings.get('interval_minutes', 10)
            seconds = governor_settings.get('interval_seconds', 0)
            total_seconds = (hours * 3600) + (minutes * 60) + seconds
            
            # التأكد من أن القيمة لا تقل عن 10 ثواني
            if total_seconds < 10:
                total_seconds = 600 # قيمة افتراضية آمنة (10 دقائق)

            if not scheduler.get_job('market_justice_job'):
                scheduler.add_job(
                    id='market_justice_job',
                    func=scheduled_tasks.automated_market_balance,
                    trigger='interval',
                    seconds=total_seconds,
                    args=[app]
                )
                print(f">> Automated Market Justice System (SAM) job scheduled from startup to run every {total_seconds} seconds.")
        else:
            print(">> Automated Market Justice System (SAM) is disabled in settings. Job not scheduled.")
    # --- نهاية التعديل ---


    from . import auth_routes, views, admin_api, user_interactions_api, spin_wheel_api, stock_prediction_api, rps_pvp_api
    app.register_blueprint(auth_routes.bp, url_prefix='/auth')
    app.register_blueprint(views.bp)
    app.register_blueprint(admin_api.bp, url_prefix='/api/admin')
    app.register_blueprint(user_interactions_api.bp, url_prefix='/api')
    app.register_blueprint(spin_wheel_api.bp, url_prefix='/api/spin_wheel')
    app.register_blueprint(stock_prediction_api.bp, url_prefix='/api/stock_game')
    app.register_blueprint(rps_pvp_api.bp, url_prefix='/api/rps_pvp')

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
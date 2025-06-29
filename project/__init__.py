import os
import sys
from flask import Flask, session
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, auth, db

# <<< بداية الإضافة: استيراد المكتبات اللازمة للمجدول >>>
from flask_apscheduler import APScheduler
import random
import time
# <<< نهاية الإضافة >>>


# --- الخطوة 1: تحميل متغيرات البيئة ---
load_dotenv()

# --- الخطوة 2: تهيئة Firebase خارج الدالة لضمان تنفيذها مرة واحدة ---
try:
    if not firebase_admin._apps:
        SERVICE_ACCOUNT_FILE = os.getenv('FIREBASE_SERVICE_ACCOUNT')
        FIREBASE_DATABASE_URL = os.getenv('FIREBASE_DATABASE_URL')
        
        if not SERVICE_ACCOUNT_FILE or not os.path.exists(SERVICE_ACCOUNT_FILE):
            raise ValueError(f"ملف مفتاح الخدمة '{SERVICE_ACCOUNT_FILE}' غير موجود أو المسار خاطئ.")
            
        creds = credentials.Certificate(SERVICE_ACCOUNT_FILE)
        
        firebase_admin.initialize_app(creds, {
            'databaseURL': FIREBASE_DATABASE_URL
        })
        print(">> Firebase Admin Initialized Successfully!")

except Exception as e:
    print(f"!!! CRITICAL: Firebase Admin initialization failed: {e}", file=sys.stderr)
    sys.exit(1)

# <<< بداية الإضافة: تهيئة المجدول الزمني >>>
scheduler = APScheduler()
# <<< نهاية الإضافة >>>

# <<< بداية الإضافة: الدالة الأساسية لإدارة المنافسة >>>
def manage_popularity_contest():
    """
    هذه الوظيفة تعمل في الخلفية للتحقق من حالة منافسة الشعبية.
    إذا انتهت، توزع الجوائز وتبدأ واحدة جديدة.
    """
    # استخدام سياق التطبيق للوصول إلى خدمات Flask وقاعدة البيانات
    with scheduler.app.app_context():
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Running Popularity Contest check...")

        contest_ref = db.reference('popularity_contest')
        settings_ref = db.reference('site_settings/contest_settings')
        
        settings = settings_ref.get()
        if not settings or not settings.get('is_enabled', False):
            print("Contest system is disabled. Exiting task.")
            return

        current_contest = contest_ref.get()

        # إذا كانت هناك منافسة حالية، تحقق مما إذا انتهت
        if current_contest and current_contest.get('status') == 'active':
            end_timestamp = current_contest.get('end_timestamp', 0)
            if time.time() >= end_timestamp:
                print("Contest finished. Processing results...")
                # --- توزيع الجوائز ---
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

                    # 1. جائزة الزاحف الفائز (نقاط)
                    if winner_reward > 0:
                        db.reference(f'users/{winner_name}/points').transaction(lambda p: (p or 0) + winner_reward)
                        print(f"Awarded {winner_reward} points to crawler {winner_name}.")
                    
                    # 2. جائزة المصوتين (SP)
                    if voter_reward > 0 and winning_voters:
                        for uid in winning_voters.keys():
                            db.reference(f'wallets/{uid}/sp').transaction(lambda sp: (sp or 0) + voter_reward)
                            db.reference(f'user_messages/{uid}').push({
                                'text': f"🎉 مبروك! لقد فزت بـ {voter_reward} SP لتصويتك للزاحف الفائز '{winner_name}'.",
                                'timestamp': int(time.time())
                            })
                        print(f"Awarded {voter_reward} SP to {len(winning_voters)} winning voters.")

                # تحديث حالة المنافسة إلى منتهية
                contest_ref.child('status').set('completed')
                current_contest = None # تجهيز لبدء منافسة جديدة

        # إذا لم تكن هناك منافسة نشطة، ابدأ واحدة جديدة
        if not current_contest:
            print("No active contest found. Starting a new one...")
            all_crawlers_ref = db.reference('users')
            all_crawlers = all_crawlers_ref.get()
            
            if all_crawlers and len(all_crawlers) >= 2:
                crawler_names = list(all_crawlers.keys())
                
                # اختيار زاحفين بشكل عشوائي
                try:
                    contestants = random.sample(crawler_names, 2)
                    
                    new_contest_data = {
                        'contestant1_name': contestants[0],
                        'contestant2_name': contestants[1],
                        'end_timestamp': int(time.time()) + (24 * 3600), # 24 ساعة
                        'status': 'active',
                        'votes': {}
                    }
                    contest_ref.set(new_contest_data)
                    print(f"New contest started between '{contestants[0]}' and '{contestants[1]}'.")
                except ValueError:
                    print("Not enough crawlers to start a contest.") # في حال كان عدد الزواحف أقل من 2

            else:
                print("Not enough users to start a new contest.")
# <<< نهاية الإضافة >>>


def create_app():
    """
    الدالة المسؤولة عن إنشاء وتهيئة تطبيق فلاسك.
    """
    app = Flask(__name__, instance_relative_config=True, template_folder='../templates', static_folder='../static')

    # --- تحميل الإعدادات الأساسية للتطبيق ---
    app.config.from_mapping(
        SECRET_KEY=os.getenv('FLASK_SECRET_KEY', os.urandom(24)),
        JSON_AS_ASCII=False,
        # <<< بداية الإضافة: إعدادات المجدول >>>
        SCHEDULER_API_ENABLED=True 
        # <<< نهاية الإضافة >>>
    )
    
    # <<< بداية الإضافة: بدء تشغيل المجدول وتسجيل الوظيفة >>>
    if not scheduler.running:
        scheduler.init_app(app)
        scheduler.start()
    
    # التأكد من عدم إضافة الوظيفة أكثر من مرة عند إعادة تحميل الخادم
    if not scheduler.get_job('manage_contest_job'):
        scheduler.add_job(
            id='manage_contest_job', 
            func=manage_popularity_contest, 
            trigger='interval', 
            minutes=1 # يعمل كل دقيقة للفحص
        )
        print(">> Popularity Contest management job scheduled.")
    # <<< نهاية الإضافة >>>


    # --- استيراد جميع المخططات ---
    from . import auth_routes
    from . import views
    from . import admin_api
    from . import user_interactions_api
    from . import spin_wheel_api
    
    # <<< --- هذا هو التصحيح الجذري: تسجيل المخططات مع البادئة هنا --- >>>
    app.register_blueprint(auth_routes.bp, url_prefix='/auth')
    app.register_blueprint(views.bp) # لا يحتاج بادئة
    app.register_blueprint(admin_api.bp, url_prefix='/api/admin')
    app.register_blueprint(user_interactions_api.bp, url_prefix='/api')
    app.register_blueprint(spin_wheel_api.bp, url_prefix='/api/spin_wheel')

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
        
        context_data = {
            'firebase_config': firebase_config,
            'firebase_token': "",
            'current_user_id': None,
            'current_user_name': None
        }

        uid_from_session = session.get('user_id')
        if uid_from_session:
            context_data['current_user_id'] = uid_from_session
            context_data['current_user_name'] = session.get('name')
            try:
                token_bytes = auth.create_custom_token(uid_from_session)
                context_data['firebase_token'] = token_bytes.decode('utf-8')
            except Exception as e:
                print(f"!!! CRITICAL: Failed to create custom token for user '{uid_from_session}'. Error: {e}", file=sys.stderr)
        
        return context_data

    return app
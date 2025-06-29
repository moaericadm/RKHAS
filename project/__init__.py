

# --- START OF FILE project/__init__.py ---

import os
import sys
from flask import Flask, session
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, auth, db

# --- الخطوة 1: تحميل متغيرات البيئة ---
load_dotenv()

# --- الخطوة 2: تهيئة Firebase خارج الدالة لضمان تنفيذها مرة واحدة ---
# هذا هو المكان الصحيح للتهيئة
try:
    if not firebase_admin._apps:
        SERVICE_ACCOUNT_FILE = os.getenv('FIREBASE_SERVICE_ACCOUNT')
        FIREBASE_DATABASE_URL = os.getenv('FIREBASE_DATABASE_URL')
        
        if not SERVICE_ACCOUNT_FILE or not os.path.exists(SERVICE_ACCOUNT_FILE):
            raise ValueError(f"ملف مفتاح الخدمة '{SERVICE_ACCOUNT_FILE}' غير موجود أو المسار خاطئ.")
            
        cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
        
        # <<< التعديل هنا: تمت إزالة storageBucket لأننا سنستخدم Google Drive >>>
        firebase_admin.initialize_app(cred, {
            'databaseURL': FIREBASE_DATABASE_URL
        })
        print(">> Firebase Admin Initialized Successfully!")

except Exception as e:
    print(f"!!! CRITICAL: Firebase Admin initialization failed: {e}", file=sys.stderr)
    sys.exit(1)


def create_app():
    """
    الدالة المسؤولة عن إنشاء وتهيئة تطبيق فلاسك.
    """
    app = Flask(__name__, instance_relative_config=True, template_folder='../templates', static_folder='../static')

    # --- تحميل الإعدادات الأساسية للتطبيق ---
    app.config.from_mapping(
        SECRET_KEY=os.getenv('FLASK_SECRET_KEY', os.urandom(24)),
        JSON_AS_ASCII=False
    )
    
    # --- تسجيل الوحدات (Blueprints) ---
    from . import auth_routes
    from . import views
    from . import admin_api
    from . import user_interactions_api
    from . import spin_wheel_api
    
    # <<<  هذا هو الحل المطلوب >>>
    # أضفنا url_prefix='/auth' لجعل جميع مسارات المصادقة تبدأ بـ /auth
    app.register_blueprint(auth_routes.bp, url_prefix='/auth') 
    # <<< نهاية الحل >>>
    
    app.register_blueprint(views.bp)
    app.register_blueprint(admin_api.bp)
    app.register_blueprint(user_interactions_api.bp)
    app.register_blueprint(spin_wheel_api.bp)

    # ***  هذا هو الحل لمشكلة النافذة المنبثقة لجوجل  ***
    # --- إضافة ترويسة الأمان للسماح بالنوافذ المنبثقة من Google ---
    @app.after_request
    def apply_coop_header(response):
        response.headers['Cross-Origin-Opener-Policy'] = 'same-origin-allow-popups'
        return response
        
    # --- جعل إعدادات Firebase والبيانات العامة متاحة لكل القوالب (Templates) ---
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

        if 'user_id' in session:
            context_data['current_user_id'] = session['user_id']
            context_data['current_user_name'] = session.get('name')
            try:
                # التأكد من أن UID ليس فارغاً قبل إنشاء التوكن
                if session['user_id']:
                    token_bytes = auth.create_custom_token(session['user_id'])
                    context_data['firebase_token'] = token_bytes.decode('utf-8')
            except Exception as e:
                print(f"!!! CRITICAL: Failed to create custom token for user '{session['user_id']}'. Error: {e}", file=sys.stderr)
        
        return context_data

    return app

# --- END OF FILE project/__init__.py ---

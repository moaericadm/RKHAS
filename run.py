import os
from project import create_app, scheduler # <<< تعديل: استيراد المجدول

# --- بداية التعديل: العودة إلى النمط الأصلي مع إضافة use_reloader=False ---
app = create_app()

# This is the entry point for running the application
if __name__ == '__main__':
    # Get port from environment variables or default to 5000
    port = int(os.environ.get("PORT", 5000))
    # Run the app. 
    # use_reloader=False مهم جداً لمنع تشغيل المجدول مرتين في وضع التصحيح
    app.run(host='0.0.0.0', port=port, debug=True, use_reloader=False)
# --- نهاية التعديل ---
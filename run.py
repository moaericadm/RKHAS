import os
from project import create_app

# إنشاء نسخة من التطبيق باستخدام الدالة التي صنعناها
app = create_app()

# هذا الجزء مخصص لتشغيل التطبيق
if __name__ == '__main__':
    # الحصول على رقم البورت من متغيرات البيئة أو استخدام 5000 كقيمة افتراضية
    port = int(os.environ.get("PORT", 5000))
    # تشغيل التطبيق
    # debug=False مناسب للبيئة الإنتاجية (Production)
    app.run(host='0.0.0.0', port=port, debug=False)
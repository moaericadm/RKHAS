# --- START OF FILE project/views.py ---
from flask import (
    Blueprint, render_template, redirect, url_for, session
)
# *** التعديل: استيراد الوحدات الفرعية المطلوبة فقط ***
from firebase_admin import db
from .auth_routes import login_required, admin_required

bp = Blueprint('views', __name__)

@bp.route('/')
def home():
    """
    المسار الرئيسي للموقع.
    يقوم بتوجيه المستخدم بناءً على حالته (مسجل دخوله أم لا) ودوره (أدمن أم مستخدم).
    """
    if 'user_id' in session:
        if session.get('role') == 'admin':
            return redirect(url_for('views.admin_panel'))
        return redirect(url_for('views.user_view')) 
    return redirect(url_for('auth.login_page'))


@bp.route('/dashboard')
@login_required
def dashboard_page():
    """
    صفحة لوحة التحكم العامة للمستخدم (لم تعد تستخدم مباشرة ولكن من الجيد إبقاؤها).
    """
    ref_registered_users = db.reference('registered_users/')
    
    user_info = ref_registered_users.child(session['user_id']).get()
    if not user_info:
        session.clear()
        return redirect(url_for('auth.login_page'))
    
    return render_template('dashboard.html', user=user_info)


@bp.route('/admin')
@admin_required
def admin_panel():
    """
    صفحة لوحة تحكم الأدمن.
    """
    return render_template('admin.html')


@bp.route('/users')
@login_required
def user_view():
    """
    صفحة عرض قائمة الزواحف (سوق الاستثمار).
    """
    return render_template('user_view.html')

@bp.route('/shop')
@login_required
def shop_page():
    """
    صفحة المتجر لشراء نقاط الدعم (SP) عبر منتجات محددة.
    """
    return render_template('shop.html')

@bp.route('/guide')
@login_required
def guide_page():
    """
    صفحة دليل الاستخدام وشرح النظام الاقتصادي.
    """
    return render_template('guide.html')
# --- END OF FILE project/views.py ---
# --- START OF FILE project/user_interactions_api.py ---
import time
import re
import sys
from datetime import datetime, timedelta
from flask import (
    Blueprint, request, jsonify, session
)
from firebase_admin import db
from .utils import login_required

bp = Blueprint('user_interactions_api', __name__)

BANNED_WORDS_PATTERN = re.compile(
    r'\b(' + '|'.join(re.escape(word) for word in [
        "منيك", "شرموطة", "بتنتاك", "بنيك", "كس اختك", "كسختك", "امك", "اختك"
    ]) + r')\b', re.IGNORECASE
)

def is_abusive(text):
    return bool(BANNED_WORDS_PATTERN.search(text)) if text else False

def _log_public_notification(text):
    """
    دالة مساعدة لبث إشعار عام ومؤقت.
    تمنع تسجيل نشاطات الأدمن.
    """
    # التحقق من أن المستخدم ليس أدمن
    if session.get('role') == 'admin':
        return

    user_id = session.get('user_id')
    user_name = session.get('name')
    if not all([user_id, user_name]):
        return
    
    try:
        user_avatar = db.reference(f'registered_users/{user_id}/current_avatar').get()
        # استخدام المسار المؤقت الجديد للإشعارات
        notification_ref = db.reference('live_feed')
        notification_ref.push({
            'user_id': user_id,
            'user_name': user_name,
            'user_avatar': user_avatar or '',
            'text': text,
            'timestamp': int(time.time())
        })
    except Exception as e:
        print(f"!!! Live Feed Broadcast Error: {e}", file=sys.stderr)


@bp.route('/contest/vote', methods=['POST'])
@login_required
def vote_in_contest():
    user_id = session.get('user_id')
    user_name = session.get('name')
    voted_for = request.form.get('voted_for_name')

    if not voted_for:
        return jsonify(success=False, message="اسم المتنافس مطلوب للتصويت."), 400

    contest_ref = db.reference('popularity_contest')
    contest_data = contest_ref.get()

    if not contest_data or contest_data.get('status') != 'active':
        return jsonify(success=False, message="لا توجد منافسة نشطة حالياً."), 403

    if voted_for not in [contest_data.get('contestant1_name'), contest_data.get('contestant2_name')]:
        return jsonify(success=False, message="لا يمكنك التصويت لزاحف ليس في المنافسة الحالية."), 400

    if (contest_ref.child(f"votes/{contest_data.get('contestant1_name')}/{user_id}").get() or
            contest_ref.child(f"votes/{contest_data.get('contestant2_name')}/{user_id}").get()):
        return jsonify(success=False, message="لقد قمت بالتصويت في هذه المنافسة بالفعل."), 409
    
    try:
        contest_ref.child(f"votes/{voted_for}/{user_id}").set(True)
        _log_public_notification(f"صوّت لـِ '{voted_for}' في منافسة الشعبية.")
        return jsonify(success=True, message="تم تسجيل صوتك بنجاح!")
    except Exception as e:
        print(f"!!! Contest Vote Error for user {user_id}: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء تسجيل صوتك."), 500

@bp.route('/shop/buy_product', methods=['POST'])
@login_required
def buy_shop_product():
    user_id = session.get('user_id')
    product_id = request.form.get('product_id')
    if not product_id: return jsonify(success=False, message="معرف المنتج مفقود."), 400
    product = db.reference(f'site_settings/shop_products/{product_id}').get()
    if not product: return jsonify(success=False, message="المنتج غير موجود أو تم حذفه."), 404
    cc_price = product.get('cc_price', 0)
    sp_amount = product.get('sp_amount', 0)
    if not isinstance(cc_price, int) or not isinstance(sp_amount, int) or cc_price <= 0 or sp_amount <= 0:
        return jsonify(success=False, message="بيانات المنتج غير صالحة."), 500
    user_wallet_ref = db.reference(f'wallets/{user_id}')
    try:
        def transact_purchase(current_wallet_data):
            wallet = current_wallet_data or {'cc': 0, 'sp': 0}
            if wallet.get('cc', 0) < cc_price:
                raise ValueError("رصيد CC غير كافٍ لإتمام عملية الشراء.")
            wallet['cc'] -= cc_price
            wallet['sp'] = wallet.get('sp', 0) + sp_amount
            return wallet
        user_wallet_ref.transaction(transact_purchase)
        _log_public_notification(f"اشترى {sp_amount:,} SP من المتجر.")
        return jsonify(success=True, message=f"تم بنجاح شراء {sp_amount:,} SP!")
    except ValueError as e:
        return jsonify(success=False, message=str(e)), 400
    except Exception as e:
        print(f"!!! Product Purchase Error for user {user_id}: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء الشراء."), 500

@bp.route('/shop/buy_spin_attempt', methods=['POST'])
@login_required
def buy_spin_attempt():
    user_id = session.get('user_id'); product_id = request.form.get('product_id')
    if not product_id: return jsonify(success=False, message="معرف المنتج مفقود."), 400
    product = db.reference(f'site_settings/shop_products_spins/{product_id}').get()
    if not product: return jsonify(success=False, message="المنتج غير موجود أو تم حذفه."), 404
    sp_price = product.get('sp_price', 0); attempts_to_add = product.get('attempts_amount', 0)
    if not isinstance(sp_price, int) or not isinstance(attempts_to_add, int) or sp_price <= 0 or attempts_to_add <= 0:
        return jsonify(success=False, message="بيانات المنتج غير صالحة."), 500
    spin_settings = db.reference('site_settings/spin_wheel_settings').get() or {}
    purchase_limit = spin_settings.get('purchaseLimit', 20)
    try:
        wallet_ref = db.reference(f'wallets/{user_id}'); user_spin_state_ref = db.reference(f'user_spin_state/{user_id}')
        current_wallet_sp = (wallet_ref.child('sp').get() or 0)
        if current_wallet_sp < sp_price:
            return jsonify(success=False, message="رصيد SP غير كافٍ لإتمام عملية الشراء."), 400
        current_purchased_attempts = (user_spin_state_ref.child('purchasedAttempts').get() or 0)
        if current_purchased_attempts + attempts_to_add > purchase_limit:
            return jsonify(success=False, message=f"لا يمكنك شراء المزيد. الحد الأقصى للمحاولات المشتراة هو {purchase_limit} محاولة."), 403
        wallet_ref.child('sp').set(current_wallet_sp - sp_price)
        user_spin_state_ref.child('purchasedAttempts').transaction(lambda current: (current or 0) + attempts_to_add)
        _log_public_notification(f"اشترى {attempts_to_add} محاولة/محاولات إضافية لعجلة الحظ.")
        return jsonify(success=True, message=f"تم بنجاح شراء {attempts_to_add} محاولة دوران إضافية!")
    except Exception as e:
        print(f"!!! Atomic Spin Purchase Error for user {user_id}: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء الشراء."), 500

@bp.route('/shop/buy_points_product', methods=['POST'])
@login_required
def buy_points_product():
    user_id, user_name = session['user_id'], session.get('name', 'مستخدم')
    product_id = request.form.get('product_id')
    target_crawler_name = request.form.get('target_crawler')
    
    if not all([product_id, target_crawler_name]): 
        return jsonify(success=False, message="البيانات المطلوبة غير مكتملة."), 400

    try:
        product = db.reference(f'site_settings/shop_products_points/{product_id}').get()
        target_crawler_ref = db.reference(f'users/{target_crawler_name}')
        
        if not product: 
            return jsonify(success=False, message="المنتج المحدد غير موجود."), 404
        if not target_crawler_ref.get(): 
            return jsonify(success=False, message="الزاحف المستهدف غير موجود."), 404
            
        sp_price = product.get('sp_price', 0)
        daily_limit = product.get('daily_limit', 1)
        today_str = datetime.now().strftime('%Y-%m-%d')
        limit_ref = db.reference(f'user_daily_limits/{user_id}/{product_id}')
        
        limit_data = limit_ref.get() or {}
        current_count = limit_data.get('count', 0) if limit_data.get('date') == today_str else 0
        
        if current_count >= daily_limit: 
            return jsonify(success=False, message=f"لقد استهلكت الحد اليومي لهذا المنتج ({daily_limit} مرة)."), 403
            
        wallet_ref = db.reference(f'wallets/{user_id}')
        current_sp = (wallet_ref.get() or {}).get('sp', 0)
        
        if current_sp < sp_price: 
            return jsonify(success=False, message="رصيد SP لديك غير كافٍ."), 400
            
        points_change = product.get('points_amount', 0) * (-1 if product.get('type') == 'drop' else 1)
        
        wallet_ref.child('sp').set(current_sp - sp_price)
        
        target_crawler_ref.child('points').transaction(lambda p: max(0, (p or 0) + points_change))
        
        limit_ref.set({'count': current_count + 1, 'date': today_str})
        
        log_type = 'item_effect_raise' if product.get('type') == 'raise' else 'item_effect_drop'
        db.reference('activity_log').push({
            'type': log_type, 
            'text': f"'{user_name}' أثر على '{target_crawler_name}' بـ{abs(points_change):,} نقطة.",
            'timestamp': int(time.time()),
            'user_id': user_id, 
            'user_name': user_name
        })
        
        action_text = "رفع أسهم" if product.get('type') == 'raise' else "أسقط أسهم"
        _log_public_notification(f"{action_text} '{target_crawler_name}'.")
        
        return jsonify(success=True, message="تمت العملية بنجاح!")
        
    except Exception as e:
        print(f"!!! Buy Points Product Error for user {user_id}: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم."), 500


@bp.route('/like/<username>', methods=['POST'])
@login_required 
def like_user(username):
    user_to_like_ref = db.reference(f'users/{username}')
    if not user_to_like_ref.get():
        return jsonify(success=False, message="لا يمكن الإعجاب بزاحف غير موجود في القائمة."), 404

    amount = 1 if request.args.get('action', 'like') == 'like' else -1
    user_to_like_ref.child('likes').transaction(lambda current: (current or 0) + amount)
    
    if amount > 0:
        db.reference('activity_log').push({
            'type': 'like', 
            'text': f"'{session.get('name')}' أعجب بـ '{username}'", 
            'timestamp': int(time.time()), 
            'user_id': session.get('user_id'), 
            'user_name': session.get('name')
        })
        _log_public_notification(f"أبدى إعجابه بـ '{username}'.")

    return jsonify(success=True)


@bp.route('/nominate', methods=['POST'])
@login_required
def nominate_user():
    name = request.form.get('name', '').strip()
    if not name: return jsonify(success=False, message="الاسم مطلوب للترشيح."), 400
    if is_abusive(name): return jsonify(success=False, message="الرجاء استخدام كلمات لائقة."), 403
    db.reference('activity_log').push({
        'type': 'nomination',
        'text': f"طلب ترشيح من '{session.get('name')}' لإضافة: '{name}'",
        'timestamp': int(time.time()),
        'user_id': session.get('user_id'),
        'user_name': session.get('name')
    })
    return jsonify(success=True, message="تم إرسال طلب الترشيح بنجاح للمراجعة!")

@bp.route('/report', methods=['POST'])
@login_required
def report_user():
    reason = request.form.get('reason', '').strip(); reported_user = request.form.get('reported_user', '').strip()
    if not all([reason, reported_user]): return jsonify(success=False, message="يجب اختيار زاحف وذكر السبب."), 400
    if is_abusive(reason) or is_abusive(reported_user): return jsonify(success=False, message="الرجاء استخدام كلمات لائقة."), 403
    db.reference('activity_log').push({'type': 'report', 'text': f"بلاغ من '{session.get('name')}' ضد '{reported_user}': {reason}", 'timestamp': int(time.time()), 'user_id': session.get('user_id'), 'user_name': session.get('name')})
    return jsonify(success=True, message=f"تم إرسال بلاغك بخصوص {reported_user}. شكراً لك.")

@bp.route('/user_history/<username>')
@login_required
def get_user_history(username):
    history = db.reference(f'points_history/{username}').get() or {}
    history_list = list(history.values())
    if not history_list:
        points = (db.reference(f'users/{username}').get() or {}).get('points', 0)
        now = int(time.time())
        return jsonify([{'timestamp': now - 86400, 'points': points}, {'timestamp': now, 'points': points}])
    if len(history_list) == 1:
        history_list.insert(0, {'points': history_list[0]['points'], 'timestamp': history_list[0]['timestamp'] - 86400})
    return jsonify(sorted(history_list, key=lambda x: x.get('timestamp', 0)))

@bp.route('/invest', methods=['POST'])
@login_required
def invest_in_crawler():
    user_id, user_name = session.get('user_id'), session.get('name')
    crawler_name = request.form.get('crawler_name')
    try:
        sp_to_invest = float(request.form.get('sp_amount'))
    except (ValueError, TypeError):
        return jsonify(success=False, message="كمية SP غير صالحة."), 400

    if sp_to_invest <= 0:
        return jsonify(success=False, message="يجب استثمار كمية موجبة."), 400

    settings = db.reference('site_settings/investment_settings').get() or {}
    max_investments = settings.get('max_investments')
    
    investment_ref = db.reference(f'investments/{user_id}/{crawler_name}')
    current_user_investments = db.reference(f'investments/{user_id}').get()
    
    is_new_investment = not bool(current_user_investments and crawler_name in current_user_investments)

    if is_new_investment and max_investments and max_investments > 0:
        num_current_investments = len(current_user_investments.keys()) if current_user_investments else 0
        if num_current_investments >= max_investments:
            return jsonify(success=False, message=f"لقد وصلت للحد الأقصى وهو {max_investments} استثمارات مختلفة. لا يمكنك الاستثمار في زاحف جديد."), 403

    crawler_data = db.reference(f'users/{crawler_name}').get()
    if not crawler_data:
        return jsonify(success=False, message="هذا الزاحف غير موجود."), 404

    wallet_ref = db.reference(f'wallets/{user_id}')
    current_sp = (wallet_ref.get() or {}).get('sp', 0)
    if current_sp < sp_to_invest:
        return jsonify(success=False, message="رصيد SP غير كافٍ للاستثمار."), 400

    new_sp_balance = current_sp - sp_to_invest
    wallet_ref.child('sp').set(new_sp_balance)
    
    investment_data = investment_ref.get()
    points_at_investment = crawler_data.get('points', 0)
    now = int(time.time())

    if investment_data: 
        total_sp = investment_data.get('invested_sp', 0) + sp_to_invest
        old_val = investment_data.get('invested_sp', 0) * investment_data.get('points_at_investment', 0)
        new_val = sp_to_invest * points_at_investment
        avg_points = (old_val + new_val) / total_sp if total_sp > 0 else points_at_investment
        investment_ref.update({'invested_sp': total_sp, 'points_at_investment': round(avg_points), 'last_updated_timestamp': now})
        _log_public_notification(f"عزّز استثماره في '{crawler_name}' بمبلغ {sp_to_invest:,.2f} SP.")
    else:
        investment_ref.set({'invested_sp': sp_to_invest, 'points_at_investment': points_at_investment, 'timestamp': now, 'last_updated_timestamp': now})
        _log_public_notification(f"استثمر في '{crawler_name}' بمبلغ {sp_to_invest:,.2f} SP.")
    
    db.reference('investment_log').push({'investor_id': user_id, 'investor_name': user_name, 'target_name': crawler_name, 'action': 'invest', 'sp_amount': sp_to_invest, 'timestamp': now})
    
    return jsonify(success=True, message=f"تم استثمار {sp_to_invest:,.2f} SP بنجاح في {crawler_name}!")


@bp.route('/sell', methods=['POST'])
@login_required
def sell_investment():
    user_id, user_name = session.get('user_id'), session.get('name')
    crawler_name = request.form.get('crawler_name')
    if not crawler_name: return jsonify(success=False, message="اسم الزاحف مطلوب."), 400
    
    investment_ref = db.reference(f'investments/{user_id}/{crawler_name}')
    investment_data = investment_ref.get()
    if not investment_data: return jsonify(success=False, message="ليس لديك استثمار في هذا الزاحف."), 404

    settings = db.reference('site_settings/investment_settings').get() or {}
    lock_hours = settings.get('investment_lock_hours', 0)
    
    if lock_hours > 0:
        last_updated_timestamp = investment_data.get('last_updated_timestamp') or investment_data.get('timestamp', 0)
        now = int(time.time())
        lock_seconds = lock_hours * 3600
        
        time_elapsed = now - last_updated_timestamp
        
        if time_elapsed < lock_seconds:
            time_remaining = lock_seconds - time_elapsed
            hours, remainder = divmod(time_remaining, 3600)
            minutes, _ = divmod(remainder, 60)
            return jsonify(success=False, message=f"لا يمكنك بيع استثمارك الآن. يجب الانتظار لمدة {int(hours)} ساعة و {int(minutes)} دقيقة إضافية."), 403

    crawler_data = db.reference(f'users/{crawler_name}').get()
    
    invested_sp = float(investment_data.get('invested_sp', 0))
    points_at_inv = float(investment_data.get('points_at_investment', 1)) or 1
    
    current_points = float(crawler_data.get('points', 0)) if crawler_data else points_at_inv
    stock_multiplier = float(crawler_data.get('stock_multiplier', 1.0)) if crawler_data else 1.0
    
    sp_to_return = invested_sp * (current_points / points_at_inv) * stock_multiplier
    sp_to_return = max(0, sp_to_return)
    
    try:
        db.reference(f'wallets/{user_id}/sp').transaction(lambda current_sp: (current_sp or 0) + sp_to_return)
        investment_ref.delete()
        db.reference('investment_log').push({
            'investor_id': user_id, 'investor_name': user_name, 
            'target_name': crawler_name, 'action': 'sell', 
            'sp_amount': sp_to_return, 'timestamp': int(time.time())
        })
        _log_public_notification(f"باع أسهمه في '{crawler_name}' مقابل {sp_to_return:,.2f} SP.")
        return jsonify(success=True, message=f"تم بيع الاستثمار بنجاح! لقد حصلت على {sp_to_return:.2f} SP.")
    except Exception as e:
        print(f"!!! Sell Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء البيع."), 500

@bp.route('/shop/buy_avatar', methods=['POST'])
@login_required
def buy_avatar():
    user_id = session.get('user_id')
    avatar_id = request.form.get('avatar_id')
    if not avatar_id:
        return jsonify(success=False, message="معرّف الأفاتار مفقود."), 400
    avatar_ref = db.reference(f'site_settings/shop_avatars/{avatar_id}')
    avatar_data = avatar_ref.get()
    if not avatar_data:
        return jsonify(success=False, message="الأفاتار المحدد غير موجود أو تم حذفه."), 404
    user_avatar_ref = db.reference(f'user_avatars/{user_id}/owned/{avatar_id}')
    if user_avatar_ref.get():
        return jsonify(success=False, message="أنت تمتلك هذا الأفاتار بالفعل."), 400
    price_sp = avatar_data.get('price_sp_personal', 0)
    wallet_ref = db.reference(f'wallets/{user_id}')
    try:
        def transact_avatar_purchase(current_sp):
            if (current_sp or 0) < price_sp:
                raise ValueError("رصيد SP غير كافٍ لإتمام عملية الشراء.")
            return current_sp - price_sp
        wallet_ref.child('sp').transaction(transact_avatar_purchase)
        user_avatar_ref.set({'purchased_at': int(time.time())})
        
        log_text = f"اشترى أفاتار '{avatar_data.get('name')}'."
        db.reference('activity_log').push({
            'type': 'purchase',
            'text': f"'{session.get('name')}' {log_text}",
            'timestamp': int(time.time()),
            'user_id': user_id,
            'user_name': session.get('name')
        })
        _log_public_notification(log_text)
        return jsonify(success=True, message=f"تم شراء أفاتار '{avatar_data.get('name')}' بنجاح!")
    except ValueError as e:
        return jsonify(success=False, message=str(e)), 400
    except Exception as e:
        print(f"!!! Avatar Purchase Error for user {user_id}: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء الشراء."), 500

@bp.route('/user/set_avatar', methods=['POST'])
@login_required
def set_user_avatar():
    user_id = session.get('user_id')
    user_name = session.get('name')
    avatar_id = request.form.get('avatar_id')

    if not avatar_id:
        return jsonify(success=False, message="معرّف الأفاتار مفقود."), 400

    if not db.reference(f'user_avatars/{user_id}/owned/{avatar_id}').get():
        return jsonify(success=False, message="أنت لا تمتلك هذا الأفاتار."), 403
    
    avatar_image_url = db.reference(f'site_settings/shop_avatars/{avatar_id}/image_url').get()
    if not avatar_image_url:
        return jsonify(success=False, message="لم يتم العثور على صورة الأفاتار."), 404

    try:
        db.reference(f'registered_users/{user_id}').update({'current_avatar': avatar_image_url})
        if db.reference(f'users/{user_name}').get():
            db.reference(f'users/{user_name}').update({'avatar_url': avatar_image_url})
        return jsonify(success=True, message="تم تغيير الأفاتار بنجاح!")
    except Exception as e:
        print(f"!!! Set Avatar Error for user {user_id}: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم."), 500

@bp.route('/gift_request', methods=['POST'])
@login_required
def submit_gift_request():
    try:
        gifter_id = session.get('user_id')
        gifter_name = session.get('name')
        avatar_id = request.form.get('avatar_id')
        target_name = request.form.get('target_crawler')

        if not all([gifter_id, gifter_name, avatar_id, target_name]):
            return jsonify(success=False, message="بيانات الطلب غير مكتملة."), 400

        if gifter_name.lower() == target_name.lower():
            return jsonify(success=False, message="لا يمكنك إهداء نفسك."), 400
        
        avatar_data = db.reference(f'site_settings/shop_avatars/{avatar_id}').get()
        if not avatar_data: 
            return jsonify(success=False, message="الأفاتار المحدد غير موجود."), 404

        target_crawler_ref = db.reference(f'users/{target_name}')
        if not target_crawler_ref.get():
            return jsonify(success=False, message=f"لا يمكن العثور على زاحف بالاسم '{target_name}' في القائمة."), 404
        
        price_sp_gift = avatar_data.get('price_sp_gift', 0)
        gifter_wallet_sp = (db.reference(f'wallets/{gifter_id}/sp').get() or 0)

        if gifter_wallet_sp < price_sp_gift:
            return jsonify(success=False, message=f"رصيدك من SP غير كافٍ. تحتاج إلى {price_sp_gift} SP."), 400
        
        new_request_ref = db.reference('gift_requests').push()
        new_request_ref.set({
            'gifter_id': gifter_id,
            'gifter_name': gifter_name,
            'target_user_name': target_name, 
            'avatar_id': avatar_id,
            'avatar_name': avatar_data.get('name'),
            'avatar_image_url': avatar_data.get('image_url'),
            'price_sp': price_sp_gift,
            'timestamp': int(time.time()),
            'status': 'pending'
        })
        
        return jsonify(success=True, message="تم إرسال طلب الإهداء بنجاح! ستتم مراجعته من قبل الإدارة.")

    except Exception as e:
        print(f"!!! CRITICAL: Submit Gift Request Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ كارثي في الخادم أثناء تقديم الطلب."), 500
# --- END OF FILE project/user_interactions_api.py ---
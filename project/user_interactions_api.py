# --- START OF FILE project/user_interactions_api.py ---
import time
import re
import sys
from datetime import datetime
from flask import (
    Blueprint, request, jsonify, session
)
# *** التعديل: استيراد الوحدات الفرعية المطلوبة فقط ***
from firebase_admin import db
from .auth_routes import login_required

bp = Blueprint('interactions', __name__, url_prefix='/api')

BANNED_WORDS = ["منيك", "شرموطة", "بتنتاك", "بنيك", "كس اختك", "كسختك", "امك", "اختك"]

def is_abusive(text):
    if not text: return False
    pattern = r'\b(' + '|'.join(re.escape(word) for word in BANNED_WORDS) + r')\b'
    return bool(re.search(pattern, text, re.IGNORECASE))

@bp.route('/shop/buy_spin_attempt', methods=['POST'])
@login_required
def buy_spin_attempt():
    ref_site_settings = db.reference('site_settings/')
    ref_wallets = db.reference('wallets/')
    ref_user_spin_state = db.reference('user_spin_state/')
    user_id = session['user_id']
    product_id = request.form.get('product_id')
    if not product_id:
        return jsonify(success=False, message="معرف المنتج مفقود."), 400
    
    product = ref_site_settings.child(f'shop_products_spins/{product_id}').get()
    if not product:
        return jsonify(success=False, message="المنتج غير موجود أو تم حذفه."), 404

    sp_price = product.get('sp_price', 0)
    attempts_to_add = product.get('attempts_amount', 0)

    if sp_price <= 0 or attempts_to_add <= 0:
        return jsonify(success=False, message="بيانات المنتج غير صالحة."), 500

    try:
        spin_settings = ref_site_settings.child('spin_wheel_settings').get() or {}
        purchase_limit = spin_settings.get('purchaseLimit', 20)

        wallet_sp = ref_wallets.child(f"{user_id}/sp").get() or 0
        if wallet_sp < sp_price:
            return jsonify(success=False, message="رصيد SP غير كافٍ لإتمام عملية الشراء."), 400

        current_purchased_attempts = ref_user_spin_state.child(f"{user_id}/purchasedAttempts").get() or 0
        
        if current_purchased_attempts + attempts_to_add > purchase_limit:
            return jsonify(success=False, message=f"لا يمكنك شراء المزيد. الحد الأقصى للمحاولات المشتراة هو {purchase_limit} محاولة."), 403

        updates = {
            f"wallets/{user_id}/sp": wallet_sp - sp_price,
            f"user_spin_state/{user_id}/purchasedAttempts": current_purchased_attempts + attempts_to_add
        }
        
        db.reference('/').update(updates)
        
        return jsonify(success=True, message=f"تم بنجاح شراء {attempts_to_add} محاولة دوران إضافية!")
    except Exception as e:
        print(f"!!! Atomic Spin Purchase Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء الشراء."), 500

@bp.route('/shop/buy_points_product', methods=['POST'])
@login_required
def buy_points_product():
    ref_site_settings = db.reference('site_settings/')
    ref_wallets = db.reference('wallets/')
    ref_users = db.reference('users/')
    ref_user_daily_limits = db.reference('user_daily_limits/')
    ref_points_history = db.reference('points_history/')
    ref_activity_log = db.reference('activity_log/')
    user_id = session.get('user_id')
    user_name = session.get('name')
    product_id = request.form.get('product_id')
    target_crawler_name = request.form.get('target_crawler')

    if not all([product_id, target_crawler_name]):
        return jsonify(success=False, message="البيانات المطلوبة غير مكتملة."), 400

    try:
        product = ref_site_settings.child(f'shop_products_points/{product_id}').get()
        user_wallet = ref_wallets.child(user_id).get() or {}
        target_crawler = ref_users.child(target_crawler_name).get()
        
        if not product: return jsonify(success=False, message="المنتج المحدد غير موجود."), 404
        if not target_crawler: return jsonify(success=False, message="الزاحف المستهدف غير موجود."), 404
        
        sp_price = product.get('sp_price', 0)
        if user_wallet.get('sp', 0) < sp_price:
            return jsonify(success=False, message="رصيد SP لديك غير كافٍ."), 400

        daily_limit = product.get('daily_limit', 1)
        today_str = datetime.now().strftime('%Y-%m-%d')
        limit_data = ref_user_daily_limits.child(f"{user_id}/{product_id}").get() or {}
        
        current_count = 0
        if limit_data.get('date') == today_str:
            current_count = limit_data.get('count', 0)
        
        if current_count >= daily_limit:
            return jsonify(success=False, message=f"لقد استهلكت الحد اليومي لهذا المنتج ({daily_limit} مرة)."), 403
            
        points_change = product.get('points_amount', 0)
        product_type = product.get('type')
        
        action_text = "تأثير على الأسهم"
        log_type = 'item_effect_neutral'

        if product_type == 'drop':
            points_change = -points_change
            action_text = "إسقاط أسهم"
            log_type = 'item_effect_drop'
        elif product_type == 'raise':
            action_text = "رفع أسهم"
            log_type = 'item_effect_raise'
        
        new_sp_balance = user_wallet.get('sp', 0) - sp_price
        new_points = target_crawler.get('points', 0) + points_change
        
        updates = {
            f"wallets/{user_id}/sp": new_sp_balance,
            f"users/{target_crawler_name}/points": new_points,
            f"user_daily_limits/{user_id}/{product_id}/count": current_count + 1,
            f"user_daily_limits/{user_id}/{product_id}/date": today_str
        }
        
        db.reference('/').update(updates)
        
        ref_points_history.child(target_crawler_name).push({
            'points': new_points, 'timestamp': int(time.time()), 'reason': f"Item purchase by {user_name} for {action_text}"
        })
        
        ref_activity_log.push({
            'type': log_type,
            'text': f"'{user_name}' استخدم منتج '{action_text}' على '{target_crawler_name}' بقيمة {abs(points_change):,} نقطة.",
            'timestamp': int(time.time()),
            'user_id': user_id, 'user_name': user_name
        })
        
        return jsonify(success=True, message="تمت العملية بنجاح!")
        
    except Exception as e:
        print(f"!!! Buy Points Product Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء تنفيذ العملية."), 500


@bp.route('/like/<username>', methods=['POST'])
@login_required 
def like_user(username):
    ref_users = db.reference('users/')
    ref_activity_log = db.reference('activity_log/')
    action = request.args.get('action', 'like')
    user_id = session['user_id']
    user_name = session['name']
    if action == 'unlike':
        ref_users.child(f'{username}/likes').transaction(lambda current: (current or 1) - 1)
    else:
        ref_users.child(f'{username}/likes').transaction(lambda current: (current or 0) + 1)
        ref_activity_log.push({
            'type': 'like', 'text': f"'{user_name}' أعجب بـ '{username}'", 
            'timestamp': int(time.time()), 'user_id': user_id, 'user_name': user_name
        })
    return jsonify(success=True)

@bp.route('/nominate', methods=['POST'])
@login_required
def nominate_user():
    ref_activity_log = db.reference('activity_log/')
    ref_candidates = db.reference('candidates/')
    name = request.form.get('name', '').strip()
    user_id = session['user_id']
    user_name = session['name']
    if not name: return jsonify(success=False, message="الاسم مطلوب للترشيح."), 400
    if is_abusive(name): return jsonify(success=False, message="الرجاء استخدام كلمات لائقة."), 403
    text = f"'{user_name}' رشح '{name}' للانضمام"
    ref_activity_log.push({
        'type': 'nomination', 'text': text, 'timestamp': int(time.time()), 
        'user_id': user_id, 'user_name': user_name
    })
    ref_candidates.child(name).set(True)
    return jsonify(success=True, message="تم إرسال طلب الترشيح بنجاح!")

@bp.route('/report', methods=['POST'])
@login_required
def report_user():
    ref_activity_log = db.reference('activity_log/')
    reason, reported_user = request.form.get('reason', '').strip(), request.form.get('reported_user', '').strip()
    user_id, user_name = session['user_id'], session['name']
    if not reason or not reported_user: return jsonify(success=False, message="يجب اختيار زاحف وذكر السبب."), 400
    if is_abusive(reason) or is_abusive(reported_user): return jsonify(success=False, message="الرجاء استخدام كلمات لائقة."), 403
    text = f"بلاغ من '{user_name}' ضد '{reported_user}': {reason}"
    ref_activity_log.push({
        'type': 'report', 'text': text, 'timestamp': int(time.time()),
        'user_id': user_id, 'user_name': user_name
    })
    return jsonify(success=True, message=f"تم إرسال بلاغك بخصوص {reported_user}. شكراً لك.")

@bp.route('/user_history/<username>')
@login_required
def get_user_history(username):
    ref_points_history = db.reference('points_history/')
    ref_users = db.reference('users/')
    history_data = ref_points_history.child(username).get() or {}
    history_list = list(history_data.values())
    if not history_list:
        user_data = ref_users.child(username).get() or {}
        current_points = user_data.get('points', 0)
        current_time = int(time.time())
        return jsonify([{'timestamp': current_time - 86400, 'points': current_points}, {'timestamp': current_time, 'points': current_points}])
    if len(history_list) == 1:
        first_point = history_list[0]
        history_list.insert(0, {'points': first_point['points'], 'timestamp': first_point['timestamp'] - 86400})
    return jsonify(sorted(history_list, key=lambda x: x.get('timestamp', 0)))

@bp.route('/check_my_ban_status')
@login_required
def check_my_ban_status():
    ref_banned_users = db.reference('banned_users/')
    user_id = session.get('user_id')
    if not user_id: return jsonify({'is_banned': False})
    banned_status = ref_banned_users.child(user_id).get()
    return jsonify({'is_banned': banned_status is not None})

@bp.route('/shop/buy_product', methods=['POST'])
@login_required
def buy_shop_product():
    ref_site_settings = db.reference('site_settings/')
    ref_wallets = db.reference('wallets/')
    user_id = session.get('user_id')
    product_id = request.form.get('product_id')
    if not product_id: return jsonify(success=False, message="معرف المنتج مفقود."), 400
    product = ref_site_settings.child(f'shop_products/{product_id}').get()
    if not product: return jsonify(success=False, message="المنتج غير موجود أو تم حذفه."), 404
    cc_price = product.get('cc_price', 0)
    sp_amount = product.get('sp_amount', 0)
    if cc_price <= 0 or sp_amount <= 0: return jsonify(success=False, message="بيانات المنتج غير صالحة."), 500
    user_wallet_ref = ref_wallets.child(user_id)
    def transact_purchase(current_wallet_data):
        if current_wallet_data is None: current_wallet_data = {'cc': 0, 'sp': 0}
        current_cc = current_wallet_data.get('cc', 0)
        if current_cc < cc_price: raise ValueError("رصيد CC غير كافٍ لإتمام عملية الشراء.")
        current_wallet_data['cc'] = current_cc - cc_price
        current_wallet_data['sp'] = current_wallet_data.get('sp', 0) + sp_amount
        return current_wallet_data
    try:
        user_wallet_ref.transaction(transact_purchase)
        return jsonify(success=True, message=f"تم بنجاح شراء {sp_amount:,} SP!")
    except ValueError as e: return jsonify(success=False, message=str(e)), 400
    except Exception as e:
        print(f"!!! Product Purchase Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء الشراء."), 500

@bp.route('/invest', methods=['POST'])
@login_required
def invest_in_crawler():
    ref_users = db.reference('users/')
    ref_wallets = db.reference('wallets/')
    ref_investments = db.reference('investments/')
    ref_investment_log = db.reference('investment_log/')
    user_id, user_name = session['user_id'], session['name']
    crawler_name = request.form.get('crawler_name')
    try: sp_to_invest = int(request.form.get('sp_amount'))
    except (ValueError, TypeError): return jsonify(success=False, message="كمية SP غير صالحة."), 400
    if sp_to_invest <= 0: return jsonify(success=False, message="يجب استثمار كمية موجبة."), 400

    try:
        crawler_data = ref_users.child(crawler_name).get()
        if not crawler_data: return jsonify(success=False, message="هذا الزاحف غير موجود."), 404
        
        wallet_data = ref_wallets.child(user_id).get() or {'sp': 0}
        current_sp = wallet_data.get('sp', 0)
        if current_sp < sp_to_invest: return jsonify(success=False, message="رصيد SP غير كافٍ للاستثمار."), 400

        new_sp_balance = current_sp - sp_to_invest
        investment_data = ref_investments.child(user_id).child(crawler_name).get()
        points_at_investment = crawler_data.get('points', 0)
        
        new_investment_record = {}
        if investment_data: 
            total_sp_invested = investment_data.get('invested_sp', 0) + sp_to_invest
            old_total_value = investment_data.get('invested_sp', 0) * investment_data.get('points_at_investment', 0)
            new_total_value_to_add = sp_to_invest * points_at_investment
            
            new_average_points_at_investment = (old_total_value + new_total_value_to_add) / total_sp_invested if total_sp_invested > 0 else points_at_investment

            new_investment_record = investment_data
            new_investment_record['invested_sp'] = total_sp_invested
            new_investment_record['points_at_investment'] = round(new_average_points_at_investment)
            new_investment_record['last_updated_timestamp'] = int(time.time())
        else:
            new_investment_record = { 'invested_sp': sp_to_invest, 'points_at_investment': points_at_investment, 'timestamp': int(time.time()) }
            
        updates = { f"wallets/{user_id}/sp": new_sp_balance, f"investments/{user_id}/{crawler_name}": new_investment_record }
        db.reference('/').update(updates)
        
        ref_investment_log.push({
            'investor_id': user_id, 'investor_name': user_name, 'target_name': crawler_name,
            'action': 'invest', 'sp_amount': sp_to_invest, 'timestamp': int(time.time())
        })

        return jsonify(success=True, message=f"تم استثمار {sp_to_invest:,} SP بنجاح في {crawler_name}!")
    except Exception as e:
        print(f"!!! Atomic Investment Update Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ فادح أثناء حفظ الاستثمار."), 500

@bp.route('/sell', methods=['POST'])
@login_required
def sell_investment():
    ref_users = db.reference('users/')
    ref_wallets = db.reference('wallets/')
    ref_investments = db.reference('investments/')
    ref_investment_log = db.reference('investment_log/')
    user_id, user_name = session['user_id'], session['name']
    crawler_name = request.form.get('crawler_name')
    if not crawler_name: return jsonify(success=False, message="اسم الزاحف مطلوب."), 400

    investment_ref = ref_investments.child(user_id).child(crawler_name)
    investment_data = investment_ref.get()
    if not investment_data: return jsonify(success=False, message="ليس لديك استثمار في هذا الزاحف."), 404

    crawler_data = ref_users.child(crawler_name).get()
    
    invested_sp = float(investment_data.get('invested_sp', 0))
    sp_to_return = invested_sp

    if crawler_data:
        current_points = float(crawler_data.get('points', 0))
        points_at_investment = float(investment_data.get('points_at_investment', 1)) or 1
        
        if points_at_investment != 0:
             sp_to_return = invested_sp * (current_points / points_at_investment)

    user_wallet_ref = ref_wallets.child(user_id)
    try:
        user_wallet_ref.child('sp').transaction(lambda current_sp: (current_sp or 0) + sp_to_return)
        investment_ref.delete()

        ref_investment_log.push({
            'investor_id': user_id, 'investor_name': user_name, 'target_name': crawler_name,
            'action': 'sell', 'sp_amount': sp_to_return, 'timestamp': int(time.time())
        })

        return jsonify(success=True, message=f"تم بيع الاستثمار بنجاح! لقد حصلت على {sp_to_return:.2f} SP.")
    except Exception as e:
        print(f"!!! Sell Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء البيع."), 500
# --- END OF FILE project/user_interactions_api.py ---
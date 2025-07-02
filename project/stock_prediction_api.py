import time
import random
import sys
from flask import Blueprint, request, jsonify, session
from firebase_admin import db
from .utils import login_required

bp = Blueprint('stock_prediction_api', __name__)

# --- دالة مساعدة لجلب إعدادات اللعبة ---
def get_game_settings():
    return db.reference('site_settings/stock_prediction_game').get() or {}

# --- 1. نقطة النهاية لبدء جولة جديدة ---
@bp.route('/start', methods=['POST'])
@login_required
def start_game():
    user_id = session.get('user_id')
    settings = get_game_settings()

    if not settings.get('is_enabled'):
        return jsonify(success=False, message="هذه اللعبة معطلة حالياً من قبل الإدارة."), 403

    try:
        data = request.get_json()
        bet_amount = int(data.get('bet_amount', 0))
    except (ValueError, TypeError):
        return jsonify(success=False, message="مبلغ الرهان غير صالح."), 400

    if bet_amount <= 0:
        return jsonify(success=False, message="يجب أن يكون مبلغ الرهان أكبر من صفر."), 400

    max_bet = settings.get('max_bet', 1000)
    if bet_amount > max_bet:
        return jsonify(success=False, message=f"الحد الأقصى للرهان هو {max_bet} SP."), 400

    wallet_ref = db.reference(f'wallets/{user_id}')
    current_sp = (wallet_ref.child('sp').get() or 0)
    
    if current_sp < bet_amount:
        return jsonify(success=False, message="رصيد SP لديك غير كافٍ لبدء اللعبة."), 400

    all_crawlers = db.reference('users').get()
    if not all_crawlers:
        return jsonify(success=False, message="لا يوجد زواحف متاحون للعب حالياً."), 500

    # خصم مبلغ الرهان من المحفظة
    wallet_ref.child('sp').set(current_sp - bet_amount)

    chosen_crawler_name = random.choice(list(all_crawlers.keys()))
    chosen_crawler_data = all_crawlers[chosen_crawler_name]
    
    # حفظ حالة اللعبة في جلسة المستخدم
    session['stock_game_state'] = {
        'active': True,
        'initial_bet': bet_amount,
        'current_winnings': bet_amount,
        'crawler_name': chosen_crawler_name,
        'start_time': time.time()
    }
    session.modified = True
    
    return jsonify(success=True, crawler={
        'name': chosen_crawler_name,
        'avatar_url': chosen_crawler_data.get('avatar_url', '')
    })

# --- 2. نقطة النهاية للعب وتحديد النتيجة ---
@bp.route('/play', methods=['POST'])
@login_required
def play_round():
    game_state = session.get('stock_game_state')
    
    if not game_state or not game_state.get('active'):
        return jsonify(success=False, message="ليس لديك لعبة نشطة. يرجى البدء من جديد."), 400
    
    # التحقق من انتهاء صلاحية الجلسة (مثلاً 5 دقائق)
    if time.time() - game_state.get('start_time', 0) > 300:
        session.pop('stock_game_state', None)
        return jsonify(success=False, message="انتهت صلاحية جولة اللعب. يرجى البدء من جديد."), 408

    try:
        data = request.get_json()
        guess = data.get('guess') # 'up' or 'down'
        if guess not in ['up', 'down']:
            return jsonify(success=False, message="تخمين غير صالح."), 400
    except Exception:
        return jsonify(success=False, message="بيانات الطلب غير صالحة."), 400

    settings = get_game_settings()
    win_chance = settings.get('win_chance_percent', 49.0)
    
    is_winner = random.uniform(0, 100) < win_chance
    
    if is_winner:
        # إذا فاز، ضاعف أرباحه الحالية وجهّزه للجولة التالية
        game_state['current_winnings'] *= 2
        session['stock_game_state'] = game_state
        session.modified = True
        return jsonify(success=True, result='win', winnings=game_state['current_winnings'])
    else:
        # إذا خسر، أنهِ اللعبة واحذف الحالة من الجلسة
        session.pop('stock_game_state', None)
        return jsonify(success=True, result='lose')

# --- 3. نقطة النهاية لسحب الأرباح ---
@bp.route('/cashout', methods=['POST'])
@login_required
def cash_out():
    user_id = session.get('user_id')
    game_state = session.get('stock_game_state')

    if not game_state or not game_state.get('active'):
        return jsonify(success=False, message="ليس لديك أرباح لسحبها."), 400

    winnings = game_state.get('current_winnings', 0)

    try:
        # إضافة الأرباح إلى محفظة المستخدم
        wallet_ref = db.reference(f'wallets/{user_id}/sp')
        wallet_ref.transaction(lambda current_sp: (current_sp or 0) + winnings)
        
        # حذف حالة اللعبة من الجلسة
        session.pop('stock_game_state', None)
        
        return jsonify(success=True, message=f"تمت إضافة {winnings:,.2f} SP إلى محفظتك بنجاح!")
    except Exception as e:
        print(f"!!! Stock Game Cashout Error for user {user_id}: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء سحب الأرباح."), 500
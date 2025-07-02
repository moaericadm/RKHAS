# START OF FILE project/rps_pvp_api.py
import time
import random
import sys
from flask import Blueprint, request, jsonify, session
from firebase_admin import db
from .utils import login_required

bp = Blueprint('rps_pvp_api', __name__)

CHALLENGES_REF = db.reference('rps_challenges')
WALLETS_REF = db.reference('wallets')
SETTINGS_REF = db.reference('site_settings/rps_game')


def get_game_settings():
    return SETTINGS_REF.get() or {}

@bp.route('/challenge/create', methods=['POST'])
@login_required
def create_challenge():
    user_id = session.get('user_id')
    user_name = session.get('name')
    settings = get_game_settings()

    if not settings.get('is_enabled'):
        return jsonify(success=False, message="هذه اللعبة معطلة حالياً من قبل الإدارة."), 403
    
    lock_until = settings.get('lock_until', 0)
    if time.time() < lock_until:
        remaining = int(lock_until - time.time())
        return jsonify(success=False, message=f"اللعبة مقفلة مؤقتاً. يرجى الانتظار {remaining} ثانية."), 429

    try:
        data = request.get_json()
        bet_amount = int(data.get('bet_amount', 0))
    except (ValueError, TypeError):
        return jsonify(success=False, message="مبلغ الرهان غير صالح."), 400

    if bet_amount <= 0:
        return jsonify(success=False, message="يجب أن يكون مبلغ الرهان أكبر من صفر."), 400

    max_bet = settings.get('max_bet', 500)
    if bet_amount > max_bet:
        return jsonify(success=False, message=f"الحد الأقصى للرهان هو {max_bet} SP."), 400

    wallet_ref = WALLETS_REF.child(user_id).child('sp')
    current_sp = wallet_ref.get() or 0
    if current_sp < bet_amount:
        return jsonify(success=False, message="رصيد SP لديك غير كافٍ لإنشاء هذا التحدي."), 400

    try:
        wallet_ref.set(current_sp - bet_amount)
        new_challenge = CHALLENGES_REF.push()
        challenge_data = {
            'player1': {'uid': user_id, 'name': user_name},
            'bet_amount': bet_amount,
            'status': 'open',
            'created_at': int(time.time()),
            'game_state': {
                'round': 1,
                'scores': {'player1': 0, 'player2': 0},
                'choices': {'round1': {}, 'round2': {}, 'round3': {}}
            }
        }
        new_challenge.set(challenge_data)
        return jsonify(success=True, message="تم إنشاء التحدي بنجاح!", challenge_id=new_challenge.key)
    except Exception as e:
        wallet_ref.set(current_sp)
        print(f"!!! Create RPS Challenge Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء إنشاء التحدي."), 500

@bp.route('/challenge/join', methods=['POST'])
@login_required
def join_challenge():
    user_id = session.get('user_id')
    user_name = session.get('name')
    
    settings = get_game_settings()
    lock_until = settings.get('lock_until', 0)
    if time.time() < lock_until:
        remaining = int(lock_until - time.time())
        return jsonify(success=False, message=f"اللعبة مقفلة مؤقتاً. يرجى الانتظار {remaining} ثانية."), 429

    data = request.get_json()
    challenge_id = data.get('challenge_id')

    if not challenge_id:
        return jsonify(success=False, message="معرف التحدي مفقود."), 400

    challenge_ref = CHALLENGES_REF.child(challenge_id)
    
    def transaction_join(challenge_data):
        if not challenge_data or challenge_data.get('status') != 'open':
            raise ValueError("التحدي لم يعد متاحاً.")
        if challenge_data['player1']['uid'] == user_id:
            raise ValueError("لا يمكنك الانضمام لتحدي أنشأته بنفسك.")
        
        bet_amount = challenge_data.get('bet_amount', 0)
        wallet_ref = WALLETS_REF.child(user_id).child('sp')
        current_sp = wallet_ref.get() or 0
        if current_sp < bet_amount:
            raise ValueError("رصيد SP لديك غير كافٍ للانضمام لهذا التحدي.")
            
        wallet_ref.set(current_sp - bet_amount)
        
        if 'game_state' not in challenge_data:
            challenge_data['game_state'] = {
                'round': 1,
                'scores': {'player1': 0, 'player2': 0},
                'choices': {'round1': {}, 'round2': {}, 'round3': {}}
            }
        elif 'choices' not in challenge_data['game_state']:
             challenge_data['game_state']['choices'] = {'round1': {}, 'round2': {}, 'round3': {}}
        
        challenge_data['player2'] = {'uid': user_id, 'name': user_name}
        challenge_data['status'] = 'playing'
        return challenge_data
        
    try:
        challenge_ref.transaction(transaction_join)
        return jsonify(success=True, message="لقد انضممت للتحدي! اللعبة ستبدأ الآن.")
    except ValueError as e:
        return jsonify(success=False, message=str(e)), 400
    except Exception as e:
        print(f"!!! Join RPS Challenge Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم."), 500

@bp.route('/challenge/play', methods=['POST'])
@login_required
def play_challenge_round():
    user_id = session.get('user_id')
    data = request.get_json()
    challenge_id = data.get('challenge_id')
    player_choice = data.get('choice')

    if not all([challenge_id, player_choice]) or player_choice not in ['rock', 'paper', 'scissors']:
        return jsonify(success=False, message="بيانات اللعب غير صالحة."), 400

    challenge_ref = CHALLENGES_REF.child(challenge_id)

    def transaction_play(current_data):
        # 1. تحقق من صحة البيانات الحالية داخل الـ transaction
        if not current_data or current_data.get('status') != 'playing':
            # لا تقم بأي تغيير إذا كانت اللعبة قد انتهت أو غير موجودة
            return current_data 
        
        p1_uid = current_data['player1']['uid']
        p2_uid = current_data.get('player2', {}).get('uid')

        if user_id not in [p1_uid, p2_uid]:
            # هذا اللاعب ليس جزءًا من اللعبة
            return current_data

        player_key = 'player1' if user_id == p1_uid else 'player2'
        opponent_key = 'player2' if player_key == 'player1' else 'player1'
        round_num = current_data['game_state'].get('round', 1)
        round_key = f"round{round_num}"
        choices = current_data['game_state'].get('choices', {})

        # 2. تسجيل حركة اللاعب الحالي
        if round_key not in choices: choices[round_key] = {}
        choices[round_key][player_key] = player_choice
        current_data['game_state']['choices'] = choices

        opponent_choice = choices.get(round_key, {}).get(opponent_key)

        # 3. إذا قام الخصم بحركته، قم بحل الجولة
        if opponent_choice:
            p_choice = player_choice
            o_choice = opponent_choice
            round_winner = None
            if (p_choice == 'rock' and o_choice == 'scissors') or \
               (p_choice == 'paper' and o_choice == 'rock') or \
               (p_choice == 'scissors' and o_choice == 'paper'):
                round_winner = player_key
            elif p_choice != o_choice:
                round_winner = opponent_key
            
            if round_winner:
                current_data['game_state']['scores'][round_winner] = current_data['game_state']['scores'].get(round_winner, 0) + 1
            
            current_data['game_state']['round'] = round_num + 1

            # 4. التحقق من انتهاء المباراة
            scores = current_data['game_state']['scores']
            if scores.get('player1', 0) >= 2 or scores.get('player2', 0) >= 2 or round_num >= 3:
                game_winner_key = None
                if scores.get('player1', 0) > scores.get('player2', 0):
                    game_winner_key = 'player1'
                elif scores.get('player2', 0) > scores.get('player1', 0):
                    game_winner_key = 'player2'
                else:
                    game_winner_key = 'draw'
                
                current_data['status'] = 'finished'
                current_data['winner'] = game_winner_key
        
        return current_data

    try:
        # تنفيذ الـ transaction
        final_state = challenge_ref.transaction(transaction_play)
        
        # 5. التعامل مع ما بعد الـ transaction (توزيع الجوائز، قفل اللعبة)
        if final_state and final_state.get('status') == 'finished':
            bet_amount = final_state.get('bet_amount', 0)
            winner_key = final_state.get('winner')

            if winner_key and winner_key != 'draw':
                winner_uid = final_state[winner_key]['uid']
                total_pot = bet_amount * 2
                WALLETS_REF.child(winner_uid).child('sp').transaction(lambda current: (current or 0) + total_pot)
            elif winner_key == 'draw':
                p1_uid = final_state['player1']['uid']
                p2_uid = final_state.get('player2', {}).get('uid')
                WALLETS_REF.child(p1_uid).child('sp').transaction(lambda current: (current or 0) + bet_amount)
                if p2_uid:
                    WALLETS_REF.child(p2_uid).child('sp').transaction(lambda current: (current or 0) + bet_amount)
            
            settings = get_game_settings()
            cooldown_seconds = settings.get('cooldown_seconds', 60)
            if cooldown_seconds > 0:
                SETTINGS_REF.update({'lock_until': int(time.time()) + cooldown_seconds})

        return jsonify(success=True, message="تم تسجيل حركتك.")

    except Exception as e:
        print(f"!!! Play RPS Round Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء اللعب."), 500

# <<< بداية التعديل: إضافة نقطة نهاية للاستسلام >>>
@bp.route('/challenge/surrender', methods=['POST'])
@login_required
def surrender_challenge():
    user_id = session.get('user_id')
    data = request.get_json()
    challenge_id = data.get('challenge_id')

    if not challenge_id:
        return jsonify(success=False, message="معرف التحدي مفقود."), 400

    challenge_ref = CHALLENGES_REF.child(challenge_id)
    
    try:
        challenge_data = challenge_ref.get()

        if not challenge_data or challenge_data.get('status') != 'playing':
            return jsonify(success=False, message="لا يمكن الاستسلام في هذا التحدي."), 400

        p1_uid = challenge_data['player1']['uid']
        p2_uid = challenge_data.get('player2', {}).get('uid')

        if user_id not in [p1_uid, p2_uid]:
            return jsonify(success=False, message="أنت لست جزءًا من هذا التحدي."), 403

        loser_key = 'player1' if user_id == p1_uid else 'player2'
        winner_key = 'player2' if loser_key == 'player1' else 'player1'
        
        # التأكد من وجود اللاعب الفائز قبل المتابعة
        if winner_key not in challenge_data:
            challenge_ref.delete() # حذف اللعبة العالقة
            return jsonify(success=True, message="تم حذف اللعبة لأن الخصم غير موجود.")

        winner_uid = challenge_data[winner_key]['uid']
        bet_amount = challenge_data.get('bet_amount', 0)
        total_pot = bet_amount * 2

        # 1. دفع الأرباح للفائز
        WALLETS_REF.child(winner_uid).child('sp').transaction(lambda current: (current or 0) + total_pot)
        
        # 2. تحديث حالة اللعبة
        challenge_ref.update({
            'status': 'finished',
            'winner': winner_key,
            'outcome_reason': 'surrender'
        })

        # 3. تفعيل قفل اللعبة
        settings = get_game_settings()
        cooldown_seconds = settings.get('cooldown_seconds', 60)
        if cooldown_seconds > 0:
            SETTINGS_REF.update({'lock_until': int(time.time()) + cooldown_seconds})
        
        return jsonify(success=True, message="لقد استسلمت. تم تحويل الرهان للخصم.")

    except Exception as e:
        print(f"!!! Surrender RPS Challenge Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم أثناء الاستسلام."), 500
# <<< نهاية التعديل >>>

@bp.route('/challenge/cancel', methods=['POST'])
@login_required
def cancel_challenge():
    user_id = session.get('user_id')
    data = request.get_json()
    challenge_id = data.get('challenge_id')
    
    challenge_ref = CHALLENGES_REF.child(challenge_id)
    challenge_data = challenge_ref.get()

    if not challenge_data or challenge_data['player1']['uid'] != user_id or challenge_data['status'] != 'open':
        return jsonify(success=False, message="لا يمكنك إلغاء هذا التحدي."), 403

    try:
        bet_amount = challenge_data.get('bet_amount', 0)
        WALLETS_REF.child(user_id).child('sp').transaction(lambda current: (current or 0) + bet_amount)
        challenge_ref.delete()
        return jsonify(success=True, message="تم إلغاء التحدي وإعادة الرهان.")
    except Exception as e:
        print(f"!!! Cancel RPS Challenge Error: {e}", file=sys.stderr)
        return jsonify(success=False, message="حدث خطأ في الخادم."), 500
# END OF FILE project/rps_pvp_api.py
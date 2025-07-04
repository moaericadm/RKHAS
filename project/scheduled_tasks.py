# --- START OF FILE project/scheduled_tasks.py ---

# project/scheduled_tasks.py
import time
import random
import sys
from flask import current_app
from firebase_admin import db

def clean_old_notifications(app):
    with app.app_context():
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Running Old Notifications Cleaner...")
        feed_ref = db.reference('live_feed')
        cutoff_timestamp = int(time.time()) - 60
        old_notifications = feed_ref.order_by_child('timestamp').end_at(cutoff_timestamp).get()
        if old_notifications:
            updates = {key: None for key in old_notifications.keys()}
            feed_ref.update(updates)
            print(f"Cleaner removed {len(updates)} old notifications.")

def clean_old_nudges(app):
    with app.app_context():
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Running Old Nudges Cleaner...")
        updates = {}
        cutoff_timestamp = int(time.time()) - 30
        public_nudges_ref = db.reference('public_nudges')
        old_public_nudges = public_nudges_ref.order_by_child('timestamp').end_at(cutoff_timestamp).get()
        if old_public_nudges:
            for key in old_public_nudges:
                updates[f'public_nudges/{key}'] = None
        all_user_nudges = db.reference('user_nudges').get()
        if all_user_nudges:
            for user_id, nudges in all_user_nudges.items():
                if 'incoming' in nudges:
                    for nudge_id, nudge_data in nudges['incoming'].items():
                        if nudge_data.get('timestamp', 0) < cutoff_timestamp:
                            updates[f'user_nudges/{user_id}/incoming/{nudge_id}'] = None
        if updates:
            db.reference('/').update(updates)
            print(f"Nudge Cleaner removed {len(updates)} old nudges.")

# <<< بداية التعديل الشامل لدالة المنافسة >>>
def manage_popularity_contest(app):
    with app.app_context():
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Running Popularity Contest check...")
        contest_ref = db.reference('popularity_contest')
        settings_ref = db.reference('site_settings/contest_settings')
        users_ref = db.reference('users')
        all_crawlers_now = users_ref.get() or {}
        
        settings = settings_ref.get()
        if not settings or not settings.get('is_enabled', False):
            if contest_ref.get(): contest_ref.set(None)
            print("Contest system is disabled. Exiting task.")
            return

        current_contest = contest_ref.get()
        updates_to_apply = {}

        # 1. التحقق من وجود منافسة نشطة ومعالجة انتهائها
        if current_contest and current_contest.get('status') == 'active':
            end_timestamp = current_contest.get('end_timestamp', 0)
            
            # إذا انتهت المنافسة
            if time.time() >= end_timestamp:
                print("Contest finished. Processing results...")
                contestant1_name = current_contest.get('contestant1_name')
                contestant2_name = current_contest.get('contestant2_name')

                # إعادة المضاعف إلى قيمته الأصلية
                c1_original_multiplier = current_contest.get('contestant1_original_multiplier', 1.0)
                c2_original_multiplier = current_contest.get('contestant2_original_multiplier', 1.0)
                updates_to_apply[f'users/{contestant1_name}/stock_multiplier'] = c1_original_multiplier
                updates_to_apply[f'users/{contestant2_name}/stock_multiplier'] = c2_original_multiplier
                print(f"Resetting multipliers: {contestant1_name} -> {c1_original_multiplier}, {contestant2_name} -> {c2_original_multiplier}")

                # حساب الفائز وتوزيع الجوائز
                votes = current_contest.get('votes', {})
                votes1_count = len(votes.get(contestant1_name, {}))
                votes2_count = len(votes.get(contestant2_name, {}))
                
                winner_name, winning_voters = (contestant1_name, votes.get(contestant1_name, {})) if votes1_count > votes2_count else (contestant2_name, votes.get(contestant2_name, {})) if votes2_count > votes1_count else (None, {})
                
                if winner_name:
                    winner_reward = settings.get('winner_points_reward', 0)
                    voter_reward = settings.get('voter_sp_reward', 0)
                    
                    if winner_reward > 0:
                        updates_to_apply[f'users/{winner_name}/points'] = db.Reference.increment(winner_reward)
                    
                    if voter_reward > 0 and winning_voters:
                        for uid in winning_voters.keys():
                            updates_to_apply[f'wallets/{uid}/sp'] = db.Reference.increment(voter_reward)
                            db.reference(f'user_messages/{uid}').push({'text': f"🎉 مبروك! لقد فزت بـ {voter_reward} SP لتصويتك للزاحف الفائز '{winner_name}'.", 'timestamp': int(time.time())})
                
                # تحديث حالة المنافسة إلى منتهية
                contest_ref.child('status').set('completed')
                current_contest = None # لإجبار إنشاء منافسة جديدة في الخطوة التالية

        # 2. بدء منافسة جديدة إذا لم تكن هناك منافسة نشطة
        if not current_contest and len(all_crawlers_now) >= 2:
            print("Starting a new contest...")
            
            contestants = random.sample(list(all_crawlers_now.keys()), 2)
            name1, name2 = contestants[0], contestants[1]
            
            c1_data = all_crawlers_now.get(name1, {})
            c2_data = all_crawlers_now.get(name2, {})
            c1_original_multiplier = c1_data.get('stock_multiplier', 1.0)
            c2_original_multiplier = c2_data.get('stock_multiplier', 1.0)
            
            # قراءة نسبة التعزيز من الإعدادات
            multiplier_boost = float(settings.get('multiplier_boost', 0.2))
            
            c1_new_multiplier = c1_original_multiplier + multiplier_boost
            c2_new_multiplier = c2_original_multiplier + multiplier_boost
            
            updates_to_apply[f'users/{name1}/stock_multiplier'] = c1_new_multiplier
            updates_to_apply[f'users/{name2}/stock_multiplier'] = c2_new_multiplier
            print(f"Boosting multipliers by {multiplier_boost}: {name1} -> {c1_new_multiplier}, {name2} -> {c2_new_multiplier}")

            new_contest_data = {
                'contestant1_name': name1,
                'contestant2_name': name2,
                'contestant1_original_multiplier': c1_original_multiplier,
                'contestant2_original_multiplier': c2_original_multiplier,
                'end_timestamp': int(time.time()) + 86400, 
                'status': 'active', 
                'votes': {}
            }
            contest_ref.set(new_contest_data)

        # 3. تطبيق جميع التحديثات المجمعة دفعة واحدة
        if updates_to_apply:
            db.reference('/').update(updates_to_apply)
            print("Applied all contest-related updates to the database.")
# <<< نهاية التعديل الشامل >>>


def automated_market_balance(app):
    with app.app_context():
        print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] --- Running Market Volatility Engine ---")
        
        settings = db.reference('site_settings/market_governor').get()
        if not settings or not settings.get('enabled') or not settings.get('market_volatility', {}).get('enabled'):
            print("Market Volatility system is disabled. Exiting.")
            return

        all_users = db.reference('users').get() or {}
        if not all_users:
            print("No crawlers found to apply volatility. Exiting.")
            return

        volatility_settings = settings.get('market_volatility', {})
        db_updates = {}
        activity_logs = []

        for crawler_name, crawler_data in all_users.items():
            current_multiplier = float(crawler_data.get('stock_multiplier', 1.0))
            
            if random.uniform(0, 100) >= float(volatility_settings.get('chance_percent', 0)):
                print(f"  - Crawler '{crawler_name}': No change triggered this cycle.")
                continue

            events_config = {
                'up': (volatility_settings.get('up_min_percent', 1.0), volatility_settings.get('up_max_percent', 5.0), volatility_settings.get('up_chance', 45)),
                'down': (-volatility_settings.get('down_min_percent', 1.0), -volatility_settings.get('down_max_percent', 3.0), volatility_settings.get('down_chance', 40)),
                'strong_up': (volatility_settings.get('strong_up_min_percent', 10.0), volatility_settings.get('strong_up_max_percent', 25.0), volatility_settings.get('strong_up_chance', 7.5)),
                'crash': (-volatility_settings.get('crash_min_percent', 8.0), -volatility_settings.get('crash_max_percent', 20.0), volatility_settings.get('crash_chance', 7.5))
            }

            event_names = list(events_config.keys())
            event_weights = [v[2] for v in events_config.values()]

            if sum(event_weights) <= 0:
                print(f"  - Crawler '{crawler_name}': Event weights sum to zero, skipping.")
                continue

            chosen_event_type = random.choices(event_names, weights=event_weights, k=1)[0]
            min_percent, max_percent, _ = events_config[chosen_event_type]
            
            random_percent = random.uniform(min_percent, max_percent)
            change_amount = random_percent / 100.0
            
            if 'down' in chosen_event_type or 'crash' in chosen_event_type:
                change_amount = -abs(change_amount)
            else:
                change_amount = abs(change_amount)

            new_multiplier = max(0.20, current_multiplier + change_amount)

            db_updates[f'users/{crawler_name}/stock_multiplier'] = new_multiplier
            
            log_text_map = {
                'up': f"📈 ارتفاع طفيف بنسبة {abs(random_percent):.1f}% في سوق الزاحف '{crawler_name}'!",
                'down': f"📉 انخفاض طفيف بنسبة {abs(random_percent):.1f}% في سوق الزاحف '{crawler_name}'.",
                'strong_up': f"🚀 ارتفاع قوي بنسبة {abs(random_percent):.1f}% في سوق الزاحف '{crawler_name}'!",
                'crash': f"💥 انهيار مفاجئ بنسبة {abs(random_percent):.1f}% في سوق الزاحف '{crawler_name}'!"
            }
            log_text = log_text_map.get(chosen_event_type, "تقلب في السوق.")
            
            activity_logs.append({'type': 'admin_edit', 'text': log_text, 'timestamp': int(time.time())})
            
            print(f"  + Crawler '{crawler_name}': Event '{chosen_event_type}'. Multiplier changed from {current_multiplier:.2f} to {new_multiplier:.2f}.")

        jackpot_chance = float(settings.get('jackpot_chance_percent', 0.5))
        if random.uniform(0, 100) < jackpot_chance:
            print("  -> Jackpot event triggered!")
            all_wallets = db.reference('wallets').get() or {}
            high_rollers = {uid: w.get('sp', 0) for uid, w in all_wallets.items() if w.get('sp', 0) >= 1000000}
            if high_rollers:
                lucky_user_id = random.choice(list(high_rollers.keys()))
                all_investments = db.reference('investments').get() or {}
                user_investments_jackpot = all_investments.get(lucky_user_id, {})
                if user_investments_jackpot:
                    best_investment_name = max(user_investments_jackpot, key=lambda k: user_investments_jackpot[k].get('lots', {}).get(next(iter(user_investments_jackpot[k].get('lots', {})), ''), {}).get('sp', 0))
                    jackpot_multiplier = settings.get('jackpot_multiplier', 10.0)
                    
                    db_updates[f'investments/{lucky_user_id}/{best_investment_name}/personal_multiplier'] = jackpot_multiplier
                    db_updates[f'investments/{lucky_user_id}/{best_investment_name}/manual_override'] = 'golden_blessing'
                    
                    user_name = (db.reference(f'registered_users/{lucky_user_id}/name').get() or 'مستخدم')
                    activity_logs.append({'type':'jackpot', 'text': f"ضربة حظ! النظام بارك استثمار '{user_name}' في '{best_investment_name}' بمضاعف x{jackpot_multiplier}!", 'timestamp': int(time.time())})
                    print(f"  -> Jackpot awarded to {user_name} for investment in {best_investment_name}.")

        if db_updates:
            print(f"Applying {len(db_updates)} update(s) to the database...")
            db.reference('/').update(db_updates)
            print("Database updates applied successfully.")
        
        if activity_logs:
            for log in activity_logs:
                db.reference('activity_log').push(log)
        
        print(f"--- Market Volatility Engine finished. ---")
# --- END OF FILE project/scheduled_tasks.py ---
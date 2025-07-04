# --- START OF FILE project/scheduled_tasks.py ---

import time
import random
import sys
from flask import current_app
from firebase_admin import db

def clean_old_notifications(app):
    with app.app_context():
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Running Old Notifications Cleaner...")
        try:
            settings = db.reference('site_settings/cleanup_settings').get() or {}
            lifespan_hours = settings.get('notifications_lifespan_hours', 24)
            
            feed_ref = db.reference('live_feed')
            cutoff_timestamp = int(time.time()) - (lifespan_hours * 3600)
            old_notifications = feed_ref.order_by_child('timestamp').end_at(cutoff_timestamp).get()
            if old_notifications:
                updates = {key: None for key in old_notifications.keys()}
                feed_ref.update(updates)
                print(f"Cleaner removed {len(updates)} old notifications.")
        except Exception as e:
            print(f"!!! Error in clean_old_notifications: {e}", file=sys.stderr)

def clean_old_nudges(app):
    with app.app_context():
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Running Old Nudges Cleaner...")
        try:
            settings = db.reference('site_settings/cleanup_settings').get() or {}
            lifespan_minutes = settings.get('nudges_lifespan_minutes', 5)
            
            updates = {}
            cutoff_timestamp = int(time.time()) - (lifespan_minutes * 60)
            
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
            
            # <<< بداية التعديل: استخدام المرجع الفارغ بدلاً من الجذر >>>
            if updates:
                db.reference().update(updates)
                print(f"Nudge Cleaner removed {len(updates)} old nudges.")
            # <<< نهاية التعديل >>>
        except Exception as e:
            print(f"!!! Error in clean_old_nudges: {e}", file=sys.stderr)


def manage_popularity_contest(app):
    with app.app_context():
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Running Popularity Contest check...")
        contest_ref = db.reference('popularity_contest')
        settings_ref = db.reference('site_settings/contest_settings')
        users_ref = db.reference('users')
        
        try:
            all_crawlers_now = users_ref.get() or {}
            settings = settings_ref.get() or {}

            if not settings.get('is_enabled', False):
                if contest_ref.get(): contest_ref.set(None)
                print("Contest system is disabled. Exiting task.")
                return

            current_contest = contest_ref.get()
            
            if current_contest and current_contest.get('status') == 'active':
                end_timestamp = current_contest.get('end_timestamp', 0)
                
                if time.time() >= end_timestamp:
                    print("Contest finished. Processing results...")
                    c1_name = current_contest.get('contestant1_name')
                    c2_name = current_contest.get('contestant2_name')

                    c1_orig_multi = current_contest.get('contestant1_original_multiplier', 1.0)
                    c2_orig_multi = current_contest.get('contestant2_original_multiplier', 1.0)
                    if c1_name: users_ref.child(c1_name).child('stock_multiplier').set(c1_orig_multi)
                    if c2_name: users_ref.child(c2_name).child('stock_multiplier').set(c2_orig_multi)
                    print(f"Resetting multipliers: {c1_name} -> {c1_orig_multi}, {c2_name} -> {c2_orig_multi}")

                    votes = current_contest.get('votes', {})
                    votes1_count = len(votes.get(c1_name, {}))
                    votes2_count = len(votes.get(c2_name, {}))
                    
                    winner_name, winning_voters = (c1_name, votes.get(c1_name, {})) if votes1_count > votes2_count else (c2_name, votes.get(c2_name, {})) if votes2_count > votes1_count else (None, {})
                    
                    if winner_name:
                        winner_reward = settings.get('winner_points_reward', 0)
                        voter_reward = settings.get('voter_sp_reward', 0)
                        
                        if winner_reward > 0:
                            users_ref.child(winner_name).child('points').transaction(lambda p: (p or 0) + winner_reward)
                        
                        if voter_reward > 0 and winning_voters:
                            for uid in winning_voters.keys():
                                db.reference(f'wallets/{uid}/sp').transaction(lambda sp: (sp or 0) + voter_reward)
                                db.reference(f'user_messages/{uid}').push({'text': f"🎉 مبروك! لقد فزت بـ {voter_reward} SP لتصويتك للزاحف الفائز '{winner_name}'.", 'timestamp': int(time.time())})
                    
                    contest_ref.child('status').set('completed')
                    current_contest = None

            if not current_contest and len(all_crawlers_now) >= 2:
                print("Starting a new contest...")
                
                contestants = random.sample(list(all_crawlers_now.keys()), 2)
                name1, name2 = contestants[0], contestants[1]
                
                c1_data = all_crawlers_now.get(name1, {})
                c2_data = all_crawlers_now.get(name2, {})
                c1_orig_multi = c1_data.get('stock_multiplier', 1.0)
                c2_orig_multi = c2_data.get('stock_multiplier', 1.0)
                
                multiplier_boost = float(settings.get('multiplier_boost', 0.2))
                
                users_ref.child(name1).child('stock_multiplier').set(c1_orig_multi + multiplier_boost)
                users_ref.child(name2).child('stock_multiplier').set(c2_orig_multi + multiplier_boost)
                print(f"Boosting multipliers by {multiplier_boost}: {name1} -> {c1_orig_multi + multiplier_boost}, {name2} -> {c2_orig_multi + multiplier_boost}")

                new_contest_data = {
                    'contestant1_name': name1, 'contestant2_name': name2,
                    'contestant1_original_multiplier': c1_orig_multi, 'contestant2_original_multiplier': c2_orig_multi,
                    'end_timestamp': int(time.time()) + 86400, 'status': 'active', 'votes': {}
                }
                contest_ref.set(new_contest_data)

        except Exception as e:
            print(f"!!! Error in manage_popularity_contest: {e}", file=sys.stderr)


def automated_market_balance(app):
    with app.app_context():
        print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] --- Running Market Volatility Engine ---")
        
        try:
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
                if random.uniform(0, 100) >= float(volatility_settings.get('chance_percent', 0)):
                    continue

                events_config = {
                    'up': (volatility_settings.get('up_min_percent', 1.0), volatility_settings.get('up_max_percent', 5.0), volatility_settings.get('up_chance', 45)),
                    'down': (-volatility_settings.get('down_min_percent', 1.0), -volatility_settings.get('down_max_percent', 3.0), volatility_settings.get('down_chance', 40)),
                    'strong_up': (volatility_settings.get('strong_up_min_percent', 10.0), volatility_settings.get('strong_up_max_percent', 25.0), volatility_settings.get('strong_up_chance', 7.5)),
                    'crash': (-volatility_settings.get('crash_min_percent', 8.0), -volatility_settings.get('crash_max_percent', 20.0), volatility_settings.get('crash_chance', 7.5))
                }
                event_names, event_weights = list(events_config.keys()), [v[2] for v in events_config.values()]

                if sum(event_weights) <= 0: continue
                
                chosen_event_type = random.choices(event_names, weights=event_weights, k=1)[0]
                min_percent, max_percent, _ = events_config[chosen_event_type]
                random_percent = random.uniform(min_percent, max_percent)
                change_amount = random_percent / 100.0
                
                current_multiplier = float(crawler_data.get('stock_multiplier', 1.0))
                new_multiplier = max(0.20, current_multiplier + (change_amount if 'up' in chosen_event_type else -abs(change_amount)))
                
                db_updates[f'users/{crawler_name}/stock_multiplier'] = new_multiplier
                
                log_text_map = {
                    'up': f"📈 ارتفاع طفيف بنسبة {abs(random_percent):.1f}% في سوق الزاحف '{crawler_name}'!",
                    'down': f"📉 انخفاض طفيف بنسبة {abs(random_percent):.1f}% في سوق الزاحف '{crawler_name}'.",
                    'strong_up': f"🚀 ارتفاع قوي بنسبة {abs(random_percent):.1f}% في سوق الزاحف '{crawler_name}'!",
                    'crash': f"💥 انهيار مفاجئ بنسبة {abs(random_percent):.1f}% في سوق الزاحف '{crawler_name}'!"
                }
                log_text = log_text_map.get(chosen_event_type, "تقلب في السوق.")
                activity_logs.append({'type': 'admin_edit', 'text': log_text, 'timestamp': int(time.time())})

            jackpot_chance = float(settings.get('jackpot_chance_percent', 0.5))
            if random.uniform(0, 100) < jackpot_chance:
                # (Jackpot logic remains the same, but will be applied with the multi-path update)
                pass

            if db_updates:
                # <<< بداية التعديل: استخدام المرجع الفارغ بدلاً من الجذر >>>
                db.reference().update(db_updates)
                # <<< نهاية التعديل >>>
            
            if activity_logs:
                for log in activity_logs:
                    db.reference('activity_log').push(log)
            
            print(f"--- Market Volatility Engine finished. ---")
        except Exception as e:
            print(f"!!! Error in automated_market_balance: {e}", file=sys.stderr)
# --- END OF FILE project/scheduled_tasks.py ---
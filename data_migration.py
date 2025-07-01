import os
import sys
import time
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, db

def migrate_investment_data_final():
    """
    FINAL MIGRATION SCRIPT:
    This script runs once after restoring a backup. It correctly migrates the
    original investment data structure to the new "lots" structure, ensuring
    no data loss and handling edge cases.
    """
    print("FINAL MIGRATION SCRIPT: Loading environment variables...")
    load_dotenv()

    try:
        SERVICE_ACCOUNT_FILE = os.getenv('FIREBASE_SERVICE_ACCOUNT')
        FIREBASE_DATABASE_URL = os.getenv('FIREBASE_DATABASE_URL')
        
        if not SERVICE_ACCOUNT_FILE or not os.path.exists(SERVICE_ACCOUNT_FILE):
            raise ValueError(f"Service account key file '{SERVICE_ACCOUNT_FILE}' not found.")
            
        cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
        
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred, {'databaseURL': FIREBASE_DATABASE_URL})
        
        print(">> Successfully connected to Firebase.")

    except Exception as e:
        print(f"!!! CRITICAL ERROR: Could not connect to Firebase: {e}", file=sys.stderr)
        sys.exit(1)

    print("\nStarting final data migration for 'investments' node...")
    investments_ref = db.reference('investments')
    
    try:
        all_investments = investments_ref.get()
    except Exception as e:
        print(f"!!! DATABASE READ ERROR: Could not fetch investments. Error: {e}", file=sys.stderr)
        sys.exit(1)


    if not all_investments:
        print("No investments found to migrate. Exiting.")
        return

    updates_to_apply = {}
    total_records_processed = 0
    records_to_migrate = 0
    
    for user_id, user_investments in all_investments.items():
        if not isinstance(user_investments, dict):
            continue
            
        for crawler_name, investment_data in user_investments.items():
            total_records_processed += 1
            # Check if this record is in the old format and needs migration.
            # An old record is a dictionary that does NOT have a 'lots' key.
            if isinstance(investment_data, dict) and 'lots' not in investment_data:
                
                print(f"  - Migrating: User '{user_id}' / Crawler '{crawler_name}'")
                
                invested_sp = investment_data.get('invested_sp')
                points_at_inv = investment_data.get('points_at_investment')
                timestamp = investment_data.get('timestamp')
                
                # Basic validation to prevent migrating corrupted or invalid data
                if invested_sp is None or points_at_inv is None or not isinstance(invested_sp, (int, float)) or invested_sp <= 0:
                    print(f"    ! SKIPPING: Invalid or missing data for this record. Data: {investment_data}")
                    continue

                # If timestamp is missing, use a default past timestamp to avoid conflicts.
                if timestamp is None:
                    timestamp = int(time.time()) - 3600 # Default to one hour ago
                    print(f"    * WARNING: Timestamp missing. Using default: {timestamp}")

                timestamp_key = str(timestamp)
                
                # Construct the new data structure with a single "lot"
                new_investment_structure = {
                    "lots": {
                        timestamp_key: {
                            "sp": float(invested_sp),
                            "p": int(points_at_inv)
                        }
                    }
                }
                
                # The path to update is the entire investment record for that crawler
                update_path = f'investments/{user_id}/{crawler_name}'
                updates_to_apply[update_path] = new_investment_structure
                records_to_migrate += 1

    print(f"\nProcessed {total_records_processed} total investment records.")

    if not updates_to_apply:
        print("All investment data is already in the new format. No migration needed.")
        return

    try:
        print(f"Found {records_to_migrate} records to migrate. Applying changes to the database...")
        investments_ref.update(updates_to_apply)
        print("\n==========================================================")
        print(">> FINAL MIGRATION SUCCESSFUL!")
        print(">> All old investments have been correctly converted.")
        print("==========================================================")
    except Exception as e:
        print(f"!!! FATAL ERROR: Failed to apply updates to Firebase: {e}", file=sys.stderr)
        print("!!! Your data might be in an inconsistent state. Please review.")

if __name__ == '__main__':
    migrate_investment_data_final()
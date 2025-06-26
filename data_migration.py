import os
import sys
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, db

def migrate_data():
    """
    This script runs once to fix the data structure in Firebase.
    It iterates through all users and ensures each user object has a 'name' property
    that matches its key.
    """
    # --- Load Environment and Initialize Firebase ---
    print("Loading environment variables...")
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

    # --- Start Migration Logic ---
    print("\nStarting data migration for 'users' node...")
    users_ref = db.reference('users')
    all_users = users_ref.get()

    if not all_users:
        print("No users found to migrate. Exiting.")
        return

    updates = {}
    fixed_count = 0
    
    for name_key, user_data in all_users.items():
        # Check if user_data is a valid dictionary and if 'name' property is missing or mismatched
        if isinstance(user_data, dict) and user_data.get('name') != name_key:
            print(f"Fixing user: '{name_key}'. Setting 'name' property to match key.")
            # Prepare an update for this user
            updates[f'{name_key}/name'] = name_key
            fixed_count += 1

    if not updates:
        print("All user data is already consistent. No migration needed.")
        return

    # Apply all updates in one go
    try:
        print(f"\nFound {fixed_count} users to update. Applying changes...")
        users_ref.update(updates)
        print(">> Migration successful! All users now have a 'name' property matching their key.")
    except Exception as e:
        print(f"!!! ERROR: Failed to apply updates to Firebase: {e}", file=sys.stderr)

if __name__ == '__main__':
    migrate_data()
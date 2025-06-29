# --- START OF FILE project/utils.py ---

import sys
from functools import wraps
from flask import session, redirect, url_for, flash, jsonify, request
from firebase_admin import db
from google.auth.exceptions import RefreshError, TransportError
from firebase_admin.exceptions import FirebaseError

def login_required(f):
    """
    Decorator that redirects to login page if user is not in session.
    Handles API requests by returning a JSON error.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            # For API endpoints, return JSON
            if request.path.startswith('/api/'):
                return jsonify(success=False, message="مستخدم غير مصادق عليه"), 401
            # For web pages, redirect to login
            return redirect(url_for('auth.login_page'))
        return f(*args, **kwargs)
    return decorated_function


def admin_required(f):
    """
    Decorator that checks for admin role. Must be used AFTER @login_required.
    Handles API requests by returning a JSON error.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # The login_required decorator should have already run, but we check again for safety.
        if 'user_id' not in session:
            if request.path.startswith('/api/'):
                return jsonify(success=False, message="مستخدم غير مصادق عليه"), 401
            return redirect(url_for('auth.login_page'))

        if session.get('role') != 'admin':
            # For API endpoints, return JSON error
            if request.path.startswith('/api/'):
                return jsonify(success=False, message="الوصول مرفوض. صلاحيات المسؤول مطلوبة."), 403
            # For web pages, flash a message and redirect
            flash('ليس لديك الصلاحية للوصول لهذه الصفحة.', 'danger')
            return redirect(url_for('views.home'))
            
        return f(*args, **kwargs)
    return decorated_function


def check_user_status(uid):
    """
    Checks the status of a user (banned, approved, pending) from the database.
    This function is now centralized to be used by multiple blueprints.
    """
    try:
        ref_registered_users = db.reference('registered_users/')
        ref_banned_users = db.reference('banned_users/')
        
        if ref_banned_users.child(uid).get():
            return 'banned', None
        
        user_data = ref_registered_users.child(uid).get()
        if not user_data:
            return 'not_found', None
            
        return user_data.get('status', 'pending'), user_data
    except (RefreshError, TransportError, FirebaseError) as e:
        # This specifically catches server-to-google authentication issues (like clock skew)
        print(f"!!! SERVER AUTHENTICATION ERROR in check_user_status: {e}", file=sys.stderr)
        print("!!! This is likely a server environment issue (e.g., incorrect system clock or revoked credentials).", file=sys.stderr)
        return 'auth_error', None
    except Exception as e:
        # This catches other unexpected database errors
        print(f"Error in check_user_status: {e}", file=sys.stderr)
        return 'db_error', None

# --- END OF FILE project/utils.py ---
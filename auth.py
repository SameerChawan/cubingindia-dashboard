"""Authentication module for CubingIndia Dashboard."""
import hashlib
import secrets
from functools import wraps
from flask import request, jsonify, session, redirect, url_for
import db


def hash_password(password):
    salt = secrets.token_hex(16)
    h = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}${h}"


def verify_password(stored, password):
    if "$" not in stored:
        return False
    salt, h = stored.split("$", 1)
    return hashlib.sha256((salt + password).encode()).hexdigest() == h


def get_user(username):
    rows = db.query("ci_users", filters={"username": f"eq.{username}"}, limit=1)
    return rows[0] if rows else None


def create_user(username, password, display_name=None):
    pw_hash = hash_password(password)
    return db.insert("ci_users", {
        "username": username,
        "password_hash": pw_hash,
        "display_name": display_name or username,
    })


def authenticate(username, password):
    user = get_user(username)
    if user and verify_password(user["password_hash"], password):
        return user
    return None


def login_required(f):
    """Decorator to protect API routes. Returns 401 if not logged in."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({"ok": False, "msg": "Authentication required"}), 401
        return f(*args, **kwargs)
    return decorated

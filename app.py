"""CubingIndia Dashboard - Flask App (v4 with Auth + PWA)."""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, render_template, request, session, redirect, url_for
from api.routes import api
import auth
import db
from config import SUPABASE_URL, SUPABASE_KEY

app = Flask(__name__,
            template_folder="templates",
            static_folder="static")
app.secret_key = os.environ.get("FLASK_SECRET", "cubingindia-change-this-secret-key-2026")

# Ensure proper static file serving for PWA
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 31536000  # 1 year cache for static assets

app.register_blueprint(api)


# ── Auth Routes ──────────────────────────────────────

@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = auth.authenticate(username, password)
        if user:
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            session["display_name"] = user.get("display_name", user["username"])
            return redirect("/")
        error = "Invalid username or password"
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/login")


@app.route("/setup", methods=["GET", "POST"])
def setup():
    """First-time setup: create admin user if none exists."""
    existing = db.query("ci_users", limit=1)
    if existing:
        return redirect("/login")

    error = None
    success = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        confirm = request.form.get("confirm", "")

        if not username or not password:
            error = "Username and password required"
        elif len(password) < 6:
            error = "Password must be at least 6 characters"
        elif password != confirm:
            error = "Passwords don't match"
        else:
            result = auth.create_user(username, password, username)
            if result:
                success = "Account created! Redirecting to login..."
            else:
                error = "Failed to create account (username may already exist)"

    return render_template("setup.html", error=error, success=success)


@app.before_request
def require_auth():
    """Protect all routes except login, setup, and static files."""
    path = request.path
    # Allow public routes
    if path in ("/login", "/setup", "/logout"):
        return
    if path.startswith("/static/"):
        return
    # If no users exist yet, redirect to setup
    if not session.get("user_id"):
        existing = db.query("ci_users", limit=1)
        if not existing:
            return redirect("/setup")
        return redirect("/login")


@app.after_request
def sw_no_cache(response):
    """Service worker must never be cached, otherwise updates never reach clients."""
    if request.path == "/static/sw.js":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.route("/")
def index():
    return render_template("index.html",
                           display_name=session.get("display_name", "User"))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=True)

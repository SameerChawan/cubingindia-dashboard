"""Supabase database client for CubingIndia Dashboard."""
import json
import urllib.request
import urllib.error
import urllib.parse
from config import SUPABASE_URL, SUPABASE_KEY


def _headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _read_error(e):
    """Extract error body from HTTPError."""
    if isinstance(e, urllib.error.HTTPError):
        try:
            return e.read().decode("utf-8")
        except Exception:
            pass
    return str(e)


def query(table, filters=None, select="*", order=None, limit=None):
    """SELECT with optional filters."""
    params = {"select": select}
    if order:
        params["order"] = order
    if limit:
        params["limit"] = str(limit)
    if filters:
        params.update(filters)

    qs = urllib.parse.urlencode(params, doseq=True)
    url = f"{SUPABASE_URL}/rest/v1/{table}?{qs}"
    req = urllib.request.Request(url, headers=_headers(), method="GET")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = _read_error(e)
        print(f"[DB ERROR] query {table}: {e.code} {body}")
        return []
    except Exception as e:
        print(f"[DB ERROR] query {table}: {e}")
        return []


def insert(table, data):
    """INSERT row(s). Returns inserted rows or None with error details."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=_headers(), method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = _read_error(e)
        print(f"[DB ERROR] insert {table}: {e.code} {err_body}")
        return None
    except Exception as e:
        print(f"[DB ERROR] insert {table}: {e}")
        return None


def update(table, data, filters):
    """UPDATE rows matching filters. Returns updated rows."""
    qs = urllib.parse.urlencode(filters, doseq=True)
    url = f"{SUPABASE_URL}/rest/v1/{table}?{qs}"
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=_headers(), method="PATCH")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = _read_error(e)
        print(f"[DB ERROR] update {table}: {e.code} {err_body}")
        return None
    except Exception as e:
        print(f"[DB ERROR] update {table}: {e}")
        return None


def delete(table, filters):
    """DELETE rows matching filters."""
    qs = urllib.parse.urlencode(filters, doseq=True)
    url = f"{SUPABASE_URL}/rest/v1/{table}?{qs}"
    req = urllib.request.Request(url, headers=_headers(), method="DELETE")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as e:
        err_body = _read_error(e)
        print(f"[DB ERROR] delete {table}: {e.code} {err_body}")
        return False
    except Exception as e:
        print(f"[DB ERROR] delete {table}: {e}")
        return False


def rpc(function_name, params=None):
    """Call a Supabase Edge Function / RPC."""
    url = f"{SUPABASE_URL}/rest/v1/rpc/{function_name}"
    body = json.dumps(params or {}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=_headers(), method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[DB ERROR] rpc {function_name}: {e}")
        return None

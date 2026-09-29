#!/usr/bin/env python3
"""After running sql/002_admin_content_agenda.sql in Supabase, run:
   python3 scripts/finish-bootstrap.py

Creates/updates admin profile + seeds 3 consultores.
Reads .env.local. Does not print the password (already created).
"""
import json, os, urllib.request, urllib.error
from pathlib import Path

def load_env():
    p = Path(__file__).resolve().parents[1] / ".env.local"
    for line in p.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

load_env()
URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ.get("SUPABASE_SECRET_KEY") or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
EMAIL = "rafael@voll.com.br"

def req(method, path, body=None, prefer=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}
    if prefer: headers["Prefer"] = prefer
    r = urllib.request.Request(URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as res:
            raw = res.read().decode()
            return res.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

st, users = req("GET", "/auth/v1/admin/users?page=1&per_page=100")
user = None
for u in (users or {}).get("users") or []:
    if (u.get("email") or "").lower() == EMAIL:
        user = u
        break
if not user:
    raise SystemExit("Admin user not found. Create via Auth first.")

st, _ = req("GET", "/rest/v1/lp_content?select=id&limit=1")
if st >= 400:
    raise SystemExit("Tables missing. Run sql/002_admin_content_agenda.sql in Supabase SQL Editor first.")

st, prof = req("POST", "/rest/v1/profiles?on_conflict=id", {
    "id": user["id"],
    "role": "admin",
    "name": "Rafael Juliano"
}, prefer="resolution=merge-duplicates,return=representation")
print("profile", st)

st, cons = req("GET", "/rest/v1/consultants?select=id")
if st == 200 and isinstance(cons, list) and not cons:
    st, _ = req("POST", "/rest/v1/consultants", [
        {"name": "Consultor 1", "note": "Conversa de 20 min"},
        {"name": "Consultor 2", "note": "Conversa de 20 min"},
        {"name": "Consultor 3", "note": "Conversa de 20 min"},
        {"name": "Consultor 4", "note": "Conversa de 20 min"},
    ], prefer="return=representation")
    print("consultants seeded", st)
else:
    print("consultants ok", st, len(cons or []))

print("DONE", EMAIL)

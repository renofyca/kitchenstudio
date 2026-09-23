"""KitchenStudio backend — FastAPI + stdlib only.

Serves the JSON API under /api and (when present) the static frontend
from the repo's frontend/ directory at /.
"""
import csv
import hashlib
import io
import json
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.layout import autodesign, APPLIANCE_RE

REPO = Path(__file__).resolve().parent.parent
DATA_DIR = Path(__file__).resolve().parent / "data"
DB_PATH = DATA_DIR / "kitchenstudio.db"
FRONTEND_DIR = REPO / "frontend"

CATEGORIES = {"base", "wall", "tall", "panel", "filler", "appliance",
              "accessory"}
CSV_COLUMNS = ["sku", "category", "description", "width_in", "height_in",
               "depth_in", "price", "notes"]
CORNER_STYLES = {"easy", "blind", "lazy"}
WALL_HEIGHTS = {30, 36, 42}

app = FastAPI(title="KitchenStudio API")


# --------------------------------------------------------------------------
# database
# --------------------------------------------------------------------------

def _db():
    fresh = not DB_PATH.exists()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    if fresh:
        # brand-new empty file: create the schema on this connection
        _create_tables(conn)
    return conn


def _create_tables(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            pw_hash TEXT NOT NULL,
            pw_salt TEXT NOT NULL,
            created TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            created TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS catalogs (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            created TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS catalog_items (
            id INTEGER PRIMARY KEY,
            catalog_id INTEGER NOT NULL REFERENCES catalogs(id),
            sku TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT NOT NULL,
            width_in REAL NOT NULL,
            height_in REAL NOT NULL,
            depth_in REAL NOT NULL,
            price REAL,
            notes TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_items_catalog
            ON catalog_items(catalog_id);
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            catalog_id INTEGER NOT NULL REFERENCES catalogs(id),
            name TEXT NOT NULL,
            room_json TEXT NOT NULL,
            design_json TEXT,
            updated TEXT NOT NULL
        );
    """)
    conn.commit()


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = _db()
    _create_tables(conn)
    conn.close()


@app.on_event("startup")
def _startup():
    init_db()


# Also initialize at import time: init_db() is idempotent, and this makes
# the app work when embedded without lifespan startup events running.
init_db()


def _now():
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------
# auth helpers
# --------------------------------------------------------------------------

def _hash_pw(password, salt_hex):
    salt = bytes.fromhex(salt_hex)
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                               salt, 200_000).hex()


def _bearer_token(request: Request):
    auth = request.headers.get("authorization", "")
    m = re.match(r"(?i)^bearer\s+(\S+)$", auth.strip())
    return m.group(1) if m else None


def _current_user(request: Request):
    token = _bearer_token(request)
    if not token:
        return None
    conn = _db()
    try:
        row = conn.execute(
            "SELECT u.id, u.email, u.name FROM sessions s "
            "JOIN users u ON u.id = s.user_id WHERE s.token = ?",
            (token,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _require_user(request: Request):
    user = _current_user(request)
    if user is None:
        return None, JSONResponse(status_code=401,
                                 content={"error": "unauthorized"})
    return user, None


def _err(status, message, **extra):
    return JSONResponse(status_code=status,
                        content={"error": message, **extra})


# --------------------------------------------------------------------------
# multipart parsing (stdlib only — no python-multipart dependency)
# --------------------------------------------------------------------------

def _parse_multipart(body: bytes, content_type: str):
    """Parse multipart/form-data with stdlib. Returns
    {name: (filename_or_None, bytes)}."""
    m = re.search(r'boundary=([^;]+)', content_type or "")
    if not m:
        return {}
    boundary = m.group(1).strip().strip('"').encode("ascii", "ignore")
    fields = {}
    for part in body.split(b"--" + boundary):
        if part in (b"", b"--", b"--\r\n"):
            continue
        if part.startswith(b"\r\n"):
            part = part[2:]
        if part.endswith(b"--"):
            part = part[:-2]
        if part.endswith(b"\r\n"):
            part = part[:-2]
        if b"\r\n\r\n" not in part:
            continue
        head, content = part.split(b"\r\n\r\n", 1)
        disp = ""
        for line in head.decode("latin-1").split("\r\n"):
            if line.lower().startswith("content-disposition:"):
                disp = line.split(":", 1)[1]
        nm = re.search(r'name="([^"]*)"', disp)
        fn = re.search(r'filename="([^"]*)"', disp)
        if not nm:
            continue
        fields[nm.group(1)] = (fn.group(1) if fn else None, content)
    return fields


# --------------------------------------------------------------------------
# validation helpers
# --------------------------------------------------------------------------

def _is_num(v):
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def validate_catalog_csv(text):
    """Returns (rows, bad_rows). rows: list of dicts ready for insert."""
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        return [], [{"row": 1, "sku": "", "reason": "empty file"}]
    missing = [c for c in CSV_COLUMNS if c not in reader.fieldnames]
    if missing:
        return [], [{"row": 1, "sku": "",
                     "reason": f"missing columns: {', '.join(missing)}"}]
    rows, bad, seen = [], [], set()
    for i, rec in enumerate(reader, start=2):
        sku = (rec.get("sku") or "").strip()
        problems = []
        if not sku:
            problems.append("sku is empty")
        elif sku in seen:
            problems.append(f"duplicate sku '{sku}' in file")
        seen.add(sku)
        cat = (rec.get("category") or "").strip()
        if cat not in CATEGORIES:
            problems.append(f"category '{cat}' not in "
                            f"{sorted(CATEGORIES)}")
        for dim in ("width_in", "height_in", "depth_in"):
            v = (rec.get(dim) or "").strip()
            if not _is_num(v) or float(v) <= 0:
                problems.append(f"{dim} must be numeric > 0 (got '{v}')")
        price_raw = (rec.get("price") or "").strip()
        price = None
        if price_raw != "":
            if not _is_num(price_raw) or float(price_raw) < 0:
                problems.append(f"price must be numeric >= 0 (got "
                                f"'{price_raw}')")
            else:
                price = float(price_raw)
        if problems:
            bad.append({"row": i, "sku": sku,
                        "reason": "; ".join(problems)})
            continue
        rows.append({
            "sku": sku, "category": cat,
            "description": (rec.get("description") or "").strip(),
            "width_in": float(rec["width_in"]),
            "height_in": float(rec["height_in"]),
            "depth_in": float(rec["depth_in"]),
            "price": price,
            "notes": (rec.get("notes") or "").strip(),
        })
    return rows, bad


def validate_room(room):
    """Loose room-shape validation. Returns error string or None."""
    if not isinstance(room, dict):
        return "room must be an object"
    walls = room.get("walls")
    if not isinstance(walls, list) or not walls:
        return "room.walls must be a non-empty list"
    for w in walls:
        if not isinstance(w, dict) or "id" not in w:
            return "each wall needs an id"
        if not _is_num(w.get("length_in")) or float(w["length_in"]) <= 0:
            return f"wall '{w.get('id')}' needs length_in > 0"
        # contract shape: openings live on each wall; a legacy flat
        # room.openings list (with wall_id) is also accepted.
        wops = w.get("openings", [])
        if not isinstance(wops, list):
            return f"wall '{w.get('id')}' openings must be a list"
        err = _validate_openings(wops)
        if err:
            return f"wall '{w.get('id')}': {err}"
    openings = room.get("openings", [])
    if not isinstance(openings, list):
        return "room.openings must be a list"
    err = _validate_openings(openings)
    if err:
        return err
    return None


def _validate_openings(openings):
    """Validate a list of opening dicts. Returns error string or None."""
    for op in openings:
        if not isinstance(op, dict):
            return "each opening must be an object"
        if op.get("kind") not in {"window", "door", "opening"}:
            return (f"opening kind must be one of window/door/opening "
                    f"(got '{op.get('kind')}')")
        for k in ("at_in", "width_in"):
            if not _is_num(op.get(k)):
                return f"opening needs numeric {k}"
        for k in ("sill_in", "height_in"):
            if k in op and op[k] not in (None, "") and not _is_num(op[k]):
                return f"opening {k} must be numeric if given"
    return None


# --------------------------------------------------------------------------
# auth routes
# --------------------------------------------------------------------------

@app.post("/api/auth/signup")
async def signup(request: Request):
    try:
        body = await request.json()
    except Exception:
        return _err(400, "invalid JSON body")
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    name = (body.get("name") or "").strip()
    if not email or not password or not name:
        return _err(400, "email, password and name are required")
    conn = _db()
    try:
        if conn.execute("SELECT id FROM users WHERE email = ?",
                        (email,)).fetchone():
            return _err(400, "email already registered")
        salt = secrets.token_hex(16)
        pw_hash = _hash_pw(password, salt)
        cur = conn.execute(
            "INSERT INTO users (email, name, pw_hash, pw_salt, created) "
            "VALUES (?, ?, ?, ?, ?)",
            (email, name, pw_hash, salt, _now()))
        user_id = cur.lastrowid
        token = secrets.token_hex(32)
        conn.execute("INSERT INTO sessions (token, user_id, created) "
                     "VALUES (?, ?, ?)", (token, user_id, _now()))
        conn.commit()
    finally:
        conn.close()
    return {"token": token,
            "user": {"id": user_id, "email": email, "name": name}}


@app.post("/api/auth/login")
async def login(request: Request):
    try:
        body = await request.json()
    except Exception:
        return _err(400, "invalid JSON body")
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    conn = _db()
    try:
        row = conn.execute("SELECT * FROM users WHERE email = ?",
                           (email,)).fetchone()
        if row is None or _hash_pw(password, row["pw_salt"]) != row["pw_hash"]:
            return _err(401, "invalid email or password")
        token = secrets.token_hex(32)
        conn.execute("INSERT INTO sessions (token, user_id, created) "
                     "VALUES (?, ?, ?)", (token, row["id"], _now()))
        conn.commit()
    finally:
        conn.close()
    return {"token": token,
            "user": {"id": row["id"], "email": row["email"],
                     "name": row["name"]}}


@app.post("/api/auth/logout")
async def logout(request: Request):
    token = _bearer_token(request)
    if token:
        conn = _db()
        try:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            conn.commit()
        finally:
            conn.close()
    return {"ok": True}


# --------------------------------------------------------------------------
# catalog routes
# --------------------------------------------------------------------------

@app.get("/api/catalogs")
async def list_catalogs(request: Request):
    user, err = _require_user(request)
    if err:
        return err
    conn = _db()
    try:
        rows = conn.execute(
            "SELECT c.id, c.name, c.created, COUNT(i.id) AS item_count "
            "FROM catalogs c LEFT JOIN catalog_items i "
            "ON i.catalog_id = c.id WHERE c.user_id = ? "
            "GROUP BY c.id ORDER BY c.id",
            (user["id"],)).fetchall()
        return [{"id": r["id"], "name": r["name"],
                 "item_count": r["item_count"], "created": r["created"]}
                for r in rows]
    finally:
        conn.close()


@app.post("/api/catalogs")
async def upload_catalog(request: Request):
    user, err = _require_user(request)
    if err:
        return err
    ctype = request.headers.get("content-type", "")
    if "multipart/form-data" not in ctype:
        return _err(400, "expected multipart/form-data")
    body = await request.body()
    fields = _parse_multipart(body, ctype)
    if "file" not in fields or fields["file"][0] is None:
        return _err(400, "multipart field 'file' (CSV) is required")
    if "name" not in fields:
        return _err(400, "multipart field 'name' is required")
    name = fields["name"][1].decode("utf-8", "replace").strip()
    if not name:
        return _err(400, "catalog name must not be empty")
    try:
        text = fields["file"][1].decode("utf-8-sig")
    except UnicodeDecodeError:
        return _err(400, "CSV must be UTF-8 encoded")
    rows, bad_rows = validate_catalog_csv(text)
    if bad_rows:
        return _err(400, "CSV validation failed", bad_rows=bad_rows)
    conn = _db()
    try:
        cur = conn.execute(
            "INSERT INTO catalogs (user_id, name, created) VALUES (?, ?, ?)",
            (user["id"], name, _now()))
        catalog_id = cur.lastrowid
        conn.executemany(
            "INSERT INTO catalog_items (catalog_id, sku, category, "
            "description, width_in, height_in, depth_in, price, notes) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [(catalog_id, r["sku"], r["category"], r["description"],
              r["width_in"], r["height_in"], r["depth_in"], r["price"],
              r["notes"]) for r in rows])
        conn.commit()
    finally:
        conn.close()
    return {"id": catalog_id, "item_count": len(rows)}


@app.get("/api/catalogs/{catalog_id}")
async def get_catalog(catalog_id: int, request: Request):
    user, err = _require_user(request)
    if err:
        return err
    conn = _db()
    try:
        cat = conn.execute(
            "SELECT id, name FROM catalogs WHERE id = ? AND user_id = ?",
            (catalog_id, user["id"])).fetchone()
        if cat is None:
            return _err(404, "catalog not found")
        items = conn.execute(
            "SELECT sku, category, description, width_in, height_in, "
            "depth_in, price, notes FROM catalog_items "
            "WHERE catalog_id = ? ORDER BY id",
            (catalog_id,)).fetchall()
        return {"id": cat["id"], "name": cat["name"],
                "items": [dict(i) for i in items]}
    finally:
        conn.close()


@app.delete("/api/catalogs/{catalog_id}")
async def delete_catalog(catalog_id: int, request: Request):
    user, err = _require_user(request)
    if err:
        return err
    conn = _db()
    try:
        cat = conn.execute(
            "SELECT id FROM catalogs WHERE id = ? AND user_id = ?",
            (catalog_id, user["id"])).fetchone()
        if cat is None:
            return _err(404, "catalog not found")
        refs = conn.execute(
            "SELECT id, name FROM projects WHERE catalog_id = ?",
            (catalog_id,)).fetchall()
        if refs:
            names = ", ".join(f"'{r['name']}' (id {r['id']})" for r in refs)
            return _err(400, f"catalog is referenced by project(s): {names}; "
                             f"delete or reassign those projects first")
        conn.execute("DELETE FROM catalog_items WHERE catalog_id = ?",
                     (catalog_id,))
        conn.execute("DELETE FROM catalogs WHERE id = ?", (catalog_id,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


def _catalog_items_for(conn, catalog_id):
    rows = conn.execute(
        "SELECT sku, category, description, width_in, height_in, depth_in, "
        "price, notes FROM catalog_items WHERE catalog_id = ?",
        (catalog_id,)).fetchall()
    return [dict(r) for r in rows]


# --------------------------------------------------------------------------
# project routes
# --------------------------------------------------------------------------

@app.get("/api/projects")
async def list_projects(request: Request):
    user, err = _require_user(request)
    if err:
        return err
    conn = _db()
    try:
        rows = conn.execute(
            "SELECT id, name, catalog_id, updated FROM projects "
            "WHERE user_id = ? ORDER BY id",
            (user["id"],)).fetchall()
        return [{"id": r["id"], "name": r["name"],
                 "catalog_id": r["catalog_id"], "updated": r["updated"]}
                for r in rows]
    finally:
        conn.close()


def _get_project(conn, project_id, user_id):
    return conn.execute(
        "SELECT * FROM projects WHERE id = ? AND user_id = ?",
        (project_id, user_id)).fetchone()


@app.post("/api/projects")
async def create_project(request: Request):
    user, err = _require_user(request)
    if err:
        return err
    try:
        body = await request.json()
    except Exception:
        return _err(400, "invalid JSON body")
    name = (body.get("name") or "").strip()
    catalog_id = body.get("catalog_id")
    room = body.get("room")
    if not name:
        return _err(400, "name is required")
    if not isinstance(catalog_id, int):
        return _err(400, "catalog_id is required")
    room_err = validate_room(room)
    if room_err:
        return _err(400, room_err)
    conn = _db()
    try:
        cat = conn.execute(
            "SELECT id FROM catalogs WHERE id = ? AND user_id = ?",
            (catalog_id, user["id"])).fetchone()
        if cat is None:
            return _err(400, "catalog not found or not owned by you")
        cur = conn.execute(
            "INSERT INTO projects (user_id, catalog_id, name, room_json, "
            "design_json, updated) VALUES (?, ?, ?, ?, NULL, ?)",
            (user["id"], catalog_id, name, json.dumps(room), _now()))
        conn.commit()
        return {"id": cur.lastrowid}
    finally:
        conn.close()


@app.get("/api/projects/{project_id}")
async def get_project(project_id: int, request: Request):
    user, err = _require_user(request)
    if err:
        return err
    conn = _db()
    try:
        p = _get_project(conn, project_id, user["id"])
        if p is None:
            return _err(404, "project not found")
        return {"id": p["id"], "name": p["name"],
                "catalog_id": p["catalog_id"],
                "room": json.loads(p["room_json"]),
                "design": json.loads(p["design_json"])
                if p["design_json"] else None,
                "updated": p["updated"]}
    finally:
        conn.close()


@app.put("/api/projects/{project_id}")
async def update_project(project_id: int, request: Request):
    user, err = _require_user(request)
    if err:
        return err
    try:
        body = await request.json()
    except Exception:
        return _err(400, "invalid JSON body")
    conn = _db()
    try:
        p = _get_project(conn, project_id, user["id"])
        if p is None:
            return _err(404, "project not found")
        updates, params = [], []
        if "name" in body:
            name = (body["name"] or "").strip()
            if not name:
                return _err(400, "name must not be empty")
            updates.append("name = ?")
            params.append(name)
        if "room" in body:
            room_err = validate_room(body["room"])
            if room_err:
                return _err(400, room_err)
            updates.append("room_json = ?")
            params.append(json.dumps(body["room"]))
        if not updates:
            return {"ok": True}
        updates.append("updated = ?")
        params.append(_now())
        params.append(project_id)
        conn.execute(f"UPDATE projects SET {', '.join(updates)} WHERE id = ?",
                     params)
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: int, request: Request):
    user, err = _require_user(request)
    if err:
        return err
    conn = _db()
    try:
        p = _get_project(conn, project_id, user["id"])
        if p is None:
            return _err(404, "project not found")
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# --------------------------------------------------------------------------
# autodesign + design + quote
# --------------------------------------------------------------------------

@app.post("/api/projects/{project_id}/autodesign")
async def run_autodesign(project_id: int, request: Request):
    user, err = _require_user(request)
    if err:
        return err
    try:
        body = await request.json()
    except Exception:
        return _err(400, "invalid JSON body")
    corner_style = body.get("corner_style")
    wall_h = body.get("wall_cabinet_height")
    if corner_style not in CORNER_STYLES:
        return _err(400, f"corner_style must be one of "
                         f"{sorted(CORNER_STYLES)}")
    if wall_h not in WALL_HEIGHTS:
        return _err(400, "wall_cabinet_height must be one of 30, 36, 42")
    conn = _db()
    try:
        p = _get_project(conn, project_id, user["id"])
        if p is None:
            return _err(404, "project not found")
        room = json.loads(p["room_json"])
        items = _catalog_items_for(conn, p["catalog_id"])
        design, warnings = autodesign(
            room, items,
            {"corner_style": corner_style, "wall_cabinet_height": wall_h})
        conn.execute("UPDATE projects SET design_json = ?, updated = ? "
                     "WHERE id = ?",
                     (json.dumps(design), _now(), project_id))
        conn.commit()
    finally:
        conn.close()
    return {"design": design, "warnings": warnings}


def _validate_design(design, catalog_skus):
    if not isinstance(design, dict):
        return "design must be an object"
    runs = design.get("runs")
    if not isinstance(runs, list):
        return "design.runs must be a list"
    unknown = []
    for run in runs:
        if not isinstance(run, dict):
            return "each run must be an object"
        items = run.get("items")
        if not isinstance(items, list):
            return "each run.items must be a list"
        for it in items:
            if not isinstance(it, dict):
                return "each design item must be an object"
            for key in ("sku", "at_in", "width_in", "category", "level"):
                if key not in it:
                    return f"design item missing '{key}'"
            if it["level"] not in ("base", "wall", "tall"):
                return (f"design item level must be base/wall/tall "
                        f"(got '{it['level']}')")
            sku = str(it["sku"])
            if sku not in catalog_skus and not APPLIANCE_RE.match(sku):
                unknown.append(sku)
    return unknown or None


@app.put("/api/projects/{project_id}/design")
async def save_design(project_id: int, request: Request):
    user, err = _require_user(request)
    if err:
        return err
    try:
        body = await request.json()
    except Exception:
        return _err(400, "invalid JSON body")
    design = body.get("design")
    conn = _db()
    try:
        p = _get_project(conn, project_id, user["id"])
        if p is None:
            return _err(404, "project not found")
        catalog_skus = {r["sku"] for r in
                        _catalog_items_for(conn, p["catalog_id"])}
        problem = _validate_design(design, catalog_skus)
        if isinstance(problem, str):
            return _err(400, problem)
        if problem:  # list of unknown SKUs
            return _err(400, f"unknown SKUs: {', '.join(sorted(set(problem)))}",
                         unknown_skus=sorted(set(problem)))
        conn.execute("UPDATE projects SET design_json = ?, updated = ? "
                     "WHERE id = ?",
                     (json.dumps(design), _now(), project_id))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


def _size_str(w, h, d):
    return f"{w:g}\"W \u00d7 {h:g}\"H \u00d7 {d:g}\"D"


def _placeholder_meta(sku):
    m = re.match(r"^(RANGE|FRIDGE|DISHWASHER)-(\d+)$", sku)
    if not m:
        return None
    kind, w = m.group(1), m.group(2)
    label = {"RANGE": "Range", "FRIDGE": "Refrigerator",
             "DISHWASHER": "Dishwasher"}[kind]
    return (f"{label} {w}\"W (appliance placeholder)", f"{int(w):g}\"W")


@app.get("/api/projects/{project_id}/quote")
async def get_quote(project_id: int, request: Request):
    user, err = _require_user(request)
    if err:
        return err
    conn = _db()
    try:
        p = _get_project(conn, project_id, user["id"])
        if p is None:
            return _err(404, "project not found")
        if not p["design_json"]:
            return _err(400, "project has no design yet")
        design = json.loads(p["design_json"])
        catalog = {r["sku"]: r
                   for r in _catalog_items_for(conn, p["catalog_id"])}

        agg = {}
        first_seen = {}
        for run in design.get("runs", []):
            for it in run.get("items", []):
                sku = str(it["sku"])
                agg[sku] = agg.get(sku, 0) + 1
                if sku not in first_seen:
                    first_seen[sku] = (it.get("level") or "",
                                       it.get("category") or "")

        lines = []
        for sku, qty in agg.items():
            level, category = first_seen[sku]
            if sku in catalog:
                c = catalog[sku]
                unit = c["price"] if c["price"] is not None else 0.0
                flag = None if c["price"] is not None else "price missing"
                lines.append({
                    "sku": sku,
                    "description": c["description"],
                    "size": _size_str(c["width_in"], c["height_in"],
                                      c["depth_in"]),
                    "qty": qty,
                    "unit_price": unit,
                    "line_total": round(unit * qty, 2),
                    "flag": flag,
                    "_level": level or "",
                    "_category": category or c["category"],
                })
            else:
                meta = _placeholder_meta(sku)
                desc, size = meta if meta else (sku, "")
                lines.append({
                    "sku": sku,
                    "description": desc,
                    "size": size,
                    "qty": qty,
                    "unit_price": 0.0,
                    "line_total": 0.0,
                    "flag": "not a catalog item",
                    "_level": level or "",
                    "_category": category or "appliance",
                })

        level_rank = {"tall": 0, "base": 1, "wall": 2}
        cat_rank = {"base": 0, "wall": 0, "tall": 0, "panel": 1, "filler": 2,
                    "appliance": 3, "accessory": 4}
        lines.sort(key=lambda l: (level_rank.get(l["_level"], 9),
                                  cat_rank.get(l["_category"], 9),
                                  l["sku"]))
        for l in lines:
            l.pop("_level", None)
            l.pop("_category", None)
        subtotal = round(sum(l["line_total"] for l in lines), 2)
        return {"lines": lines, "subtotal": subtotal}
    finally:
        conn.close()


# --------------------------------------------------------------------------
# error handling + static frontend (mounted LAST so /api always wins)
# --------------------------------------------------------------------------

@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception):
    return JSONResponse(status_code=500,
                        content={"error": "internal server error"})


if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True),
              name="static")

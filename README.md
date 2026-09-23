# KitchenStudio

Sellable SaaS kitchen cabinet design app (v1 MVP). Suppliers and contractors
upload their own cabinet catalog as a CSV, draw a room (walls + openings),
and get a deterministic auto-designed cabinet layout plus an instant quote.

**Stack:** Python 3 · FastAPI + uvicorn (no other runtime deps) · SQLite
(stdlib `sqlite3`) · static frontend served from `/`.

---

## Quickstart

```bash
cd kitchen-studio

# 1. Create a virtualenv and install deps
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# 2. Generate the seed Oppein RTA catalog CSV
python backend/seed_oppein.py        # writes catalogs/oppein_rta.csv (91 SKUs)

# 3. Run the server (from the repo root)
uvicorn backend.app:app              # → http://localhost:8000
```

The API lives under `/api`; the frontend (when present in `frontend/`) is
served from `/`. The SQLite database is created on startup at
`backend/data/kitchenstudio.db`.

Smoke-test the layout engine (no server needed):

```bash
python backend/test_layout.py        # prints PASS
```

---

## Catalog CSV template

Upload via `POST /api/catalogs` (multipart: `file` = CSV, `name` = text).

Columns (all required in the header):

| column      | type              | rules                                              |
|-------------|-------------------|----------------------------------------------------|
| sku         | text              | non-empty, unique within the file                  |
| category    | text              | one of `base`, `wall`, `tall`, `panel`, `filler`, `appliance`, `accessory` |
| description | text              | free text                                          |
| width_in    | number            | > 0 (inches)                                       |
| height_in   | number            | > 0 (inches)                                       |
| depth_in    | number            | > 0 (inches)                                       |
| price       | number or blank   | blank → NULL; otherwise ≥ 0                        |
| notes       | text              | free text                                          |

Validation is **atomic**: if any row fails, the whole upload is rejected
with `400 {"error", "bad_rows": [{"row", "sku", "reason"}]}` (`row` is the
1-based CSV line number) and nothing is inserted.

Category guide: `base` / `wall` / `tall` = cabinets · `panel` = end panels,
toe kick · `filler` = fillers · `appliance` = appliance SKUs ·
`accessory` = moldings, hardware.

---

## API reference

Base path `/api`. JSON everywhere. Auth: `Authorization: Bearer <token>`
from signup/login. All `/api/catalogs` and `/api/projects` routes require
auth, are scoped to the logged-in user, and return `401` when the token is
missing/invalid.

### Auth

| Method | Path               | Body                              | Response |
|--------|--------------------|-----------------------------------|----------|
| POST   | /api/auth/signup   | `{email, password, name}`         | `200 {token, user:{id,email,name}}` · `400` if email taken |
| POST   | /api/auth/login    | `{email, password}`               | `{token, user:{id,email,name}}` · `401` bad credentials |
| POST   | /api/auth/logout   | —                                 | `{ok:true}` (token invalidated) |

### Catalogs

| Method | Path                  | Notes |
|--------|-----------------------|-------|
| GET    | /api/catalogs         | `[{id,name,item_count,created}]` |
| POST   | /api/catalogs         | multipart `file` (CSV) + `name` → `{id, item_count}`; `400` with `bad_rows` on validation failure |
| GET    | /api/catalogs/{id}    | `{id,name,items:[{sku,category,description,width_in,height_in,depth_in,price,notes}]}` |
| DELETE | /api/catalogs/{id}    | `{ok:true}` · `400` if any project references it (refused, with reason) |

### Projects

| Method | Path                              | Notes |
|--------|-----------------------------------|-------|
| GET    | /api/projects                     | `[{id,name,catalog_id,updated}]` |
| POST   | /api/projects                     | `{name,catalog_id,room}` → `{id}`; validates catalog ownership + room shape |
| GET    | /api/projects/{id}                | `{id,name,catalog_id,room,design,updated}` (`design` null until generated) |
| PUT    | /api/projects/{id}                | partial `{name?, room?}` → `{ok:true}` |
| DELETE | /api/projects/{id}                | `{ok:true}` |
| POST   | /api/projects/{id}/autodesign     | `{corner_style:"easy"\|"blind"\|"lazy", wall_cabinet_height:30\|36\|42}` → `{design, warnings:[]}`; saves the design on the project |
| PUT    | /api/projects/{id}/design         | `{design}` → `{ok:true}`; validates shape; every SKU must exist in the project's catalog or match `^(RANGE-\d+\|FRIDGE-\d+\|DISHWASHER-24)$`, else `400` listing unknown SKUs |
| GET    | /api/projects/{id}/quote          | `{lines:[{sku,description,size,qty,unit_price,line_total,flag}], subtotal}` |

Room shape:

```json
{
  "walls": [{"id": "A", "length_in": 168}],
  "openings": [{"wall_id": "A", "at_in": 66, "width_in": 36, "kind": "window",
                "sill_in": 42, "height_in": 36}],
  "ceiling_in": 96,
  "appliances": {"range_in": 30, "fridge_in": 36,
                 "dishwasher": true, "microwave": true}
}
```

`openings[].kind` ∈ `window | door | opening`. `sill_in`/`height_in` optional.

Design shape:

```json
{"runs": [{"wall_id": "A",
           "items": [{"sku": "B30", "at_in": 3.0, "width_in": 30.0,
                      "category": "base", "level": "base"}]}], "version": 1}
```

`level` ∈ `base | wall | tall`; `at_in` = inches from wall start.
Appliance placeholders (`RANGE-30`, `FRIDGE-36`, `DISHWASHER-24`) are allowed
in designs and quote at $0 flagged `"not a catalog item"`. Catalog items with
no price quote at $0 flagged `"price missing"`. Quote lines are sorted by
level (tall, base, wall), then category (cabinets, panel, filler, appliance,
accessory), then SKU; `subtotal` is rounded to 2 decimals.

---

## Deploy notes (Docker)

```bash
docker build -t kitchenstudio .
docker run -p 8000:8000 kitchenstudio   # → http://localhost:8000
```

The image is built from the repo root (`backend/`, `frontend/`,
`catalogs/` are copied in). The SQLite database lives at
`backend/data/kitchenstudio.db` inside the container — mount a volume at
`/app/backend/data` to persist it across restarts:

```bash
docker run -p 8000:8000 -v ks-data:/app/backend/data kitchenstudio
```

To serve on a different port, override the command, e.g.
`docker run -p 8080:8080 kitchenstudio uvicorn backend.app:app --host 0.0.0.0 --port 8080`
(or set `PORT` and map accordingly in your orchestrator).

---

## Roadmap

- **Stripe subscriptions** — see `backend/billing.py` (plans, checkout,
  webhook stubs; entitlements to be enforced on catalog/project routes).
- **Photo / sketch input** — derive wall measurements from a room photo or
  hand sketch instead of typed dimensions.
- **AI photoreal render** — generate a photorealistic preview of the design.

---

## Project structure

```
kitchen-studio/
├── backend/
│   ├── app.py            # FastAPI app: auth, catalogs, projects, quote API
│   ├── layout.py         # deterministic auto-design engine
│   ├── test_layout.py    # engine smoke test (prints PASS)
│   ├── seed_oppein.py    # generates catalogs/oppein_rta.csv
│   ├── billing.py        # Stripe subscription stubs (TODO)
│   ├── requirements.txt  # fastapi, uvicorn
│   └── data/             # SQLite db (created at runtime; gitignored)
├── catalogs/
│   └── oppein_rta.csv    # seed catalog: 91 Oppein RTA SKUs, prices blank
├── frontend/             # static app (separate workstream; served at /)
├── Dockerfile
├── README.md
└── .gitignore
```

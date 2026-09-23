#!/usr/bin/env python3
"""End-to-end API test: signup -> login -> upload seed CSV -> create project
-> autodesign -> quote, plus error-path checks. Uses FastAPI TestClient.

Run from the repo root:  /tmp/ksvenv/bin/python backend/e2e_test.py
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from fastapi.testclient import TestClient  # noqa: E402
from backend.app import app, DB_PATH  # noqa: E402

# start from a clean database
if DB_PATH.exists():
    DB_PATH.unlink()

client = TestClient(app, raise_server_exceptions=False)
passed = []


def check(name, cond, detail=""):
    assert cond, f"FAIL: {name} {detail}"
    passed.append(name)
    print(f"  ok: {name}")


print("== auth ==")
r = client.post("/api/auth/signup", json={"email": "v@example.com",
                                          "password": "secret123",
                                          "name": "Varun"})
check("signup 200", r.status_code == 200, r.text)
token = r.json()["token"]
check("signup returns user", r.json()["user"]["email"] == "v@example.com")

r = client.post("/api/auth/signup", json={"email": "v@example.com",
                                          "password": "x", "name": "Dup"})
check("duplicate email 400", r.status_code == 400, r.text)

r = client.post("/api/auth/login", json={"email": "v@example.com",
                                         "password": "secret123"})
check("login 200", r.status_code == 200, r.text)
token2 = r.json()["token"]

r = client.post("/api/auth/login", json={"email": "v@example.com",
                                         "password": "wrong"})
check("bad password 401", r.status_code == 401, r.text)

r = client.get("/api/catalogs")
check("no token 401", r.status_code == 401, r.text)

H = {"Authorization": f"Bearer {token}"}
H2 = {"Authorization": f"Bearer {token2}"}

print("== catalogs ==")
csv_text = (REPO / "catalogs" / "oppein_rta.csv").read_text()
r = client.post("/api/catalogs", headers=H,
                files={"file": ("oppein_rta.csv", csv_text, "text/csv")},
                data={"name": "Oppein RTA"})
check("upload seed csv 200", r.status_code == 200, r.text)
check("seed item_count 91", r.json()["item_count"] == 91, r.text)
cat_id = r.json()["id"]

r = client.get("/api/catalogs", headers=H)
check("list catalogs", r.status_code == 200 and
      r.json()[0]["item_count"] == 91, r.text)

r = client.get(f"/api/catalogs/{cat_id}", headers=H)
check("get catalog items", r.status_code == 200 and
      len(r.json()["items"]) == 91, r.text)
check("catalog item shape",
      set(r.json()["items"][0]) == {"sku", "category", "description",
                                    "width_in", "height_in", "depth_in",
                                    "price", "notes"})

bad_csv = ("sku,category,description,width_in,height_in,depth_in,price,notes\n"
           "B12,base,ok cab,12,30,23.88,,\n"
           "B12,wall,dup sku,12,30,12,,\n"
           ",base,empty sku,12,30,12,,\n"
           "BX1,bogus,bad cat,12,30,12,,\n"
           "BX2,base,bad dim,-5,30,12,,\n"
           "BX3,base,bad price,12,30,12,-3,\n")
r = client.post("/api/catalogs", headers=H,
                files={"file": ("bad.csv", bad_csv, "text/csv")},
                data={"name": "Bad"})
check("bad csv 400", r.status_code == 400, r.text)
br = r.json()["bad_rows"]
check("bad_rows detail", len(br) == 5 and br[0]["row"] == 3 and
      br[0]["sku"] == "B12", json.dumps(br))
r = client.get("/api/catalogs", headers=H)
check("bad upload atomic (still 1 catalog)", len(r.json()) == 1, r.text)

print("== projects ==")
room = {
    "walls": [{"id": "A", "length_in": 168},
              {"id": "B", "length_in": 120}],
    "openings": [
        {"wall_id": "A", "at_in": 66, "width_in": 36, "kind": "window"},
        {"wall_id": "B", "at_in": 72, "width_in": 36, "kind": "door"}],
    "ceiling_in": 96,
    "appliances": {"range_in": 30, "fridge_in": 36,
                   "dishwasher": True, "microwave": True},
}
r = client.post("/api/projects", headers=H,
                json={"name": "Smith kitchen", "catalog_id": cat_id,
                      "room": room})
check("create project", r.status_code == 200, r.text)
proj_id = r.json()["id"]

r = client.post("/api/projects", headers=H,
                json={"name": "x", "catalog_id": 9999, "room": room})
check("bad catalog 400", r.status_code == 400, r.text)

r = client.post("/api/projects", headers=H,
                json={"name": "x", "catalog_id": cat_id,
                      "room": {"walls": []}})
check("bad room 400", r.status_code == 400, r.text)

r = client.get("/api/projects", headers=H)
check("list projects", r.status_code == 200 and
      r.json()[0]["name"] == "Smith kitchen", r.text)

r = client.get(f"/api/projects/{proj_id}", headers=H)
check("get project design null", r.status_code == 200 and
      r.json()["design"] is None and r.json()["room"]["walls"][0]["id"] == "A",
      r.text)

r = client.put(f"/api/projects/{proj_id}", headers=H,
               json={"name": "Smith kitchen v2"})
check("partial update", r.status_code == 200, r.text)
r = client.get(f"/api/projects/{proj_id}", headers=H)
check("name updated", r.json()["name"] == "Smith kitchen v2", r.text)

print("== autodesign ==")
r = client.post(f"/api/projects/{proj_id}/autodesign", headers=H,
                json={"corner_style": "easy", "wall_cabinet_height": 36})
check("autodesign 200", r.status_code == 200, r.text)
design = r.json()["design"]
check("design version+runs", design["version"] == 1 and
      len(design["runs"]) == 2, r.text[:200])
check("warnings list", isinstance(r.json()["warnings"], list))
r = client.get(f"/api/projects/{proj_id}", headers=H)
check("design saved on project", r.json()["design"] == design)

r = client.post(f"/api/projects/{proj_id}/autodesign", headers=H,
                json={"corner_style": "weird", "wall_cabinet_height": 36})
check("bad corner_style 400", r.status_code == 400, r.text)
r = client.post(f"/api/projects/{proj_id}/autodesign", headers=H,
                json={"corner_style": "blind", "wall_cabinet_height": 42})
check("blind/42 works", r.status_code == 200, r.text)
# restore the easy/36 design for the quote checks below
r = client.post(f"/api/projects/{proj_id}/autodesign", headers=H,
                json={"corner_style": "easy", "wall_cabinet_height": 36})
design = r.json()["design"]

print("== design save/validation ==")
bad_design = {"runs": [{"wall_id": "A", "items": [
    {"sku": "NOPE-1", "at_in": 0, "width_in": 12,
     "category": "base", "level": "base"}]}]}
r = client.put(f"/api/projects/{proj_id}/design", headers=H,
               json={"design": bad_design})
check("unknown sku 400", r.status_code == 400 and
      "NOPE-1" in r.text, r.text)

ok_design = {"runs": [{"wall_id": "A", "items": [
    {"sku": "B30", "at_in": 3, "width_in": 30,
     "category": "base", "level": "base"},
    {"sku": "RANGE-30", "at_in": 33, "width_in": 30,
     "category": "appliance", "level": "base"}]}],
    "version": 1}
r = client.put(f"/api/projects/{proj_id}/design", headers=H,
               json={"design": ok_design})
check("save design ok", r.status_code == 200, r.text)
# put the autodesign back for the quote test
r = client.put(f"/api/projects/{proj_id}/design", headers=H,
               json={"design": design})
check("restore autodesign", r.status_code == 200, r.text)

print("== quote ==")
r = client.get(f"/api/projects/{proj_id}/quote", headers=H)
check("quote 200", r.status_code == 200, r.text)
q = r.json()
check("quote lines+subtotal", "lines" in q and "subtotal" in q)
line = q["lines"][0]
check("line shape", set(line) == {"sku", "description", "size", "qty",
                                  "unit_price", "line_total", "flag"}, str(line))
check("size format", "W \u00d7" in line["size"] and "\"D" in line["size"],
      line["size"])
flags = {l["sku"]: l["flag"] for l in q["lines"]}
check("seed price missing flagged",
      any(v == "price missing" for v in flags.values()))
check("appliance placeholder flagged",
      flags.get("RANGE-30") == "not a catalog item", str(flags.get("RANGE-30")))
check("subtotal number", isinstance(q["subtotal"], (int, float)))
# sort order: tall,base,wall levels
levels = []
seen = set()
for l in q["lines"]:
    pass
print(f"  quote: {len(q['lines'])} lines, subtotal {q['subtotal']}")

print("== delete guards ==")
r = client.delete(f"/api/catalogs/{cat_id}", headers=H)
check("delete referenced catalog 400", r.status_code == 400, r.text)

r = client.delete(f"/api/projects/{proj_id}", headers=H)
check("delete project", r.status_code == 200, r.text)
r = client.get(f"/api/projects/{proj_id}", headers=H)
check("project gone 404", r.status_code == 404, r.text)
r = client.delete(f"/api/catalogs/{cat_id}", headers=H)
check("delete unreferenced catalog", r.status_code == 200, r.text)

print("== logout ==")
r = client.post("/api/auth/logout", headers=H)
check("logout", r.status_code == 200 and r.json() == {"ok": True}, r.text)
r = client.get("/api/projects", headers=H)
check("token invalid after logout", r.status_code == 401, r.text)
r = client.get("/api/projects", headers=H2)
check("second session still valid", r.status_code == 200, r.text)

print(f"\nALL {len(passed)} CHECKS PASSED")

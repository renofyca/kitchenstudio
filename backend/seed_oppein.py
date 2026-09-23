#!/usr/bin/env python3
"""Generate catalogs/oppein_rta.csv — a useful subset of the Oppein RTA
frameless Euro-style catalog (dimensions transcribed from
~/workspace/skills/oppein-kitchen-designer/references/catalog.md).

Prices are left blank (NULL) — the dealer fills them in from the price book.
Run:  python backend/seed_oppein.py   (from the repo root)
"""
import csv
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "catalogs" / "oppein_rta.csv"

BASE_H, BASE_D = 30.0, 23.88     # standard base box 30"H x 23-7/8"D
WALL_D = 12.0                     # standard wall depth
TALL_D = 23.88                    # standard tall depth
PANEL_T = 0.75                    # panel thickness

rows = []


def add(sku, category, description, w, h, d, price="", notes=""):
    rows.append({
        "sku": sku, "category": category, "description": description,
        "width_in": w, "height_in": h, "depth_in": d,
        "price": price, "notes": notes,
    })


# ---- Base cabinets: 1 drawer + door(s), 30"H x 23-7/8"D -------------------
for w in (12, 15, 18, 21):
    add(f"B{w}", "base", f"Base cabinet, 1 drawer + 1 door, {w}\"W",
        w, BASE_H, BASE_D)
add("BTC18", "base", 'Base trash cabinet 18"W (order BTC18-TRASH CAN hardware)',
    18, BASE_H, BASE_D, notes="Includes trash can")
for w in (24, 27, 30, 33, 36, 42):
    add(f"B{w}", "base", f"Base cabinet, 1 drawer + 2 doors, {w}\"W",
        w, BASE_H, BASE_D)

# ---- Sink bases ------------------------------------------------------------
for w in (30, 33, 36, 42):
    add(f"SB{w}", "base", f"Sink base, false drawer front + 2 doors, {w}\"W",
        w, BASE_H, BASE_D)

# ---- 3-drawer bases --------------------------------------------------------
for w in (12, 15, 18, 21, 24, 27, 30, 33, 36):
    add(f"3DB{w}", "base", f"3-drawer base cabinet, {w}\"W", w, BASE_H, BASE_D)

# ---- 2-drawer bases (deep drawers) -----------------------------------------
for w in (30, 36):
    add(f"2DB{w}", "base", f"2-drawer base cabinet, deep drawers, {w}\"W",
        w, BASE_H, BASE_D, notes="PB box n/a")

# ---- Base corner cabinets --------------------------------------------------
add("BER33", "base", 'Base easy-reach corner 33"x33"', 33, BASE_H, 33,
    notes="Needs 33\" on each wall leg")
add("BER36", "base", 'Base easy-reach corner 36"x36"', 36, BASE_H, 36,
    notes="Needs 36\" on each wall leg")
add("BLS33", "base", 'Base lazy susan corner 33"x33"', 33, BASE_H, 33,
    notes="Order BLS33 TRAY hardware")
add("BLS36", "base", 'Base lazy susan corner 36"x36"', 36, BASE_H, 36,
    notes="Order BLS36 TRAY hardware")
add("BBC42", "base", 'Base blind corner 42"W', 42, BASE_H, BASE_D,
    notes="Needs ~15\" pull from adjacent wall")
add("BBC45", "base", 'Base blind corner 45"W', 45, BASE_H, BASE_D,
    notes="Needs ~18\" pull from adjacent wall")

# ---- Specialty bases -------------------------------------------------------
add("BSR09", "base", 'Base spice rack 9"W x 39"H (spice rack included)',
    9, 39, BASE_D)
add("BMC30", "base", 'Base microwave cabinet 30"W (open shelf + drawer)',
    30, BASE_H, BASE_D)

# ---- Wall cabinets (12"D) --------------------------------------------------
for h in (30, 36):
    for w in (9, 12, 15, 18, 21, 24, 27, 30, 33, 36):
        doors = "1 door" if w <= 21 else "2 doors"
        add(f"W{w:02d}{h}", "wall",
            f"Wall cabinet {w}\"W x {h}\"H, {doors}", w, h, WALL_D)
add("W2442", "wall", 'Wall cabinet 24"W x 42"H, 2 doors', 24, 42, WALL_D)

# ---- Wall cabinets for fridge (24"D) ---------------------------------------
for sku, w, h in (("W301824", 30, 18), ("W361824", 36, 18)):
    add(sku, "wall", f'Wall cabinet for fridge {w}"W x {h}"H x 24"D, 2 doors',
        w, h, 24)

# ---- Wall short cabinets ---------------------------------------------------
for sku, w, h in (("W1212", 12, 12), ("W2412", 24, 12), ("W2418", 24, 18)):
    add(sku, "wall", f'Wall short cabinet {w}"W x {h}"H', w, h, WALL_D)

# ---- Wall corner cabinets --------------------------------------------------
add("WER2430", "wall", 'Wall easy-reach corner 24"x24", 30"H', 24, 30, WALL_D)
add("WER2436", "wall", 'Wall easy-reach corner 24"x24", 36"H', 24, 36, WALL_D)
add("WBC2730", "wall", 'Wall blind corner 27"W x 30"H', 27, 30, WALL_D,
    notes="Door pulls from one side")

# ---- Wall microwave / stay lift -------------------------------------------
add("WMC2418", "wall", 'Wall microwave cabinet 24"W x 18"H', 24, 18, WALL_D)
add("WMC3018", "wall", 'Wall microwave cabinet 30"W x 18"H', 30, 18, WALL_D)
add("WSL3018", "wall", 'Wall stay-lift cabinet 30"W x 18"H (BLUM stay lift)',
    30, 18, WALL_D, notes="BLUM stay lift + hinge included; PB box n/a")

# ---- Tall / pantry cabinets (23-7/8"D, height includes feet) ---------------
for sku, w, h, doors in (
        ("PC1884", 18, 84, "1 side door"), ("PC1890", 18, 90, "1 side door"),
        ("PC1896", 18, 96, "1 side door"), ("PC2484", 24, 84, "2 full doors"),
        ("PC2490", 24, 90, "2 full doors"), ("PC2496", 24, 96, "2 full doors"),
        ("PC3084", 30, 84, "2 full doors"), ("PC3090", 30, 90, "2 full doors"),
        ("PC3096", 30, 96, "2 full doors")):
    add(sku, "tall", f'Pantry cabinet {w}"W x {h}"H, {doors}', w, h, TALL_D,
        notes="Height includes feet")
add("DOC3090", "tall", 'Double oven cabinet 30"W x 90"H (cut-out 55-1/8"H)',
    30, 90, TALL_D, notes="Single 12\"H drawer at bottom; PB box n/a")

# ---- Fillers ---------------------------------------------------------------
for sku, w, h in (("WF330", 3, 30), ("WF336", 3, 36), ("WF342", 3, 42),
                   ("WF636", 6, 36), ("TF396", 3, 96)):
    add(sku, "filler", f'Filler {w}"W x {h}"H', w, h, PANEL_T)

# ---- Panels / toe kick -----------------------------------------------------
add("BEP24", "panel", 'Base end panel 24-3/4"W x 34-1/2"H', 24.75, 34.5, PANEL_T)
add("BEP36", "panel", 'Base end panel 37-1/4"W x 34-1/2"H', 37.25, 34.5, PANEL_T)
add("WEP1230", "panel", 'Wall end panel 12-3/4"W x 30"H', 12.75, 30, PANEL_T)
add("WEP1236", "panel", 'Wall end panel 12-3/4"W x 36"H', 12.75, 36, PANEL_T)
add("REF2496", "panel", 'Refrigerator end panel 24-3/4"W x 96"H',
    24.75, 96, PANEL_T)
add("REF3696", "panel", 'Refrigerator end panel 36"W x 96"H', 36, 96, PANEL_T)
add("DWEP3", "panel", 'Dishwasher end panel 24-3/4"W x 34-1/2"H',
    24.75, 34.5, PANEL_T)
add("TK8", "panel", 'Toe kick 96"L x 4-1/2"H', 96, 4.5, 0.25)

# ---- Moldings & hardware ---------------------------------------------------
add("CM4", "accessory", "Crown molding 96\"L", 96, 4, PANEL_T,
    notes="Shaker crown")
add("HINGE105", "accessory", "105° soft-close hinge, 6-way adjustable",
    3.5, 3.5, 1, notes="Standard hinge")


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "sku", "category", "description", "width_in", "height_in",
            "depth_in", "price", "notes"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} SKUs -> {OUT}")


if __name__ == "__main__":
    main()

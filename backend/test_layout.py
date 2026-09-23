#!/usr/bin/env python3
"""Smoke test for backend/layout.py.

Runs autodesign on an L-shaped room (wall A 168" with a centered 36" window,
wall B 120" with a 36" door, 96" ceiling, 30" range, 36" fridge, dishwasher +
microwave) against the seed Oppein catalog and asserts:
  1. every emitted SKU is in the catalog or an appliance placeholder, and
  2. a sink base exists in the design.
Prints PASS on success.

Run from the repo root:  python backend/test_layout.py
"""
import csv
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from backend.layout import autodesign, APPLIANCE_RE  # noqa: E402

CATALOG_CSV = REPO / "catalogs" / "oppein_rta.csv"

ROOM = {
    "walls": [
        {"id": "A", "length_in": 168},
        {"id": "B", "length_in": 120},
    ],
    "openings": [
        {"wall_id": "A", "at_in": 66, "width_in": 36, "kind": "window",
         "sill_in": 42, "height_in": 36},
        {"wall_id": "B", "at_in": 72, "width_in": 36, "kind": "door"},
    ],
    "ceiling_in": 96,
    "appliances": {
        "range_in": 30,
        "fridge_in": 36,
        "dishwasher": True,
        "microwave": True,
    },
}

OPTIONS = {"corner_style": "easy", "wall_cabinet_height": 36}


def load_catalog():
    with open(CATALOG_CSV, newline="", encoding="utf-8-sig") as f:
        items = list(csv.DictReader(f))
    for it in items:
        for k in ("width_in", "height_in", "depth_in"):
            it[k] = float(it[k]) if it[k] not in (None, "") else None
        it["price"] = float(it["price"]) if it["price"] not in (None, "") else None
    return items


def main():
    catalog = load_catalog()
    catalog_skus = {it["sku"] for it in catalog}
    assert catalog_skus, "seed catalog is empty"

    design, warnings = autodesign(ROOM, catalog, OPTIONS)

    assert design.get("version") == 1, "design version != 1"
    assert len(design["runs"]) == 2, "expected 2 runs (walls A and B)"

    emitted = []
    wall_len = {w["id"]: w["length_in"] for w in ROOM["walls"]}
    for run in design["runs"]:
        L = wall_len[run["wall_id"]]
        for level in ("base", "wall", "tall"):
            prev_end = -1
            for it in [i for i in run["items"] if i["level"] == level]:
                for key in ("sku", "at_in", "width_in", "category", "level"):
                    assert key in it, f"item missing {key}: {it}"
                assert it["at_in"] >= prev_end - 1e-9, \
                    f"overlap on wall {run['wall_id']} level {level}: {it}"
                assert 0 - 1e-9 <= it["at_in"] \
                    and it["at_in"] + it["width_in"] <= L + 1e-9, \
                    f"item off wall {run['wall_id']}: {it}"
                prev_end = it["at_in"] + it["width_in"]
                emitted.append(it["sku"])

    unknown = [s for s in emitted
               if s not in catalog_skus and not APPLIANCE_RE.match(s)]
    assert not unknown, f"unknown/invented SKUs emitted: {unknown}"

    sink_bases = [s for s in emitted if re.fullmatch(r"SB\d+", s)]
    assert sink_bases, "no sink base in design"

    assert any(s.startswith("RANGE-") for s in emitted), "no range placeholder"
    assert any(s.startswith("FRIDGE-") for s in emitted), "no fridge placeholder"
    assert "DISHWASHER-24" in emitted, "no dishwasher placeholder"

    print(f"walls: {[r['wall_id'] for r in design['runs']]}")
    for run in design["runs"]:
        n = len(run["items"])
        skus = ", ".join(it["sku"] for it in run["items"][:12])
        print(f"  wall {run['wall_id']}: {n} items: {skus}{'...' if n > 12 else ''}")
    print(f"warnings ({len(warnings)}):")
    for w in warnings:
        print(f"  - {w}")
    print("PASS")


if __name__ == "__main__":
    main()

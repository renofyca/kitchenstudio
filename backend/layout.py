"""Deterministic auto-design layout engine (the "AI draft").

Given a room shape, a catalog item list, and options, produces a cabinet
layout per wall following the Oppein design rules
(~/workspace/skills/oppein-kitchen-designer/references/design-rules.md).

Rules applied here (simplified, documented deviations):
- Walls connect in order: wall[i]'s end meets wall[i+1]'s start.
- Corner allowance at joined ends depends on corner_style
  (easy: 36", lazy: 36", blind: 42" on the blind side + 3" other side).
- Exposed (non-joined) run ends get a 3" filler so doors/drawers clear walls.
- Base runs skip door/opening spans; wall runs additionally skip window spans.
- Sink base centered on a window when one exists in the base run.
- Dishwasher (24") adjacent to sink; range with >=12" landing each side when
  possible; fridge at a run end flanked by REF panels; tall pantry when >=18"
  is free at a run end; remaining gaps filled with 3-drawer bases near the
  range and door bases elsewhere, then fillers; <3" leftovers are warnings.
- Wall run mirrors the base layout with wall-height SKUs, skipping spans
  above range / fridge / windows / doors.
- NEVER invents SKUs: only SKUs present in catalog_items are emitted
  (plus appliance placeholders RANGE-{w}, FRIDGE-{w}, DISHWASHER-24).
"""

import re

APPLIANCE_RE = re.compile(r"^(RANGE-\d+|FRIDGE-\d+|DISHWASHER-24)$")

CORNER_TAKE = {"easy": 36.0, "lazy": 36.0, "blind": 42.0}
CORNER_PREFIX = {"easy": "BER", "lazy": "BLS", "blind": "BBC"}
WALL_CORNER_PREFIX = {"easy": "WER", "lazy": "WER", "blind": "WBC"}

EXPOSED_FILLER_W = 3.0
PANEL_W = 0.75


# --------------------------------------------------------------------------
# catalog helpers
# --------------------------------------------------------------------------

def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


class Catalog:
    """Width-indexed lookup over catalog items. Never invents SKUs."""

    def __init__(self, items):
        self.items = items or []
        self.by_cat = {}
        for it in self.items:
            self.by_cat.setdefault(it.get("category"), []).append(it)
        for lst in self.by_cat.values():
            lst.sort(key=lambda i: (_num(i.get("width_in")) or 0))

    def pick(self, category, max_w, height=None, prefix=None, min_w=0.0):
        """Largest-width item in category with width <= max_w (>= min_w),
        optionally filtered by height and sku prefix. None if no fit."""
        best = None
        for it in self.by_cat.get(category, []):
            w = _num(it.get("width_in"))
            if w is None or w > max_w + 1e-9 or w < min_w - 1e-9:
                continue
            if height is not None and _num(it.get("height_in")) != float(height):
                continue
            if prefix is not None and not str(it.get("sku", "")).startswith(prefix):
                continue
            if best is None or w > (_num(best.get("width_in")) or 0):
                best = it
        return best

    def has(self, sku):
        return any(str(it.get("sku")) == sku for it in self.items)


# --------------------------------------------------------------------------
# span helpers
# --------------------------------------------------------------------------

def _subtract(spans, cut):
    """Subtract interval cut=(cs,ce) from a list of (s,e) spans."""
    cs, ce = cut
    out = []
    for s, e in spans:
        if ce <= s or cs >= e:
            out.append((s, e))
            continue
        if cs > s:
            out.append((s, cs))
        if ce < e:
            out.append((ce, e))
    return out


def _free_spans(lo, hi, openings, kinds):
    spans = [(lo, hi)]
    for op in openings:
        if op.get("kind") not in kinds:
            continue
        a = _num(op.get("at_in")) or 0.0
        w = _num(op.get("width_in")) or 0.0
        spans = _subtract(spans, (a, a + w))
    return [(round(s, 2), round(e, 2)) for s, e in spans if e - s > 1e-9]


def _item(sku, at_in, width_in, category, level):
    return {
        "sku": sku,
        "at_in": round(float(at_in), 2),
        "width_in": round(float(width_in), 2),
        "category": category,
        "level": level,
    }


# --------------------------------------------------------------------------
# base run layout
# --------------------------------------------------------------------------

def _base_corner(cat, style, warnings, wall_id, at_corner, take, is_start):
    """Place a corner cabinet at a joined corner. Returns (item, take_used)."""
    prefix = CORNER_PREFIX[style]
    cab = cat.pick("base", take, prefix=prefix)
    if cab is None:
        warnings.append(
            f"Wall {wall_id}: no {style} corner cabinet in catalog; "
            f"used 3\" filler at corner instead")
        filler = cat.pick("filler", EXPOSED_FILLER_W)
        if filler:
            pos = at_corner if is_start else at_corner + take - EXPOSED_FILLER_W
            return _item(filler["sku"], pos, EXPOSED_FILLER_W, "filler", "base"), take
        warnings.append(f"Wall {wall_id}: missing filler SKU for corner")
        return None, take
    w = _num(cab["width_in"])
    pos = at_corner if is_start else at_corner - w
    return _item(cab["sku"], pos, w, "base", "base"), take


def _filler(cat, width, level, warnings, wall_id):
    sku = None
    if width <= 3.0 + 1e-9:
        f = cat.pick("filler", 3.0)
    elif width <= 6.0 + 1e-9:
        f = cat.pick("filler", 6.0)
    else:
        f = None
    if f is None:
        warnings.append(f"Wall {wall_id}: missing filler SKU for {width:g}\" gap")
        return None
    return f["sku"]


def _base_candidates(cat, rem, want_drawers):
    """Candidate base cabinets (width desc) that fit in rem.

    want_drawers=True prefers 3-drawer bases; otherwise door bases (B__).
    Specialty SKUs (BER/BLS/BBC/BTC/BSR/BMC/SB...) are never used as filler."""
    pool = cat.by_cat.get("base", [])
    if want_drawers:
        cands = [c for c in pool
                 if str(c.get("sku", "")).startswith("3DB")
                 and (_num(c.get("width_in")) or 0) <= rem + 1e-9]
    else:
        cands = [c for c in pool
                 if re.fullmatch(r"B\d+", str(c.get("sku", "")))
                 and (_num(c.get("width_in")) or 0) <= rem + 1e-9]
    cands.sort(key=lambda c: _num(c.get("width_in")) or 0, reverse=True)
    return cands


def _fill_segment(cat, seg, items, warnings, wall_id, level, near_range,
                  drawer_ok=True):
    """Greedy fill of a free (s,e) segment with cabinets then fillers."""
    s, e = seg
    pos = s
    rem = e - s
    while rem >= 12.0 - 1e-9:
        cands = _base_candidates(cat, rem, drawer_ok and near_range)
        if not cands and drawer_ok and near_range:
            cands = _base_candidates(cat, rem, False)
        if not cands:
            break
        cab = cands[0]
        w = _num(cab["width_in"])
        items.append(_item(cab["sku"], pos, w, "base", level))
        pos += w
        rem -= w
    # fillers for the rest
    while rem >= 3.0 - 1e-9:
        if rem >= 6.0 - 1e-9:
            sku = _filler(cat, 6.0, level, warnings, wall_id)
            fw = 6.0 if sku else 0.0
        else:
            sku = _filler(cat, 3.0, level, warnings, wall_id)
            fw = 3.0 if sku else 0.0
        if not sku:
            break
        items.append(_item(sku, pos, fw, "filler", level))
        pos += fw
        rem -= fw
    if rem > 0.05:
        warnings.append(
            f"Wall {wall_id}: unfillable gap of {rem:.1f}\" "
            f"at {pos:.1f}\" (under 3\", no filler fits)")


def _base_shell(cat, wall, style, warnings):
    """Corner cabinets + exposed-end fillers for one wall.

    Returns (items, lo, hi): the fixed shell and the remaining run bounds.
    """
    wid = wall["id"]
    L = _num(wall["length_in"])
    items = []
    lo, hi = 0.0, L
    joined_start = wall.get("_joined_start", False)
    joined_end = wall.get("_joined_end", False)
    take = CORNER_TAKE[style]

    if joined_start:
        if style == "blind":
            # 3" filler on the non-blind side of a blind corner
            sku = _filler(cat, 3.0, "base", warnings, wid)
            if sku:
                items.append(_item(sku, 0.0, 3.0, "filler", "base"))
            lo += 3.0
        else:
            it, used = _base_corner(cat, style, warnings, wid, 0.0, take, True)
            if it:
                items.append(it)
            lo += used
    else:
        sku = _filler(cat, 3.0, "base", warnings, wid)
        if sku:
            items.append(_item(sku, 0.0, 3.0, "filler", "base"))
        lo += EXPOSED_FILLER_W

    if joined_end:
        it, used = _base_corner(cat, style, warnings, wid, L, take, False)
        if it:
            items.append(it)
        hi -= used
    else:
        sku = _filler(cat, 3.0, "base", warnings, wid)
        if sku:
            items.append(_item(sku, L - 3.0, 3.0, "filler", "base"))
        hi -= EXPOSED_FILLER_W

    if hi - lo < 12:
        warnings.append(f"Wall {wid}: tight run ({hi - lo:.0f}\" usable)")
    if L < 60:
        warnings.append(f"Wall {wid}: tight run ({L:.0f}\" wall)")
    return items, lo, hi


def _new_state(wall, openings, items, lo, hi):
    spans = _free_spans(lo, hi, openings, {"door", "opening"})
    return {"wall": wall, "id": wall["id"], "openings": openings,
            "items": items, "lo": lo, "hi": hi, "spans": spans,
            "sink_at": None, "sink_w": 0.0,
            "range_at": None, "range_w": 0.0}


def _cut(st, a, b):
    st["spans"] = [(round(s, 2), round(e, 2))
                   for s, e in _subtract(st["spans"], (a, b))]


def _place_fridge(cat, states, fridge_w, warnings):
    """One fridge per design, at the first exposed run end that fits."""
    if not fridge_w:
        return
    ref = (cat.pick("panel", 24.75, prefix="REF")
           or cat.pick("panel", 99.0, prefix="REF"))
    need = fridge_w + 2 * PANEL_W
    for st in states:
        lo, hi = st["lo"], st["hi"]
        wid = st["id"]
        slots = []
        if not st["wall"].get("_joined_start"):
            slots.append(lo)          # exposed start
        if not st["wall"].get("_joined_end"):
            slots.append(hi - need)   # exposed end
        for fat in slots:
            for s, e in st["spans"]:
                if fat >= s - 1e-9 and fat + need <= e + 1e-9:
                    st["items"].append(_item(
                        f"FRIDGE-{int(fridge_w)}", fat + PANEL_W,
                        fridge_w, "appliance", "base"))
                    if ref:
                        st["items"].append(_item(ref["sku"], fat, PANEL_W,
                                                "panel", "tall"))
                        st["items"].append(_item(
                            ref["sku"], fat + PANEL_W + fridge_w, PANEL_W,
                            "panel", "tall"))
                    else:
                        warnings.append(
                            f"Wall {wid}: no REF panel in catalog to flank "
                            f"fridge")
                    _cut(st, fat, fat + need)
                    return
    warnings.append(f"No exposed run end fits a {fridge_w:g}\" fridge")


def _place_sinks(cat, states, warnings):
    """Sink base centered on a window when the run has one.

    Walls without a window get no sink; if the room has no window at all,
    one sink goes near the middle of the longest run (with a warning).
    """
    sink_cands = [c for c in cat.by_cat.get("base", [])
                  if re.fullmatch(r"SB\d+", str(c.get("sku", "")))]
    sink_cands.sort(key=lambda c: _num(c.get("width_in")) or 0,
                    reverse=True)  # largest fitting first

    def drop(st, center):
        spans = st["spans"]
        tgt = None
        for s, e in spans:
            if s - 1e-9 <= center <= e + 1e-9:
                tgt = (s, e)
                break
        if tgt is None and spans:
            tgt = max(spans, key=lambda se: se[1] - se[0])
        if tgt is None:
            return False
        s, e = tgt
        c = min(max(center, s), e)
        for cand in sink_cands:
            w = _num(cand["width_in"])
            if w <= (e - s) + 1e-9:
                at = min(max(c - w / 2, s), e - w)
                st["items"].append(_item(cand["sku"], at, w, "base", "base"))
                st["sink_at"], st["sink_w"] = at, w
                _cut(st, at, at + w)
                return True
        return False

    placed = 0
    for st in states:
        lo, hi = st["lo"], st["hi"]
        wins = [op for op in st["openings"]
                if op.get("kind") == "window"
                and (_num(op.get("at_in")) or 0) >= lo
                and (_num(op.get("at_in")) or 0)
                + (_num(op.get("width_in")) or 0) <= hi]
        if not wins:
            continue
        w0 = wins[0]
        wc = (_num(w0.get("at_in")) or 0) + (_num(w0.get("width_in")) or 0) / 2
        if drop(st, wc):
            placed += 1
        else:
            warnings.append(
                f"Wall {st['id']}: window present but no sink base fits")
    if placed == 0:
        warnings.append("No window in room; sink placed without a window")
        best = None
        for st in states:
            for s, e in st["spans"]:
                if best is None or (e - s) > (best[2] - best[1]):
                    best = (st, s, e)
        if best:
            st, s, e = best
            if not drop(st, (s + e) / 2):
                warnings.append("No sink base fits anywhere")


def _place_dishwashers(cat, states, warnings, want):
    """Dishwasher placeholder immediately adjacent to each sink."""
    if not want:
        return
    for st in states:
        if st["sink_at"] is None:
            continue
        wid = st["id"]
        dw_w = 24.0
        placed = False
        for side_at in (st["sink_at"] + st["sink_w"],   # right of sink
                        st["sink_at"] - dw_w):          # left of sink
            for s, e in st["spans"]:
                if side_at >= s - 1e-9 and side_at + dw_w <= e + 1e-9:
                    st["items"].append(_item("DISHWASHER-24", side_at, dw_w,
                                             "appliance", "base"))
                    _cut(st, side_at, side_at + dw_w)
                    # DWEP3 panel on the outer (non-sink) side, only when
                    # it does not strand an unfillable sliver
                    dw_panel = cat.pick("panel", 24.75, prefix="DWEP3")
                    if dw_panel:
                        if side_at > st["sink_at"]:
                            pat = side_at + dw_w
                            seg = next(((a, b) for a, b in st["spans"]
                                        if abs(a - pat) < 1e-9), None)
                        else:
                            pat = side_at - PANEL_W
                            seg = next(((a, b) for a, b in st["spans"]
                                        if abs(b - side_at) < 1e-9), None)
                        if seg and (seg[1] - seg[0] - PANEL_W >= 3.0 - 1e-9
                                    or seg[1] - seg[0] - PANEL_W <= 0.05):
                            st["items"].append(_item(dw_panel["sku"], pat,
                                                     PANEL_W, "panel", "base"))
                            _cut(st, pat, pat + PANEL_W)
                    placed = True
                    break
            if placed:
                break
        if not placed:
            warnings.append(f"Wall {wid}: no room for dishwasher beside sink")


def _place_range(states, range_w, warnings):
    """One range per design, on the first wall with a fitting segment."""
    if not range_w:
        return
    for st in states:
        cands = sorted(st["spans"], key=lambda se: se[1] - se[0],
                       reverse=True)
        for s, e in cands:
            seg = e - s
            if seg < range_w - 1e-9:
                continue
            at = s + (seg - range_w) / 2
            if seg < range_w + 24 - 1e-9:
                warnings.append(
                    f"Wall {st['id']}: range placed with less than 12\" "
                    f"landing on one side")
            st["items"].append(_item(f"RANGE-{int(range_w)}", at, range_w,
                                     "appliance", "base"))
            st["range_at"], st["range_w"] = at, range_w
            _cut(st, at, at + range_w)
            return
    warnings.append(f"No room for a {range_w:g}\" range on any wall")


def _finish_base_run(cat, st, room, warnings):
    """Tall pantry at a run end, then greedy gap fill."""
    wid = st["id"]
    lo, hi = st["lo"], st["hi"]
    items = st["items"]
    spans = st["spans"]

    ceiling = _num(room.get("ceiling_in")) or 96.0
    tall_cands = [c for c in cat.by_cat.get("tall", [])
                  if str(c.get("sku", "")).startswith("PC")]
    if tall_cands:
        target_h = ceiling - 2.0
        for s, e in sorted(spans, key=lambda se: se[1] - se[0],
                           reverse=True):
            at_end = abs(s - lo) < 1e-9 or abs(e - hi) < 1e-9
            if not at_end or e - s < 18 - 1e-9:
                continue
            best = min(tall_cands,
                       key=lambda c: (abs((_num(c.get("height_in")) or 0)
                                          - target_h),
                                      -(_num(c.get("width_in")) or 0)))
            tw = _num(best["width_in"])
            if tw <= e - s + 1e-9:
                tat = (e - tw) if abs(e - hi) < 1e-9 else s
                items.append(_item(best["sku"], tat, tw, "tall", "tall"))
                spans = _subtract(spans, (tat, tat + tw))
                break

    r_at, r_w = st["range_at"], st["range_w"]
    for s, e in sorted(spans):
        near = (r_at is not None
                and not (e < r_at - 36 - 1e-9
                         or s > r_at + r_w + 36 + 1e-9))
        _fill_segment(cat, (s, e), items, warnings, wid, "base", near)

    items.sort(key=lambda i: i["at_in"])
    return items, {"sink_at": st["sink_at"], "sink_w": st["sink_w"],
                   "range_at": st["range_at"], "range_w": st["range_w"],
                   "wall_id": wid}


# --------------------------------------------------------------------------
# wall run layout (mirrors base)
# --------------------------------------------------------------------------

def layout_wall_run(cat, base_items, base_meta, wall, openings, style,
                    wall_h, microwave, warnings):
    wid = wall["id"]
    L = _num(wall["length_in"])
    items = []

    # wall runs skip window/door/opening spans entirely
    excl_cuts = []
    for op in openings:
        if op.get("kind") in {"window", "door", "opening"}:
            a = _num(op.get("at_in")) or 0.0
            excl_cuts.append((a, a + (_num(op.get("width_in")) or 0.0)))

    wall_cabs = [c for c in cat.by_cat.get("wall", [])
                 if _num(c.get("height_in")) == float(wall_h)]
    if not wall_cabs:
        warnings.append(f"Wall {wid}: no {wall_h}\"H wall cabinets in catalog; "
                        f"wall run skipped")
        return items
    wc = Catalog([dict(it, category="wall") for it in wall_cabs])

    def wall_fill(s, e):
        """Fill (s,e) minus exclusions with wall cabs + fillers."""
        spans = [(s, e)]
        for cut in excl_cuts:
            spans = _subtract(spans, cut)
        for a, b in sorted(spans):
            pos, rem = a, b - a
            while rem >= 12.0 - 1e-9:
                cab = wc.pick("wall", rem)
                if cab is None:
                    break
                w = _num(cab["width_in"])
                items.append(_item(cab["sku"], pos, w, "wall", "wall"))
                pos += w
                rem -= w
            while rem >= 3.0 - 1e-9:
                fw = 6.0 if rem >= 6.0 - 1e-9 else 3.0
                fh = cat.pick("filler", fw, height=wall_h) \
                    or cat.pick("filler", fw)
                if fh is None:
                    warnings.append(
                        f"Wall {wid}: missing filler SKU for {fw:g}\" gap")
                    break
                items.append(_item(fh["sku"], pos, fw, "filler", "wall"))
                pos += fw
                rem -= fw
            if rem > 0.05:
                warnings.append(
                    f"Wall {wid}: unfillable wall gap of {rem:.1f}\" "
                    f"at {pos:.1f}\"")

    joined_start = wall.get("_joined_start", False)
    joined_end = wall.get("_joined_end", False)

    for bi in base_items:
        bsku = str(bi["sku"])
        s, w = bi["at_in"], bi["width_in"]
        bcat = bi["category"]
        if bcat == "filler":
            wall_fill(s, s + w)
            continue
        if bcat == "panel":
            continue  # panels handled on base/tall levels
        if bcat == "tall":
            continue  # tall cabinets reach the ceiling; no wall cab above
        if bcat == "appliance":
            if bsku.startswith("RANGE-"):
                if microwave:
                    rw = _num(bsku.split("-")[1])
                    # microwave cabs are 18"H regardless of wall_h
                    for mw in ("WMC3018", "WMC2418"):
                        mc = next((c for c in cat.by_cat.get("wall", [])
                                   if str(c.get("sku")) == mw), None)
                        if mc and _num(mc["width_in"]) <= rw + 1e-9:
                            mat = s + (rw - _num(mc["width_in"])) / 2
                            items.append(_item(mw, mat, _num(mc["width_in"]),
                                               "wall", "wall"))
                            break
                    else:
                        warnings.append(
                            f"Wall {wid}: no wall microwave cabinet in catalog")
                continue  # hood space above range otherwise
            if bsku.startswith("FRIDGE-"):
                continue  # panels + 24"-deep cab above handled at base level
            if bsku.startswith("DISHWASHER-"):
                wall_fill(s, s + w)
                continue
            continue
        # base cabinets: mirror with wall SKUs
        if bsku.startswith(CORNER_PREFIX[style]) and (
                (joined_start and abs(s) < 1e-9) or
                (joined_end and abs(s + w - L) < 1e-9)):
            # wall corner cabinet at the corner
            wprefix = WALL_CORNER_PREFIX[style]
            wcorner = next((c for c in wall_cabs
                            if str(c.get("sku", "")).startswith(wprefix)), None)
            if wcorner:
                ww = _num(wcorner["width_in"])
                cs = s if abs(s) < 1e-9 else s + w - ww
                items.append(_item(wcorner["sku"], cs, ww, "wall", "wall"))
                rest = (s + ww, s + w) if abs(s) < 1e-9 else (s, s + w - ww)
                if rest[1] - rest[0] > 0.05:
                    wall_fill(*rest)
            else:
                warnings.append(
                    f"Wall {wid}: no {style} wall corner cabinet in catalog; "
                    f"used filler at corner")
                wall_fill(s, s + w)
            continue
        if re.fullmatch(r"(B|SB|3DB|2DB)\d+|BTC18|BSR\d+|BMC\d+", bsku):
            wall_fill(s, s + w)
            continue
        # anything else: mirror as wall fill
        wall_fill(s, s + w)

    items.sort(key=lambda i: i["at_in"])
    return items


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

def autodesign(room, catalog_items, options):
    """Run the layout engine.

    room: dict with walls [{id, length_in,
              openings [{at_in, width_in, kind[, sill_in, height_in]}]}],
          ceiling_in, appliances {range_in, fridge_in,
              has_dishwasher, has_microwave}.
          (Legacy shapes are also accepted: a flat room["openings"] list
          with wall_id keys, and appliances {dishwasher, microwave}.)
    catalog_items: list of dicts (sku, category, description, width_in,
                   height_in, depth_in, price, notes).
    options: {corner_style: "easy"|"blind"|"lazy", wall_cabinet_height: 30|36|42}.

    Returns (design, warnings). design = {runs: [{wall_id, items}], version: 1}.
    """
    style = (options or {}).get("corner_style", "easy")
    if style not in CORNER_TAKE:
        style = "easy"
    wall_h = (options or {}).get("wall_cabinet_height", 36)

    cat = Catalog(catalog_items or [])
    warnings = []
    if not catalog_items:
        warnings.append("Catalog is empty; no cabinets placed")
        return {"runs": [], "version": 1}, warnings

    walls = room.get("walls") or []
    n = len(walls)
    for i, wall in enumerate(walls):
        wall["_joined_start"] = i > 0
        wall["_joined_end"] = i < n - 1

    runs = []
    appl = room.get("appliances") or {}

    # phase 1: fixed shell (corner cabinets + exposed-end fillers) per wall
    # Openings: contract shape is per-wall (wall["openings"]); a legacy flat
    # room["openings"] list with wall_id keys is also accepted.
    states = []
    for wall in walls:
        wid = wall["id"]
        per_wall = [dict(op, wall_id=wid) for op in (wall.get("openings") or [])]
        legacy = [op for op in (room.get("openings") or [])
                  if op.get("wall_id") == wid]
        openings = per_wall + legacy
        items, lo, hi = _base_shell(cat, wall, style, warnings)
        states.append(_new_state(wall, openings, items, lo, hi))

    # phase 2: appliances in wall order (fridge first to claim a run end,
    # then sink at the window, dishwasher beside it, then the range)
    # Appliance flags: contract shape is has_dishwasher / has_microwave;
    # bare dishwasher / microwave keys are accepted as a fallback.
    want_dw = appl.get("has_dishwasher", appl.get("dishwasher"))
    want_mw = appl.get("has_microwave", appl.get("microwave"))
    _place_fridge(cat, states, _num(appl.get("fridge_in", 36)) or 0.0,
                  warnings)
    _place_sinks(cat, states, warnings)
    _place_dishwashers(cat, states, warnings, bool(want_dw))
    _place_range(states, _num(appl.get("range_in", 30)) or 0.0, warnings)

    # phase 3: tall pantry + gap fill per wall, then mirror the wall run
    for st in states:
        wall = st["wall"]
        openings = st["openings"]
        base_items, meta = _finish_base_run(cat, st, room, warnings)
        wall_items = layout_wall_run(cat, base_items, meta, wall, openings,
                                     style, wall_h, bool(want_mw),
                                     warnings)
        runs.append({"wall_id": st["id"],
                     "items": base_items + wall_items})

    # final safety: every emitted SKU must be real or an appliance placeholder
    for run in runs:
        for it in run["items"]:
            sku = str(it["sku"])
            if not cat.has(sku) and not APPLIANCE_RE.match(sku):
                warnings.append(
                    f"Wall {run['wall_id']}: emitted unknown SKU {sku} "
                    f"(engine bug — please report)")

    return {"runs": runs, "version": 1}, warnings

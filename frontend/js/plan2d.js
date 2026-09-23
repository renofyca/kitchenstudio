/**
 * plan2d.js — 2D SVG floor-plan renderer for KitchenStudio.
 *
 * Also exports the shared geometry helpers used by view3d.js:
 *   - computeWallGeometry(room): lays walls out sequentially at right angles
 *     (matching the backend auto-design engine). Each new wall starts at the
 *     corner with the previous wall and turns 90° left (CCW).
 *   - resolveItemDims(item, catalogMap): best-effort W/H/D for a design item,
 *     preferring catalog data, then SKU-pattern parsing, then level defaults.
 *
 * Coordinates: math convention (x right, y up), 1 unit = 1 inch.
 * renderPlan converts to SVG coords (y flipped) internally.
 */

export const DEPTHS = { base: 23.875, wall: 12, tall: 23.875 };

const ACCENT = '#1d4ed8';

const CAT_FILL = {
  base: '#e3ac6b',
  wall: '#e8c98f',
  tall: '#a9743a',
  panel: '#efe7d6',
  filler: '#9aa0a6',
  appliance: 'url(#ks-hatch)',
  accessory: '#c9b8e0',
};

/**
 * Lay out walls sequentially. Returns one entry per wall:
 * { wall, x0,y0, x1,y1, dx,dy (unit dir), nx,ny (interior normal), len }
 */
export function computeWallGeometry(room) {
  const walls = (room && room.walls) || [];
  const geos = [];
  let px = 0, py = 0;
  const pts = [{ x: 0, y: 0 }];
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const len = Number(w.length_in) || 0;
    const ang = (i * Math.PI) / 2; // each new wall turns 90° left from previous
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const x0 = px, y0 = py;
    px += dx * len; py += dy * len;
    pts.push({ x: px, y: py });
    geos.push({ wall: w, x0, y0, x1: px, y1: py, dx, dy, len, nx: 0, ny: 0 });
  }
  // Interior normal = side facing the centroid of the wall polyline.
  const cx = pts.reduce((s, p) => s + p.x, 0) / Math.max(1, pts.length);
  const cy = pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length);
  for (const g of geos) {
    let nx = -g.dy, ny = g.dx;
    const mx = (g.x0 + g.x1) / 2, my = (g.y0 + g.y1) / 2;
    if ((cx - mx) * nx + (cy - my) * ny < 0) { nx = -nx; ny = -ny; }
    g.nx = nx; g.ny = ny;
  }
  return geos;
}

/**
 * Best-effort dimensions for a design item.
 * Returns { w, h, d, cat, lvl, recognized }.
 */
export function resolveItemDims(item, catalogMap) {
  const sku = String(item.sku || '');
  const cat = item.category || 'base';
  const lvl = item.level || (cat === 'appliance' ? 'base' : cat);
  const c = catalogMap && typeof catalogMap.get === 'function' ? catalogMap.get(sku) : null;
  let w = item.width_in;
  let h, d;
  let recognized = !!c;
  if (c) {
    if (w == null && c.width_in != null) w = Number(c.width_in);
    if (c.height_in != null) h = Number(c.height_in);
    if (c.depth_in != null) d = Number(c.depth_in);
  }
  const tailNum = () => { const m = sku.match(/(\d+)$/); return m ? Number(m[1]) : null; };
  let m;
  if ((m = sku.match(/^RANGE-(\d+)$/i))) {
    recognized = true; if (w == null) w = +m[1]; if (h == null) h = 36; if (d == null) d = 25;
  } else if ((m = sku.match(/^FRIDGE-(\d+)$/i))) {
    recognized = true; if (w == null) w = +m[1]; if (h == null) h = 70; if (d == null) d = 30;
  } else if ((m = sku.match(/^DISHWASHER-(\d+)$/i))) {
    recognized = true; if (w == null) w = +m[1]; if (h == null) h = 34.5; if (d == null) d = 24;
  } else if (cat === 'panel') {
    // Panels/fillers are checked before level branches: a panel's category
    // is a stronger signal than its level (e.g. REF2496 is level "tall").
    if (/^REF/.test(sku)) { recognized = true; if (d == null) d = 24.75; if (h == null) h = 96; if (w == null) w = 3; }
    else if (/^DWEP/.test(sku)) { recognized = true; if (d == null) d = 24.75; if (h == null) h = 34.5; if (w == null) w = 3; }
    else if (/^(BEP|MBEP)/.test(sku)) { recognized = true; if (d == null) d = 23.875; if (h == null) h = 34.5; if (w == null) w = 1.5; }
    else if (/^(WEP|MWEP)/.test(sku)) { recognized = true; if (d == null) d = 12.75; const t = tailNum(); if (h == null) h = t || 30; if (w == null) w = 1.5; }
    else if (/^MTEP/.test(sku)) { recognized = true; if (d == null) d = 23.875; const t = tailNum(); if (h == null) h = t || 84; if (w == null) w = 1.5; }
    else { if (h == null) h = 34.5; if (d == null) d = 23.875; if (w == null) w = 3; }
  } else if (cat === 'filler') {
    if ((m = sku.match(/^WF(\d)(\d{2})$/))) { recognized = true; if (w == null) w = +m[1]; if (h == null) h = +m[2]; }
    else if ((m = sku.match(/^TF(\d)(\d{2})$/))) { recognized = true; if (w == null) w = +m[1]; if (h == null) h = +m[2]; }
    else { if (w == null) w = 3; if (h == null) h = 34.5; }
    if (d == null) d = h > 60 ? 23.875 : 12;
  } else if (lvl === 'base' || cat === 'base') {
    recognized = recognized || /^(B|SB|BTC|3DB|2DB|BSR|BMC|BBC|BER|BLS|BFH)/.test(sku);
    if (h == null) h = 34.5; if (d == null) d = DEPTHS.base;
    if (w == null) w = tailNum() || 24;
  } else if (lvl === 'wall' || cat === 'wall') {
    if (d == null) d = DEPTHS.wall;
    if ((m = sku.match(/^W(\d{2})(\d{2})(\d{2})?$/))) {
      recognized = true; if (w == null) w = +m[1]; if (h == null) h = +m[2]; if (m[3]) d = +m[3];
    } else if (/^(WER|WDC)/.test(sku)) {
      recognized = true; if (w == null) w = 24; if (h == null) h = 30;
    } else if (/^WBC/.test(sku)) {
      recognized = true; if (w == null) w = 27; if (h == null) h = 30;
    } else if (/^W(BF|SL|MC)/.test(sku)) {
      recognized = true; if (w == null) w = tailNum() || 30; if (h == null) h = 30;
    } else {
      if (w == null) w = tailNum() || 24; if (h == null) h = 30;
    }
  } else if (lvl === 'tall' || cat === 'tall') {
    if (d == null) d = DEPTHS.tall;
    if ((m = sku.match(/^(PC|DOC|OC)(\d{2})(\d{2})$/))) {
      recognized = true; if (w == null) w = +m[2]; if (h == null) h = +m[3];
    } else {
      recognized = recognized || /^(PC|OC|DOC|T)/.test(sku);
      if ((m = sku.match(/(\d{2})$/)) && h == null) h = +m[1];
      if (h == null) h = 84;
      if (w == null) { const n = sku.match(/(\d{2})/); w = n ? +n[1] : 24; }
    }
  } else {
    if (w == null) w = 24; if (h == null) h = 34.5; if (d == null) d = 12;
  }
  return { w: Number(w) || 0, h: Number(h) || 0, d: Number(d) || 0, cat, lvl, recognized };
}

/* ---------------- 2D plan rendering ---------------- */

function pt(x, y) { return `${x.toFixed(1)},${(-y).toFixed(1)}`; } // math -> SVG coords

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

/** Keep rotated text upright: fold angles into [-90°, 90°]. */
function uprightDeg(deg) {
  let a = ((deg % 360) + 360) % 360;
  if (a > 90 && a <= 270) a -= 180;
  return a;
}

/**
 * Render the 2D plan into an <svg> element.
 * @param {SVGSVGElement} svgEl
 * @param {Object} room   Room JSON
 * @param {Object|null} design  Design JSON (null => room only)
 * @param {Object} opts   { selected, onSelect }
 */
export function renderPlan(svgEl, room, design, opts = {}) {
  const { selected = null, onSelect = null } = opts;
  const selUid = selected && (selected._uid ?? selected);
  const geos = computeWallGeometry(room);

  // Overall bounds (walls + cabinet depths + room for dims/labels)
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const grow = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  for (const g of geos) {
    grow(g.x0, g.y0); grow(g.x1, g.y1);
    grow(g.x0 + g.nx * 30, g.y0 + g.ny * 30);
    grow(g.x1 + g.nx * 30, g.y1 + g.ny * 30);
    grow(g.x0 - g.nx * 26, g.y0 - g.ny * 26);
    grow(g.x1 - g.nx * 26, g.y1 - g.ny * 26);
  }
  if (!geos.length) { minX = 0; maxX = 120; minY = 0; maxY = 120; }
  const pad = 34;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const vbW = maxX - minX, vbH = maxY - minY;

  const parts = [];
  parts.push(`<defs>
    <pattern id="ks-hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="7" height="7" fill="#bcd4ea"/>
      <line x1="0" y1="0" x2="0" y2="7" stroke="#4a6f96" stroke-width="2"/>
    </pattern>
  </defs>`);

  // ---- Walls (thick dark lines, broken at openings) ----
  for (const g of geos) {
    const openings = (g.wall.openings || [])
      .map(o => ({ at: Number(o.at_in) || 0, w: Number(o.width_in) || 0, kind: o.kind || 'opening', sill: Number(o.sill_in) || 0, h: Number(o.height_in) || 0 }))
      .filter(o => o.w > 0)
      .sort((a, b) => a.at - b.at);
    // wall segments between openings
    let cursor = 0;
    const segs = [];
    for (const o of openings) {
      if (o.at > cursor) segs.push([cursor, o.at]);
      cursor = Math.max(cursor, o.at + o.w);
    }
    if (cursor < g.len) segs.push([cursor, g.len]);
    for (const [a, b] of segs) {
      const ax = g.x0 + g.dx * a, ay = g.y0 + g.dy * a;
      const bx = g.x0 + g.dx * b, by = g.y0 + g.dy * b;
      parts.push(`<line x1="${ax.toFixed(1)}" y1="${(-ay).toFixed(1)}" x2="${bx.toFixed(1)}" y2="${(-by).toFixed(1)}" stroke="#2e2a26" stroke-width="6" stroke-linecap="square"/>`);
    }
    // opening decorations
    for (const o of openings) {
      const ox = g.x0 + g.dx * o.at, oy = g.y0 + g.dy * o.at;
      const ex = g.x0 + g.dx * (o.at + o.w), ey = g.y0 + g.dy * (o.at + o.w);
      const mx = (ox + ex) / 2, my = (oy + ey) / 2;
      if (o.kind === 'window') {
        // thin double line across the gap
        for (const off of [-1.6, 1.6]) {
          const lx = ox + g.nx * off, ly = oy + g.ny * off;
          const rx = ex + g.nx * off, ry = ey + g.ny * off;
          parts.push(`<line x1="${lx.toFixed(1)}" y1="${(-ly).toFixed(1)}" x2="${rx.toFixed(1)}" y2="${(-ry).toFixed(1)}" stroke="#5b7a96" stroke-width="1.4"/>`);
        }
        parts.push(`<text x="${mx.toFixed(1)}" y="${(-(my - g.ny * 9)).toFixed(1)}" font-size="7" text-anchor="middle" fill="#5b7a96">WIN ${Math.round(o.w)}"</text>`);
      } else if (o.kind === 'door') {
        // swing arc from the hinge (opening start) toward the interior
        const r = Math.min(o.w, 36);
        const a0 = Math.atan2(g.dy, g.dx), a1 = Math.atan2(g.ny, g.nx);
        const sx = ox + Math.cos(a0) * r, sy = oy + Math.sin(a0) * r;
        const tx = ox + g.nx * r, ty = oy + g.ny * r;
        const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
        const sweep = 1; // SVG y-flip handled by coordinate transform
        parts.push(`<path d="M ${pt(ox, oy)} L ${pt(sx, sy)} M ${pt(ox, oy)} A ${r} ${r} 0 ${large} ${sweep} ${pt(tx, ty)}" stroke="#7a6a55" stroke-width="1.2" fill="none" stroke-dasharray="3,2"/>`);
        parts.push(`<text x="${mx.toFixed(1)}" y="${(-(my - g.ny * 9)).toFixed(1)}" font-size="7" text-anchor="middle" fill="#7a6a55">DOOR ${Math.round(o.w)}"</text>`);
      } else {
        parts.push(`<line x1="${ox.toFixed(1)}" y1="${(-oy).toFixed(1)}" x2="${ox + g.nx * 4}" y2="${(-(oy + g.ny * 4)).toFixed(1)}" stroke="#2e2a26" stroke-width="2"/>`);
        parts.push(`<line x1="${ex.toFixed(1)}" y1="${(-ey).toFixed(1)}" x2="${ex + g.nx * 4}" y2="${(-(ey + g.ny * 4)).toFixed(1)}" stroke="#2e2a26" stroke-width="2"/>`);
        parts.push(`<text x="${mx.toFixed(1)}" y="${(-(my - g.ny * 9)).toFixed(1)}" font-size="7" text-anchor="middle" fill="#666">OPENING</text>`);
      }
    }
    // wall id + overall dimension (offset outward)
    const mx = (g.x0 + g.x1) / 2, my = (g.y0 + g.y1) / 2;
    const ox = -g.nx * 20, oy = -g.ny * 20;
    const angDeg = uprightDeg((-Math.atan2(g.dy, g.dx) * 180) / Math.PI);
    parts.push(`<text x="${(g.x0 - g.nx * 8).toFixed(1)}" y="${(-(g.y0 - g.ny * 8)).toFixed(1)}" font-size="9" font-weight="bold" fill="#2e2a26" text-anchor="middle">${esc(g.wall.id || '')}</text>`);
    parts.push(`<line x1="${(g.x0 + ox).toFixed(1)}" y1="${(-(g.y0 + oy)).toFixed(1)}" x2="${(g.x1 + ox).toFixed(1)}" y2="${(-(g.y1 + oy)).toFixed(1)}" stroke="#888" stroke-width="0.8"/>`);
    for (const [exx, eyy] of [[g.x0, g.y0], [g.x1, g.y1]]) {
      parts.push(`<line x1="${(exx + ox - g.nx * 3).toFixed(1)}" y1="${(-(eyy + oy - g.ny * 3)).toFixed(1)}" x2="${(exx + ox + g.nx * 3).toFixed(1)}" y2="${(-(eyy + oy + g.ny * 3)).toFixed(1)}" stroke="#888" stroke-width="0.8"/>`);
    }
    parts.push(`<text x="${(mx + ox).toFixed(1)}" y="${(-(my + oy)).toFixed(1)}" font-size="8" fill="#555" text-anchor="middle" transform="rotate(${angDeg.toFixed(1)} ${(mx + ox).toFixed(1)} ${(-(my + oy)).toFixed(1)})">${Math.round(g.len)}"</text>`);
  }

  // ---- Cabinets ----
  if (design && design.runs) {
    const geoById = new Map(geos.map(g => [g.wall.id, g]));
    for (const run of design.runs) {
      const g = geoById.get(run.wall_id);
      if (!g) continue; // wall referenced by design no longer exists
      const items = run.items || [];
      // intervals (along-wall) occupied by non-wall-level items, used to
      // declutter wall-cabinet labels drawn over them
      const lowIntervals = items
        .filter(it => resolveItemDims(it, null).lvl !== 'wall')
        .map(it => { const a = Number(it.at_in) || 0; return [a, a + (Number(it.width_in) || 0)]; });
      for (const item of items) {
        const dims = resolveItemDims(item, null);
        const w = dims.w, d = dims.d;
        const at = Number(item.at_in) || 0;
        const x0 = g.x0 + g.dx * at, y0 = g.y0 + g.dy * at;
        const x1 = g.x0 + g.dx * (at + w), y1 = g.y0 + g.dy * (at + w);
        const ix0 = x0 + g.nx * d, iy0 = y0 + g.ny * d;
        const ix1 = x1 + g.nx * d, iy1 = y1 + g.ny * d;
        const ptsStr = `${pt(x0, y0)} ${pt(x1, y1)} ${pt(ix1, iy1)} ${pt(ix0, iy0)}`;
        const isWall = dims.lvl === 'wall';
        const fill = CAT_FILL[dims.cat] || '#ddd';
        const uid = item._uid ?? '';
        const isSel = selUid != null && String(uid) === String(selUid);
        const dash = isWall ? ' stroke-dasharray="5,3"' : '';
        parts.push(`<polygon points="${ptsStr}" fill="${fill}" fill-opacity="${isWall ? 0.55 : 0.9}" stroke="${isSel ? ACCENT : '#4a4238'}" stroke-width="${isSel ? 2.6 : 1.1}"${dash} data-uid="${esc(uid)}" style="cursor:pointer"/>`);
        if (w >= 10 && !isSel) {
          const centerAt = at + w / 2;
          const covered = isWall && lowIntervals.some(([a, b]) => centerAt > a + 1 && centerAt < b - 1);
          if (!covered) {
            const cx = (x0 + x1 + ix0 + ix1) / 4, cy = (y0 + y1 + iy0 + iy1) / 4;
            const angDeg = uprightDeg((-Math.atan2(g.dy, g.dx) * 180) / Math.PI);
            const fs = Math.min(8, Math.max(5.5, w * 0.32));
            parts.push(`<text x="${cx.toFixed(1)}" y="${(-cy).toFixed(1)}" font-size="${fs.toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="#3a332b" transform="rotate(${angDeg.toFixed(1)} ${cx.toFixed(1)} ${(-cy).toFixed(1)})" style="pointer-events:none">${esc(item.sku || '')}</text>`);
          }
        }
      }
    }
  }

  // ---- Legend + note ----
  const lx = minX + 6, ly = maxY - 6;
  const legend = [
    ['Base', CAT_FILL.base], ['Wall', CAT_FILL.wall], ['Tall', CAT_FILL.tall],
    ['Appliance', '#9fc2e2'], ['Panel', CAT_FILL.panel], ['Filler', CAT_FILL.filler],
  ];
  let legX = lx;
  parts.push(`<g font-size="7.5" fill="#444">`);
  for (const [label, fill] of legend) {
    parts.push(`<rect x="${legX.toFixed(1)}" y="${(-ly).toFixed(1)}" width="14" height="9" fill="${fill}" stroke="#666" stroke-width="0.8"/>`);
    parts.push(`<text x="${(legX + 16).toFixed(1)}" y="${(-ly + 7).toFixed(1)}">${label}</text>`);
    legX += 16 + label.length * 4.4 + 10;
  }
  parts.push(`</g>`);
  parts.push(`<text x="${maxX - 6}" y="${(-(maxY - 6)).toFixed(1)}" font-size="8" font-style="italic" text-anchor="end" fill="#888">not to scale</text>`);

  svgEl.setAttribute('viewBox', `${minX.toFixed(1)} ${(-maxY).toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}`);
  svgEl.innerHTML = parts.join('\n');

  if (onSelect) {
    svgEl.querySelectorAll('[data-uid]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = el.getAttribute('data-uid');
        const item = findItemByUid(design, uid);
        onSelect(item);
      });
    });
  }
}

function findItemByUid(design, uid) {
  if (!design || !design.runs || uid == null || uid === '') return null;
  for (const run of design.runs) {
    for (const item of run.items || []) {
      if (String(item._uid ?? '') === String(uid)) return item;
    }
  }
  return null;
}

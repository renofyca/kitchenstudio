/**
 * view3d.js — photoreal-ish Three.js kitchen renderer for KitchenStudio.
 *
 * 1 unit = 1 inch. Y-up. Plan coords (x, y) map to world (x, 0, y).
 * Wall layout matches computeWallGeometry() in plan2d.js (sequential walls,
 * each new wall turns 90° left; cabinets sit against the wall on its interior
 * normal side).
 *
 * Mounting standards (Oppein design rules):
 *   base box 34.5" overall AFF (4.5" toe-kick + 30" box), countertop top at 36"
 *   (1.5" slab, 1" front overhang), wall cabs bottom at 54" AFF, tall 0->H.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { computeWallGeometry, resolveItemDims } from './plan2d.js';

const ACCENT = 0x1d4ed8;

const DOOR_COLORS = {
  white: '#f5f3ee',
  gray: '#cfd2d6',
  navy: '#2c3e58',
  wood: null, // procedural oak texture
};
const COUNTER_COLORS = { white: '#f4f2ec', gray: '#b9bcc0' };

/* ---------------- procedural textures ---------------- */

function makeWoodFloorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#b0824f';
  g.fillRect(0, 0, 512, 512);
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const y = (r * 512) / rows;
    const shade = 0.92 + Math.random() * 0.16;
    g.fillStyle = `rgb(${Math.round(176 * shade)},${Math.round(130 * shade)},${Math.round(79 * shade)})`;
    g.fillRect(0, y, 512, 512 / rows);
    // grain streaks
    g.strokeStyle = 'rgba(90,60,30,0.18)';
    g.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const gy = y + Math.random() * (512 / rows);
      g.beginPath();
      g.moveTo(0, gy);
      for (let x = 0; x <= 512; x += 64) g.lineTo(x, gy + Math.sin(x * 0.02 + i) * 2);
      g.stroke();
    }
    // plank seams + butt joints
    g.fillStyle = 'rgba(60,40,20,0.55)';
    g.fillRect(0, y, 512, 2);
    const jx = Math.random() * 512;
    g.fillRect(jx, y, 2, 512 / rows);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function makeOakTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#c79a5e';
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 256;
    g.strokeStyle = `rgba(120,80,35,${0.08 + Math.random() * 0.12})`;
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= 512; y += 32) g.lineTo(x + Math.sin(y * 0.015 + i) * 6, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------- small geometry helpers ---------------- */

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Shaker door/drawer front: stiles + rails + recessed center panel. Faces +z. */
function shakerFront(w, h, mats, opts = {}) {
  const grp = new THREE.Group();
  const rail = 2.5;            // stile/rail width
  const thick = 0.75;          // door thickness
  const mat = mats.door;
  // stiles (full height)
  grp.add(box(rail, h, thick, mat, -w / 2 + rail / 2, 0, 0));
  grp.add(box(rail, h, thick, mat, w / 2 - rail / 2, 0, 0));
  // rails
  const innerW = Math.max(0.1, w - rail * 2);
  grp.add(box(innerW, rail, thick, mat, 0, h / 2 - rail / 2, 0));
  grp.add(box(innerW, rail, thick, mat, 0, -h / 2 + rail / 2, 0));
  // recessed center panel (set back 0.35")
  const pw = Math.max(0.1, w - rail * 2 - 0.3);
  const ph = Math.max(0.1, h - rail * 2 - 0.3);
  grp.add(box(pw, ph, 0.35, mat, 0, 0, -0.35 + 0.175 - 0.02));
  // handle (horizontal bar) unless disabled
  if (!opts.noHandle) {
    const hl = Math.min(5.5, Math.max(3.5, w * 0.35));
    grp.add(barHandle(hl, mats, 0, opts.handleY ?? h / 2 - 1.6, thick / 2 + 0.95));
  }
  return grp;
}

/** Horizontal brushed-metal bar handle on two standoffs. */
function barHandle(len, mats, x, y, z) {
  const grp = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, len, 12), mats.handle);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(x, y, z);
  bar.castShadow = true;
  grp.add(bar);
  for (const sx of [-len / 2 + 0.5, len / 2 - 0.5]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.85, 8), mats.handle);
    post.rotation.x = Math.PI / 2;
    post.position.set(x + sx, y, z - 0.45);
    grp.add(post);
  }
  return grp;
}

/* ---------------- cabinet builders ---------------- */

function buildBaseCabinet(dims, mats, item) {
  const { w, d } = dims;
  const grp = new THREE.Group();
  // toe-kick: 4.5"H x 3"D recess at front
  grp.add(box(w - 0.5, 4.5, Math.max(1, d - 3), mats.toe, 0, 2.25, (d - 3) / 2));
  // carcass: 30" box on top of toe -> 34.5" overall
  grp.add(box(w, 30, d, mats.door, 0, 4.5 + 15, d / 2));
  const front = d + 0.05;
  const drawerH = 6.75;
  const doorTop = 34.5 - 0.4 - drawerH;
  const doorH = doorTop - 4.5 - 0.2;
  const isCorner = /^B(ER|LS)/.test(String(item.sku || ''));
  // drawer front
  const df = shakerFront(w - 0.15, drawerH, mats, { handleY: 1.2 });
  df.position.set(0, 34.5 - 0.4 - drawerH / 2, front + 0.375);
  grp.add(df);
  if (isCorner) {
    // easy-reach / lazy-susan: square footprint, single centered door
    const door = shakerFront(Math.min(w * 0.52, 18), doorH, mats, { handleY: doorH / 2 - 1.6 });
    door.position.set(0, 4.5 + 0.2 + doorH / 2, front + 0.375);
    grp.add(door);
  } else {
    const n = w < 21 ? 1 : 2;
    const dw = (w - 0.15 - (n - 1) * 0.15) / n;
    for (let i = 0; i < n; i++) {
      const dx = -w / 2 + 0.075 + dw / 2 + i * (dw + 0.15);
      const door = shakerFront(dw, doorH, mats, { handleY: doorH / 2 - 1.4 });
      door.position.set(dx, 4.5 + 0.2 + doorH / 2, front + 0.375);
      grp.add(door);
    }
  }
  return grp;
}

function buildWallCabinet(dims, mats) {
  const { w, h, d } = dims;
  const grp = new THREE.Group();
  const bottom = 54; // 54" AFF
  grp.add(box(w, h, d, mats.door, 0, bottom + h / 2, d / 2));
  const front = d + 0.05;
  const n = w < 21 ? 1 : 2;
  const dw = (w - 0.15 - (n - 1) * 0.15) / n;
  for (let i = 0; i < n; i++) {
    const dx = -w / 2 + 0.075 + dw / 2 + i * (dw + 0.15);
    const door = shakerFront(dw, h - 0.15, mats, { handleY: -(h / 2 - 1.6) });
    door.position.set(dx, bottom + h / 2, front + 0.375);
    grp.add(door);
  }
  return grp;
}

function buildTallCabinet(dims, mats) {
  const { w, h, d } = dims;
  const grp = new THREE.Group();
  grp.add(box(w - 0.5, 4.5, Math.max(1, d - 3), mats.toe, 0, 2.25, (d - 3) / 2));
  grp.add(box(w, h - 4.5, d, mats.door, 0, 4.5 + (h - 4.5) / 2, d / 2));
  const front = d + 0.05;
  const splitY = h * 0.52; // upper / lower door split
  const n = w >= 24 ? 2 : 1;
  const mkRow = (y0, y1) => {
    const rh = y1 - y0 - 0.15;
    const dw = (w - 0.15 - (n - 1) * 0.15) / n;
    for (let i = 0; i < n; i++) {
      const dx = -w / 2 + 0.075 + dw / 2 + i * (dw + 0.15);
      const door = shakerFront(dw, rh, mats, { handleY: (y1 - y0) / 2 > 30 ? -(rh / 2 - 1.4) : rh / 2 - 1.4 });
      door.position.set(dx, y0 + 0.075 + rh / 2, front + 0.375);
      grp.add(door);
    }
  };
  mkRow(4.5, splitY);
  mkRow(splitY, h);
  return grp;
}

function buildPanel(dims, mats) {
  const { w, h, d } = dims;
  const grp = new THREE.Group();
  grp.add(box(w, h, d, mats.door, 0, h / 2, d / 2)); // thin slab against wall
  return grp;
}

function buildFiller(dims, mats) {
  const { w, h, d } = dims;
  const grp = new THREE.Group();
  grp.add(box(w, h, d, mats.door, 0, h / 2, d / 2));
  return grp;
}

function buildAppliance(dims, mats, item) {
  const { w, h, d } = dims;
  const sku = String(item.sku || '').toUpperCase();
  const grp = new THREE.Group();
  if (sku.startsWith('RANGE')) {
    grp.add(box(w - 0.5, 4, Math.max(1, d - 3), mats.toe, 0, 2, (d - 3) / 2));
    grp.add(box(w, 30.5, d, mats.applianceBody, 0, 4 + 15.25, d / 2));
    // black glass cooktop (36" top)
    const ct = box(w + 0.4, 1.5, d + 1, mats.blackGlass, 0, 34.5 + 0.75, (d + 1) / 2 - 0.5);
    grp.add(ct);
    // oven door + handle
    grp.add(box(w - 5, 19, 0.4, mats.blackGlass, 0, 17, d + 0.2));
    grp.add(barHandle(Math.min(20, w - 6), mats, 0, 27.5, d + 1.1));
  } else if (sku.startsWith('FRIDGE')) {
    grp.add(box(w, h, d, mats.steel, 0, h / 2, d / 2));
    // split doors + vertical handles
    const dw = (w - 0.6) / 2;
    for (const sx of [-1, 1]) {
      grp.add(box(dw, h - 6, 0.8, mats.steel, sx * (dw / 2 + 0.15), h / 2 + 1, d + 0.4));
      const hd = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 26, 12), mats.handle);
      hd.position.set(sx * 1.4, h / 2 + 2, d + 1.5);
      hd.castShadow = true;
      grp.add(hd);
    }
  } else if (sku.startsWith('DISHWASHER')) {
    grp.add(box(w, 30, d - 1, mats.applianceBody, 0, 4.5 + 15, (d - 1) / 2));
    grp.add(box(w - 0.5, 4.5, Math.max(1, d - 4), mats.toe, 0, 2.25, (d - 4) / 2));
    const front = shakerFront(w - 0.15, 29.5, mats, { handleY: 29.5 / 2 - 2 });
    front.position.set(0, 4.5 + 15.25, d - 1 + 0.05 + 0.375);
    grp.add(front);
  } else {
    grp.add(box(w, h, d, mats.applianceBody, 0, h / 2, d / 2));
  }
  return grp;
}

/** Fallback for SKUs we can't parse: a plain door-colored box. */
function buildPlainBox(dims, mats) {
  const grp = new THREE.Group();
  const y0 = dims.lvl === 'wall' ? 54 : 0;
  grp.add(box(dims.w, dims.h, dims.d, mats.door, 0, y0 + dims.h / 2, dims.d / 2));
  return grp;
}

function buildItemGroup(item, catalogMap, mats) {
  const dims = resolveItemDims(item, catalogMap);
  if (!dims.recognized) console.warn('[KitchenStudio] unknown SKU, rendering plain box:', item.sku);
  let grp;
  if (!dims.recognized) grp = buildPlainBox(dims, mats);
  else if (dims.cat === 'appliance') grp = buildAppliance(dims, mats, item);
  else if (dims.cat === 'panel') grp = buildPanel(dims, mats);
  else if (dims.cat === 'filler') grp = buildFiller(dims, mats);
  else if (dims.lvl === 'wall') grp = buildWallCabinet(dims, mats);
  else if (dims.lvl === 'tall') grp = buildTallCabinet(dims, mats);
  else grp = buildBaseCabinet(dims, mats, item);
  grp.userData.itemRef = item;
  grp.userData.dims = dims;
  return grp;
}

/* ---------------- countertop spans ---------------- */

/** Merge contiguous base-level runs into countertop slabs. */
function buildCountertops(design, geos, catalogMap, mats) {
  const grp = new THREE.Group();
  if (!design || !design.runs) return grp;
  const geoById = new Map(geos.map(g => [g.wall.id, g]));
  for (const run of design.runs) {
    const g = geoById.get(run.wall_id);
    if (!g) continue;
    const eligible = [];
    for (const item of run.items || []) {
      const dims = resolveItemDims(item, catalogMap);
      const sku = String(item.sku || '').toUpperCase();
      const isRange = sku.startsWith('RANGE');
      const counterOk =
        (dims.lvl === 'base' && !isRange && dims.cat !== 'tall') ||
        sku.startsWith('DISHWASHER') ||
        (dims.cat === 'panel' && dims.h >= 30 && dims.h <= 40);
      if (!counterOk) continue;
      eligible.push({ at: Number(item.at_in) || 0, end: (Number(item.at_in) || 0) + dims.w });
    }
    eligible.sort((a, b) => a.at - b.at);
    const spans = [];
    for (const e of eligible) {
      const last = spans[spans.length - 1];
      if (last && e.at <= last.end + 0.75) last.end = Math.max(last.end, e.end);
      else spans.push({ ...e });
    }
    for (const s of spans) {
      const x0 = s.at - 1, x1 = s.end + 1; // 1" side overhang at run ends
      const len = x1 - x0;
      const back = -0.5, front = 23.875 + 1; // 1" front overhang past base box
      const slab = box(len, 1.5, front - back, mats.counter,
        g.x0 + g.dx * (x0 + x1) / 2 + g.nx * (front + back) / 2,
        34.5 + 0.75,
        g.y0 + g.dy * (x0 + x1) / 2 + g.ny * (front + back) / 2);
      slab.rotation.y = -Math.atan2(g.dy, g.dx);
      // rotate slab so its length axis follows the wall: recompute via group
      grp.add(slab);
    }
  }
  return grp;
}

/* ---------------- room shell ---------------- */

function buildRoomShell(room, geos, mats) {
  const grp = new THREE.Group();
  const ceiling = Number(room.ceiling_in) || 96;

  // floor with margin
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const g of geos) {
    for (const [x, y] of [[g.x0, g.y0], [g.x1, g.y1]]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (!geos.length) { minX = 0; maxX = 120; minY = 0; maxY = 120; }
  const fw = maxX - minX + 160, fd = maxY - minY + 160;
  const floorTex = mats.floorTex;
  floorTex.repeat.set(fw / 96, fd / 96);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), mats.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((minX + maxX) / 2, 0, (minY + maxY) / 2);
  floor.receiveShadow = true;
  grp.add(floor);

  // walls: boxes to ceiling, split around openings; interior face flush with wall line.
  // Each segment is built in a holder group oriented along the wall so the
  // math stays simple: holder local +x = wall direction, local +z = wall normal.
  const WALL_T = 4;
  for (const g of geos) {
    // wallSide: local +z faces the room when -1; wall boxes sit behind the line
    const wallS = ((-g.dy) * g.nx + g.dx * g.ny) >= 0 ? -1 : 1;
    const openings = (g.wall.openings || [])
      .map(o => ({ at: Number(o.at_in) || 0, w: Number(o.width_in) || 0, kind: o.kind || 'opening', sill: Number(o.sill_in) || 0, h: Number(o.height_in) || 0 }))
      .filter(o => o.w > 0)
      .sort((a, b) => a.at - b.at);
    const segGroup = (a, b, y0, y1) => {
      if (b - a <= 0.01 || y1 - y0 <= 0.01) return;
      const len = b - a, hgt = y1 - y0;
      const holder = new THREE.Group();
      holder.position.set(g.x0 + g.dx * (a + b) / 2, y0 + hgt / 2, g.y0 + g.dy * (a + b) / 2);
      holder.rotation.y = -Math.atan2(g.dy, g.dx);
      const m = box(len, hgt, WALL_T, mats.wall, 0, 0, (wallS * WALL_T) / 2);
      holder.add(m);
      grp.add(holder);
    };
    let cursor = 0;
    const plainSegs = [];
    for (const o of openings) {
      if (o.at > cursor) plainSegs.push([cursor, o.at]);
      cursor = Math.max(cursor, o.at + o.w);
    }
    if (cursor < g.len) plainSegs.push([cursor, g.len]);
    for (const [a, b] of plainSegs) segGroup(a, b, 0, ceiling);

    for (const o of openings) {
      const sill = o.kind === 'window' ? o.sill : 0;
      const top = o.kind === 'window' ? o.sill + o.h : (o.kind === 'door' ? 80 : ceiling);
      if (o.kind === 'window') {
        segGroup(o.at, o.at + o.w, 0, sill);            // below sill
        segGroup(o.at, o.at + o.w, sill + o.h, ceiling); // header
        // glass + frame, oriented with the wall
        const holder = new THREE.Group();
        holder.position.set(g.x0 + g.dx * (o.at + o.w / 2), sill + o.h / 2, g.y0 + g.dy * (o.at + o.w / 2));
        holder.rotation.y = -Math.atan2(g.dy, g.dx);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(o.w - 2, o.h - 2), mats.glass);
        glass.position.z = 0;
        holder.add(glass);
        const ft = 2.2; // frame trim width
        const fz = 0.6;
        holder.add(box(o.w, ft, fz, mats.trim, 0, o.h / 2 - ft / 2, 0));
        holder.add(box(o.w, ft, fz, mats.trim, 0, -o.h / 2 + ft / 2, 0));
        holder.add(box(ft, o.h, fz, mats.trim, -o.w / 2 + ft / 2, 0, 0));
        holder.add(box(ft, o.h, fz, mats.trim, o.w / 2 - ft / 2, 0, 0));
        holder.add(box(o.w + 2, 1.2, 3, mats.trim, 0, -o.h / 2 - 0.4, -wallS * 1)); // sill ledge
        grp.add(holder);
      } else {
        if (top < ceiling) segGroup(o.at, o.at + o.w, top, ceiling);
        if (o.kind === 'door') {
          // simple casing trim on the interior face
          const holder = new THREE.Group();
          holder.position.set(g.x0 + g.dx * (o.at + o.w / 2), top / 2, g.y0 + g.dy * (o.at + o.w / 2));
          holder.rotation.y = -Math.atan2(g.dy, g.dx);
          const tw = 2.5;
          const tz = -wallS * 0.4;
          holder.add(box(tw, top, 0.8, mats.trim, -o.w / 2 - tw / 2 + 0.4, 0, tz));
          holder.add(box(tw, top, 0.8, mats.trim, o.w / 2 + tw / 2 - 0.4, 0, tz));
          holder.add(box(o.w + tw * 2, tw, 0.8, mats.trim, 0, top / 2 - tw / 2 + 0.2, tz));
          grp.add(holder);
        }
      }
    }
  }
  return grp;
}

/* ---------------- main entry ---------------- */

export function buildScene(container, room, design, catalogItems, finishes) {
  const catalogMap = new Map((catalogItems || []).map(c => [String(c.sku), c]));
  const geos = computeWallGeometry(room);
  const ceiling = Number(room.ceiling_in) || 96;

  // room bounds for camera/lights
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const g of geos) {
    for (const [x, y] of [[g.x0, g.y0], [g.x1, g.y1]]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (!geos.length) { minX = 0; maxX = 120; minY = 0; maxY = 120; }
  const cx = (minX + maxX) / 2, cz = (minY + maxY) / 2;
  const roomR = Math.max(maxX - minX, maxY - minY, 60);

  // ---- renderer ----
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e3e1dc');

  const camera = new THREE.PerspectiveCamera(45, 1, 1, 4000);

  // ---- environment + lights ----
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f70, 0.62));

  const key = new THREE.DirectionalLight(0xfff2e2, 2.4);
  key.position.set(cx + roomR * 0.8, ceiling + roomR * 0.9, cz + roomR * 0.6);
  key.target.position.set(cx, 0, cz);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const se = roomR * 0.85;
  key.shadow.camera.left = -se; key.shadow.camera.right = se;
  key.shadow.camera.top = se; key.shadow.camera.bottom = -se;
  key.shadow.camera.near = 10; key.shadow.camera.far = ceiling + roomR * 3;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 1;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(0xdfe8f5, 0.7);
  fill.position.set(cx - roomR, ceiling * 0.7, cz - roomR * 0.7);
  scene.add(fill);

  // ---- materials ----
  const oakTex = makeOakTexture();
  const mats = {
    door: new THREE.MeshStandardMaterial({ color: DOOR_COLORS.white, roughness: 0.5, metalness: 0.04, envMapIntensity: 0.7 }),
    toe: new THREE.MeshStandardMaterial({ color: '#232326', roughness: 0.9 }),
    counter: new THREE.MeshPhysicalMaterial({ color: COUNTER_COLORS.white, roughness: 0.22, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 1.1 }),
    handle: new THREE.MeshStandardMaterial({ color: '#b9bdc2', roughness: 0.32, metalness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: '#ccd1d6', roughness: 0.32, metalness: 0.75, envMapIntensity: 1 }),
    applianceBody: new THREE.MeshStandardMaterial({ color: '#33363b', roughness: 0.5, metalness: 0.35 }),
    blackGlass: new THREE.MeshPhysicalMaterial({ color: '#101216', roughness: 0.08, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.4 }),
    wall: new THREE.MeshStandardMaterial({ color: '#e9e5de', roughness: 0.95 }),
    trim: new THREE.MeshStandardMaterial({ color: '#faf8f4', roughness: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#5a7186', roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.75, envMapIntensity: 1.5, side: THREE.DoubleSide }),
    floorTex: makeWoodFloorTexture(),
    floor: null,
  };
  mats.floor = new THREE.MeshStandardMaterial({ map: mats.floorTex, roughness: 0.7, metalness: 0 });

  const applyFinishes = (f) => {
    const door = (f && f.door) || 'white';
    const counter = (f && f.counter) || 'white';
    if (door === 'wood') {
      mats.door.map = oakTex;
      mats.door.color.set('#ffffff');
    } else {
      mats.door.map = null;
      mats.door.color.set(DOOR_COLORS[door] || DOOR_COLORS.white);
    }
    mats.door.needsUpdate = true;
    mats.counter.color.set(COUNTER_COLORS[counter] || COUNTER_COLORS.white);
    mats.counter.needsUpdate = true;
  };
  applyFinishes(finishes);

  // ---- room shell ----
  scene.add(buildRoomShell(room, geos, mats));

  // ---- cabinets ----
  const cabinetRoot = new THREE.Group();
  scene.add(cabinetRoot);
  const itemGroups = new Map(); // uid -> group

  const placeItem = (item, g) => {
    const dims = resolveItemDims(item, catalogMap);
    const grp = buildItemGroup(item, catalogMap, mats);
    const at = Number(item.at_in) || 0;
    // holder: local +x = wall direction. Builders center items on x=0,
    // so shifting by ±w/2 spans the item over [at, at+w] along the wall.
    // If the interior normal points the "wrong" way in local space, rotate
    // the holder 180° so cabinet fronts always face the room.
    const holder = new THREE.Group();
    holder.position.set(g.x0 + g.dx * at, 0, g.y0 + g.dy * at);
    const baseRy = -Math.atan2(g.dy, g.dx);
    const localNz = { x: -g.dy, y: g.dx }; // world dir of holder-local +z
    const flip = localNz.x * g.nx + localNz.y * g.ny < 0;
    holder.rotation.y = flip ? baseRy + Math.PI : baseRy;
    grp.position.set(flip ? -dims.w / 2 : dims.w / 2, 0, 0);
    holder.add(grp);
    cabinetRoot.add(holder);
    if (item._uid != null) itemGroups.set(String(item._uid), holder);
    return holder;
  };

  const buildAllCabinets = (dsgn) => {
    // dispose previous
    cabinetRoot.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    cabinetRoot.clear();
    itemGroups.clear();
    if (!dsgn || !dsgn.runs) return;
    const geoById = new Map(geos.map(g => [g.wall.id, g]));
    for (const run of dsgn.runs) {
      const g = geoById.get(run.wall_id);
      if (!g) { console.warn('[KitchenStudio] design references missing wall_id:', run.wall_id); continue; }
      for (const item of run.items || []) placeItem(item, g);
    }
    cabinetRoot.add(buildCountertops(dsgn, geos, catalogMap, mats));
  };

  let currentDesign = design;
  buildAllCabinets(currentDesign);

  // ---- controls ----
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set(cx, 32, cz);

  const api = {
    scene, camera, renderer, controls,
    onSelect: null,

    updateDesign(dsgn) {
      currentDesign = dsgn;
      if (selHelper) { scene.remove(selHelper); selHelper.geometry.dispose(); selHelper = null; }
      buildAllCabinets(dsgn);
    },

    setFinishes(f) { applyFinishes(f); },

    select(predicate) {
      if (selHelper) { scene.remove(selHelper); selHelper.geometry.dispose(); selHelper = null; }
      if (!predicate) return;
      for (const [, holder] of itemGroups) {
        const item = holder.children[0]?.userData.itemRef;
        if (item && predicate(item)) {
          selHelper = new THREE.BoxHelper(holder, ACCENT);
          scene.add(selHelper);
          break;
        }
      }
    },

    snapshot() {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    },

    focusView(name) {
      if (name === 'top') {
        camera.position.set(cx, roomR * 2.2 + 80, cz + 0.01);
        controls.target.set(cx, 0, cz);
      } else if (name === 'front') {
        const g = geos.reduce((a, b) => (a && a.len > b.len ? a : b), geos[0]);
        if (g) {
          const mx = (g.x0 + g.x1) / 2, mz = (g.y0 + g.y1) / 2;
          camera.position.set(mx + g.nx * roomR * 1.6, 58, mz + g.ny * roomR * 1.6);
          controls.target.set(mx, 38, mz);
        }
      } else { // perspective: view from the most "open" side of the room
        // Largest angular gap between wall midpoints as seen from room center.
        // For L/U shapes this points at the open side; for a single wall it
        // points opposite the interior normal (i.e. at the cabinet fronts).
        const angs = geos.map(g => {
          const mx = (g.x0 + g.x1) / 2 - cx, mz = (g.y0 + g.y1) / 2 - cz;
          if (Math.hypot(mx, mz) < 1) return Math.atan2(-g.ny, -g.nx);
          return Math.atan2(mz, mx);
        }).sort((a, b) => a - b);
        let bestStart = 0, bestGap = Math.PI * 2;
        if (angs.length) {
          bestGap = -1;
          for (let i = 0; i < angs.length; i++) {
            const a0 = angs[i];
            const a1 = i + 1 < angs.length ? angs[i + 1] : angs[0] + Math.PI * 2;
            if (a1 - a0 > bestGap) { bestGap = a1 - a0; bestStart = a0; }
          }
        }
        const va = bestStart + bestGap / 2;
        const enclosed = bestGap < 1.2; // near-enclosed room: go high instead
        const dist = roomR * (enclosed ? 1.0 : 1.75);
        const hgt = enclosed ? roomR * 1.6 : roomR * 0.72 + 40;
        camera.position.set(cx + Math.cos(va) * dist, hgt, cz + Math.sin(va) * dist);
        controls.target.set(cx, 30, cz);
      }
      controls.update();
    },

    dispose() {
      cancelAnimationFrame(rafId);
      resizeObs.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
    },
  };

  // selection highlight (declared after api for closure use)
  let selHelper = null;

  // ---- picking ----
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let downPos = null;
  const onDown = (e) => { downPos = [e.clientX, e.clientY]; };
  const onUp = (e) => {
    if (!downPos) return;
    const dx = e.clientX - downPos[0], dy = e.clientY - downPos[1];
    downPos = null;
    if (dx * dx + dy * dy > 36) return; // it was a drag
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(cabinetRoot.children, true);
    let item = null;
    if (hits.length) {
      let o = hits[0].object;
      while (o && !o.userData.itemRef) o = o.parent;
      if (o) item = o.userData.itemRef;
    }
    api.select(item ? (it => it === item) : null);
    if (api.onSelect) api.onSelect(item);
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

  // ---- resize + render loop ----
  const resize = () => {
    const wpx = container.clientWidth || 1, hpx = container.clientHeight || 1;
    renderer.setSize(wpx, hpx, false);
    camera.aspect = wpx / hpx;
    camera.updateProjectionMatrix();
  };
  const resizeObs = new ResizeObserver(resize);
  resizeObs.observe(container);
  resize();

  let rafId = 0;
  const loop = () => {
    rafId = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  api.focusView('perspective');
  loop();

  return api;
}

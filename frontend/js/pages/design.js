/**
 * pages/design.js — KitchenStudio DESIGNER page.
 *
 * Layout: top toolbar | left 2D plan | center 3D viewport | right editor panel.
 * Owns page state (project, room, design, catalog, finishes, selection, dirty)
 * and wires the three views together: 2D plan <-> 3D scene <-> editor.
 *
 * Contracts (from ../api.js, built in parallel — coded against signatures):
 *   getProject(id)              -> { id, name, room, design }
 *   getCatalog(id)              -> [ { sku, name, category, level, width_in, ... } ]
 *   autodesign(id, { corner_style, wall_cabinet_height }) -> { design, warnings }
 *   saveDesign(id, design)      -> void
 */

import { getProject, autodesign, saveDesign, getCatalog } from '../api.js';
import { renderPlan, resolveItemDims, computeWallGeometry } from '../plan2d.js';
import { buildScene } from '../view3d.js';

const CATEGORIES = ['base', 'wall', 'tall', 'panel', 'filler', 'appliance', 'accessory'];
const DOOR_FINISHES = [
  ['white', 'White'],
  ['gray', 'Light Gray'],
  ['navy', 'Navy'],
  ['wood', 'Natural Wood'],
];
const COUNTER_FINISHES = [
  ['white', 'White Quartz'],
  ['gray', 'Gray'],
];

let uidSeq = 1;
function assignUids(design) {
  if (!design || !design.runs) return;
  for (const run of design.runs) {
    for (const item of run.items || []) {
      if (item._uid == null) item._uid = `u${uidSeq++}`;
    }
  }
}
/** Deep-copy a design minus internal _uid fields, for persistence. */
function cleanDesign(design) {
  return JSON.parse(JSON.stringify(design, (k, v) => (k === '_uid' ? undefined : v)));
}

const STYLES = `
.kdsn { display:flex; flex-direction:column; height:100%; min-height:0; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; color:#23272e; background:#f4f3f0; }
.kdsn-toolbar { display:flex; align-items:center; gap:8px; padding:8px 12px; background:#fff; border-bottom:1px solid #ddd8cf; flex-wrap:wrap; position:relative; z-index:5; }
.kdsn-title { font-weight:700; font-size:15px; margin-right:6px; }
.kdsn-toolbar button { padding:6px 12px; border:1px solid #cfc9bd; background:#fff; border-radius:6px; cursor:pointer; font-size:13px; }
.kdsn-toolbar button:hover { background:#f0ede6; }
.kdsn-toolbar button.primary { background:#1d4ed8; border-color:#1d4ed8; color:#fff; }
.kdsn-toolbar button.primary:hover { background:#1a44bd; }
.kdsn-toolbar button.active-view { background:#e2e8f7; border-color:#1d4ed8; color:#1d4ed8; }
.kdsn-toolbar select { padding:5px 6px; border:1px solid #cfc9bd; border-radius:6px; font-size:13px; }
.kdsn-toolbar label { font-size:12px; color:#555; display:flex; align-items:center; gap:4px; }
.kdsn-sep { width:1px; height:22px; background:#ddd8cf; }
.kdsn-dirty { font-size:12px; color:#b45309; font-weight:600; }
.kdsn-quote { margin-left:auto; font-size:13px; color:#1d4ed8; text-decoration:none; font-weight:600; }
.kdsn-pop { position:absolute; top:44px; left:12px; background:#fff; border:1px solid #ddd8cf; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,.15); padding:12px; display:flex; flex-direction:column; gap:8px; min-width:230px; z-index:20; }
.kdsn-pop[hidden] { display:none; }
.kdsn-pop label { font-size:12px; color:#555; display:flex; flex-direction:column; gap:4px; }
.kdsn-pop .row { display:flex; gap:8px; justify-content:flex-end; }
.kdsn-main { display:flex; flex:1; min-height:0; }
.kdsn-left { width:340px; min-width:280px; background:#fff; border-right:1px solid #ddd8cf; display:flex; flex-direction:column; overflow:auto; }
.kdsn-left svg { width:100%; height:auto; display:block; }
.kdsn-warnings { margin:8px; padding:8px 10px; background:#fffbeb; border:1px solid #f5d98b; border-radius:6px; font-size:12px; color:#7a5b12; }
.kdsn-warnings ul { margin:4px 0 0 16px; padding:0; }
.kdsn-center { flex:1; min-width:0; position:relative; background:#e3e1dc; }
.kdsn-center > div { position:absolute; inset:0; }
.kdsn-center canvas { display:block; width:100% !important; height:100% !important; }
.kdsn-right { width:300px; min-width:260px; background:#fff; border-left:1px solid #ddd8cf; overflow:auto; padding:12px; }
.kdsn-right h3 { margin:0 0 8px; font-size:14px; }
.kdsn-right h4 { margin:14px 0 8px; font-size:13px; color:#444; border-top:1px solid #eee; padding-top:10px; }
.kdsn-field { display:flex; flex-direction:column; gap:3px; margin-bottom:8px; font-size:12px; color:#555; }
.kdsn-field input, .kdsn-field select { padding:6px 8px; border:1px solid #cfc9bd; border-radius:6px; font-size:13px; color:#23272e; background:#fff; }
.kdsn-kv { display:flex; justify-content:space-between; font-size:13px; padding:3px 0; }
.kdsn-kv b { font-weight:600; }
.kdsn-btnrow { display:flex; gap:8px; margin-top:10px; }
.kdsn-btnrow button { flex:1; padding:8px; border-radius:6px; border:1px solid #cfc9bd; background:#fff; cursor:pointer; font-size:13px; }
.kdsn-btnrow button.danger { color:#b91c1c; border-color:#e5a3a3; }
.kdsn-btnrow button.danger:hover { background:#fef2f2; }
.kdsn-btnrow button.go { background:#1d4ed8; border-color:#1d4ed8; color:#fff; }
.kdsn-hint { font-size:12.5px; color:#777; line-height:1.5; }
.kdsn-toast { position:fixed; bottom:22px; left:50%; transform:translateX(-50%); background:#23272e; color:#fff; padding:10px 18px; border-radius:8px; font-size:13px; z-index:100; box-shadow:0 6px 20px rgba(0,0,0,.25); }
.kdsn-loading { padding:40px; font-size:14px; color:#777; }
.kdsn-error { padding:40px; color:#b91c1c; font-size:14px; }
`;

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function render(appEl, params) {
  // Router passes a URLSearchParams; accept a plain object too.
  const id = (params && typeof params.get === "function") ? params.get("id") : params?.id;
  // ---- state ----
  const state = {
    id,
    project: null,
    room: null,
    design: null,
    catalog: [],
    finishes: { door: 'white', counter: 'white' },
    selectedUid: null,
    dirty: false,
    warnings: [],
    scene: null,
    geos: [],
  };

  // ---- static layout ----
  const style = document.createElement('style');
  style.textContent = STYLES;
  appEl.appendChild(style);

  appEl.appendChild(el(`
    <div class="kdsn">
      <div class="kdsn-toolbar">
        <span class="kdsn-title" data-ref="name">Kitchen Designer</span>
        <button data-ref="auto">Auto-design</button>
        <span class="kdsn-sep"></span>
        <button data-view="perspective" class="active-view">Perspective</button>
        <button data-view="top">Top</button>
        <button data-view="front">Front</button>
        <span class="kdsn-sep"></span>
        <label>Doors <select data-ref="doorFinish">${DOOR_FINISHES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <label>Counter <select data-ref="counterFinish">${COUNTER_FINISHES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <span class="kdsn-sep"></span>
        <button data-ref="snap">Snapshot PNG</button>
        <button data-ref="save" class="primary">Save</button>
        <span data-ref="dirty" class="kdsn-dirty" hidden>● Unsaved changes</span>
        <a data-ref="quote" class="kdsn-quote" href="#/quote?id=">Quote →</a>
        <div class="kdsn-pop" data-ref="autopop" hidden>
          <label>Corner style
            <select data-ref="cornerStyle">
              <option value="easy">Easy-reach</option>
              <option value="blind">Blind corner</option>
              <option value="lazy">Lazy susan</option>
            </select>
          </label>
          <label>Wall cabinet height
            <select data-ref="wallH">
              <option value="30">30"</option>
              <option value="36">36"</option>
              <option value="42">42"</option>
            </select>
          </label>
          <div class="row">
            <button data-ref="autoCancel">Cancel</button>
            <button data-ref="autoRun" class="primary">Run</button>
          </div>
        </div>
      </div>
      <div class="kdsn-main">
        <div class="kdsn-left">
          <svg data-ref="plan" role="img" aria-label="2D floor plan"></svg>
          <div data-ref="warnings"></div>
        </div>
        <div class="kdsn-center"><div data-ref="view"></div></div>
        <div class="kdsn-right" data-ref="editor"></div>
      </div>
    </div>`));
  const toastEl = el(`<div class="kdsn-toast" hidden></div>`);
  appEl.appendChild(toastEl);

  const $ = (name) => appEl.querySelector(`[data-ref="${name}"]`);
  const refs = {
    name: $('name'), plan: $('plan'), view: $('view'), editor: $('editor'),
    warnings: $('warnings'), dirty: $('dirty'), quote: $('quote'),
    autopop: $('autopop'), cornerStyle: $('cornerStyle'), wallH: $('wallH'),
    doorFinish: $('doorFinish'), counterFinish: $('counterFinish'),
  };
  refs.quote.href = `#/quote?id=${encodeURIComponent(id)}`;

  let toastTimer = null;
  function toast(msg, ms = 2600) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  function markDirty() {
    state.dirty = true;
    refs.dirty.hidden = false;
  }
  function markClean() {
    state.dirty = false;
    refs.dirty.hidden = true;
  }

  // ---- selection ----
  function findItem(uid) {
    if (uid == null || !state.design?.runs) return null;
    for (const run of state.design.runs) {
      for (const item of run.items || []) {
        if (String(item._uid) === String(uid)) return { item, run };
      }
    }
    return null;
  }

  function selectItem(itemOrNull) {
    state.selectedUid = itemOrNull ? itemOrNull._uid : null;
    if (state.scene) state.scene.select(itemOrNull ? (it) => it === itemOrNull : null);
    drawPlan();
    renderEditor();
  }

  // ---- 2D ----
  function drawPlan() {
    const sel = state.selectedUid != null ? { _uid: state.selectedUid } : null;
    renderPlan(refs.plan, state.room, state.design, {
      selected: sel,
      onSelect: (item) => selectItem(item),
    });
  }

  function renderWarnings() {
    if (!state.warnings.length) { refs.warnings.innerHTML = ''; return; }
    refs.warnings.innerHTML = `
      <div class="kdsn-warnings"><b>Auto-design notes (${state.warnings.length})</b>
        <ul>${state.warnings.map(w => `<li>${String(w).replace(/</g, '&lt;')}</li>`).join('')}</ul>
      </div>`;
  }

  // ---- editor ----
  function catalogWidth(c) {
    if (c.width_in != null) return Number(c.width_in);
    return resolveItemDims({ sku: c.sku, category: c.category, level: levelFor(c) }, null).w;
  }

  // Catalog items carry category but no level (backend design items use
  // level base|wall|tall). Derive the level a catalog SKU belongs to.
  // Panels/fillers/accessories are level-agnostic trim: the engine assigns
  // their level contextually (e.g. WF330 in a base or a wall run).
  function levelFor(c) {
    const cat = c.category || '';
    if (cat === 'base' || cat === 'wall' || cat === 'tall') return cat;
    if (cat === 'appliance') return 'base';
    const sku = String(c.sku || '');
    if (/^(WEP|MWEP)/.test(sku)) return 'wall';
    if (/^(MTEP|REF)/.test(sku)) return 'tall';
    if (/^(BEP|MBEP|DWEP)/.test(sku)) return 'base';
    const h = Number(c.height_in) || 0;
    if (h >= 80) return 'tall';
    if (h === 36 || h === 42) return 'wall';
    return 'base';
  }

  function levelMatches(c, level) {
    const cat = c.category || '';
    if (cat === 'panel' || cat === 'filler' || cat === 'accessory') return true;
    return levelFor(c) === level;
  }

  function overlaps(run, ignoreUid, at, w) {
    for (const it of run.items || []) {
      if (String(it._uid) === String(ignoreUid)) continue;
      const ia = Number(it.at_in) || 0;
      const iw = Number(it.width_in) || 0;
      if (at < ia + iw - 0.01 && at + w > ia + 0.01) return it;
    }
    return null;
  }

  function renderEditor() {
    const ed = refs.editor;
    const found = findItem(state.selectedUid);
    let html = '';
    if (found) {
      const { item, run } = found;
      const dims = resolveItemDims(item, new Map(state.catalog.map(c => [String(c.sku), c])));
      const curW = Number(item.width_in) || dims.w;
      // Change-SKU options: same category (+ level for cabinets), width <= current, nearest first
      const opts = state.catalog
        .filter(c => c.category === item.category && levelMatches(c, item.level))
        .map(c => ({ c, w: catalogWidth(c) }))
        .filter(({ w }) => w > 0 && w <= curW + 0.01)
        .sort((a, b) => b.w - a.w || String(a.c.sku).localeCompare(String(b.c.sku)));
      html += `
        <h3>Selected cabinet</h3>
        <div class="kdsn-kv"><span>SKU</span><b>${String(item.sku).replace(/</g, '&lt;')}</b></div>
        <div class="kdsn-kv"><span>Category</span><b>${item.category || '—'}</b></div>
        <div class="kdsn-kv"><span>Level</span><b>${item.level || '—'}</b></div>
        <div class="kdsn-kv"><span>Wall</span><b>${String(run.wall_id).replace(/</g, '&lt;')}</b></div>
        <label class="kdsn-field">Position along wall (in)
          <input type="number" step="0.5" min="0" data-edit="at_in" value="${Number(item.at_in) || 0}">
        </label>
        <label class="kdsn-field">Width (in)
          <input type="number" step="0.5" min="1" data-edit="width_in" value="${curW}">
        </label>
        <label class="kdsn-field">Change SKU
          <select data-edit="sku">
            <option value="">— keep ${String(item.sku).replace(/</g, '&lt;')} —</option>
            ${opts.map(({ c, w }) => `<option value="${String(c.sku).replace(/"/g, '&quot;')}">${String(c.sku).replace(/</g, '&lt;')} — ${w}"</option>`).join('')}
          </select>
        </label>
        <div class="kdsn-btnrow"><button class="danger" data-act="delete">Delete cabinet</button></div>`;
      // wire edits
      ed.innerHTML = html + addCabinetHtml();
      ed.querySelector('[data-edit="at_in"]').addEventListener('change', (e) => {
        const v = Math.max(0, Number(e.target.value) || 0);
        item.at_in = Math.round(v * 2) / 2;
        afterEdit();
        const hit = overlaps(run, item._uid, item.at_in, Number(item.width_in) || 0);
        if (hit) toast(`Warning: overlaps ${hit.sku} — adjust position`);
      });
      ed.querySelector('[data-edit="width_in"]').addEventListener('change', (e) => {
        const v = Math.max(1, Number(e.target.value) || 1);
        item.width_in = Math.round(v * 2) / 2;
        afterEdit();
        const hit = overlaps(run, item._uid, Number(item.at_in) || 0, item.width_in);
        if (hit) toast(`Warning: overlaps ${hit.sku} — adjust width`);
      });
      ed.querySelector('[data-edit="sku"]').addEventListener('change', (e) => {
        if (!e.target.value) return;
        const c = state.catalog.find(x => String(x.sku) === e.target.value);
        if (!c) return;
        item.sku = c.sku;
        item.width_in = catalogWidth(c);
        afterEdit();
        toast(`Changed to ${c.sku}`);
      });
      ed.querySelector('[data-act="delete"]').addEventListener('click', () => {
        run.items = run.items.filter(it => it !== item);
        state.selectedUid = null;
        afterEdit();
        toast('Cabinet deleted');
      });
    } else {
      const count = (state.design?.runs || []).reduce((n, r) => n + (r.items || []).length, 0);
      ed.innerHTML = `
        <h3>Editor</h3>
        <p class="kdsn-hint">Click a cabinet in the 2D plan or the 3D view to select it, then edit position, size, or SKU here.</p>
        <p class="kdsn-hint">${count} item${count === 1 ? '' : 's'} in this design.</p>
        ${addCabinetHtml()}`;
    }
    wireAddCabinet(ed);
  }

  function addCabinetHtml() {
    const walls = state.geos.map(g => g.wall);
    return `
      <h4>Add cabinet</h4>
      <label class="kdsn-field">Category
        <select data-add="category">${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
      </label>
      <label class="kdsn-field">SKU <span data-add="widthNote" style="color:#888"></span>
        <select data-add="sku"></select>
      </label>
      <label class="kdsn-field">Wall
        <select data-add="wall">${walls.map(w => `<option value="${String(w.id).replace(/"/g, '&quot;')}">Wall ${String(w.id).replace(/</g, '&lt;')} (${Math.round(w.length_in)}")</option>`).join('')}</select>
      </label>
      <label class="kdsn-field">Position along wall (in)
        <input type="number" step="0.5" min="0" value="0" data-add="at">
      </label>
      <div class="kdsn-btnrow"><button class="go" data-add="go">Add to design</button></div>`;
  }

  function wireAddCabinet(ed) {
    const catSel = ed.querySelector('[data-add="category"]');
    const skuSel = ed.querySelector('[data-add="sku"]');
    const note = ed.querySelector('[data-add="widthNote"]');
    const wallSel = ed.querySelector('[data-add="wall"]');
    const atInput = ed.querySelector('[data-add="at"]');
    if (!catSel || !skuSel) return;
    const refreshSkus = () => {
      const list = state.catalog
        .filter(c => c.category === catSel.value)
        .map(c => ({ c, w: catalogWidth(c) }))
        .sort((a, b) => a.w - b.w);
      skuSel.innerHTML = list.length
        ? list.map(({ c, w }) => `<option value="${String(c.sku).replace(/"/g, '&quot;')}">${String(c.sku).replace(/</g, '&lt;')} — ${w}"</option>`).join('')
        : `<option value="">(no catalog items)</option>`;
      const first = list[0];
      note.textContent = first ? `· width ${first.w}" auto` : '';
    };
    catSel.addEventListener('change', refreshSkus);
    skuSel.addEventListener('change', () => {
      const c = state.catalog.find(x => String(x.sku) === skuSel.value);
      note.textContent = c ? `· width ${catalogWidth(c)}" auto` : '';
    });
    refreshSkus();
    ed.querySelector('[data-add="go"]').addEventListener('click', () => {
      const c = state.catalog.find(x => String(x.sku) === skuSel.value);
      if (!c) { toast('Pick a SKU first'); return; }
      const wallId = wallSel.value;
      const g = state.geos.find(x => String(x.wall.id) === String(wallId));
      if (!g) { toast('Pick a wall'); return; }
      const w = catalogWidth(c);
      const at = Math.max(0, Number(atInput.value) || 0);
      if (at + w > g.len + 0.01) { toast(`Doesn't fit: wall is ${Math.round(g.len)}", item ends at ${Math.round(at + w)}"`); return; }
      let run = state.design.runs.find(r => String(r.wall_id) === String(wallId));
      if (!run) { run = { wall_id: wallId, items: [] }; state.design.runs.push(run); }
      const hit = overlaps(run, null, at, w);
      if (hit) { toast(`Overlaps ${hit.sku} — pick another position`); return; }
      const item = { sku: c.sku, at_in: Math.round(at * 2) / 2, width_in: w, category: c.category, level: levelFor(c), _uid: `u${uidSeq++}` };
      run.items.push(item);
      run.items.sort((a, b) => (Number(a.at_in) || 0) - (Number(b.at_in) || 0));
      state.selectedUid = item._uid;
      afterEdit();
      toast(`Added ${c.sku}`);
    });
  }

  function afterEdit() {
    markDirty();
    if (state.scene) state.scene.updateDesign(state.design);
    if (state.selectedUid != null) {
      const f = findItem(state.selectedUid);
      if (state.scene) state.scene.select(f ? (it) => it === f.item : null);
    }
    drawPlan();
    renderEditor();
  }

  // ---- toolbar wiring ----
  appEl.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      appEl.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active-view'));
      btn.classList.add('active-view');
      if (state.scene) state.scene.focusView(btn.getAttribute('data-view'));
    });
  });

  refs.doorFinish.addEventListener('change', () => {
    state.finishes.door = refs.doorFinish.value;
    if (state.scene) state.scene.setFinishes(state.finishes);
    markDirty();
  });
  refs.counterFinish.addEventListener('change', () => {
    state.finishes.counter = refs.counterFinish.value;
    if (state.scene) state.scene.setFinishes(state.finishes);
    markDirty();
  });

  appEl.querySelector('[data-ref="snap"]').addEventListener('click', () => {
    if (!state.scene) return;
    const url = state.scene.snapshot();
    const a = document.createElement('a');
    a.href = url;
    a.download = `kitchen-${state.id || 'design'}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Snapshot downloaded');
  });

  appEl.querySelector('[data-ref="save"]').addEventListener('click', async () => {
    try {
      await saveDesign(state.id, cleanDesign(state.design || { runs: [], version: 1 }));
      markClean();
      toast('Design saved ✓');
    } catch (err) {
      console.error(err);
      toast('Save failed — see console');
    }
  });

  const autoBtn = appEl.querySelector('[data-ref="auto"]');
  autoBtn.addEventListener('click', () => { refs.autopop.hidden = !refs.autopop.hidden; });
  appEl.querySelector('[data-ref="autoCancel"]').addEventListener('click', () => { refs.autopop.hidden = true; });
  appEl.querySelector('[data-ref="autoRun"]').addEventListener('click', async () => {
    refs.autopop.hidden = true;
    autoBtn.disabled = true;
    try {
      const res = await autodesign(state.id, {
        corner_style: refs.cornerStyle.value,
        wall_cabinet_height: Number(refs.wallH.value),
      });
      const d = res && res.design ? res.design : res;
      state.warnings = (res && res.warnings) || [];
      state.design = d && d.runs ? d : { runs: [], version: 1 };
      assignUids(state.design);
      state.selectedUid = null;
      markDirty();
      if (state.scene) state.scene.updateDesign(state.design);
      drawPlan();
      renderEditor();
      renderWarnings();
      toast('Auto-design applied');
    } catch (err) {
      console.error(err);
      toast('Auto-design failed — see console');
    } finally {
      autoBtn.disabled = false;
    }
  });

  // ---- boot ----
  (async () => {
    refs.editor.innerHTML = `<p class="kdsn-loading">Loading project…</p>`;
    try {
      const project = await getProject(id);
      const catalogRes = await getCatalog(project.catalog_id);
      state.project = project || {};
      state.room = state.project.room || { walls: [], ceiling_in: 96, appliances: {} };
      state.design = state.project.design || null;
      state.catalog = (catalogRes && Array.isArray(catalogRes.items)) ? catalogRes.items : [];
      assignUids(state.design);
      state.geos = computeWallGeometry(state.room);
      refs.name.textContent = state.project.name || 'Kitchen Designer';

      state.scene = buildScene(refs.view, state.room, state.design, state.catalog, state.finishes);
      state.scene.onSelect = (item) => selectItem(item);

      drawPlan();
      renderEditor();
      renderWarnings();
    } catch (err) {
      console.error(err);
      appEl.querySelector('.kdsn-main').innerHTML =
        `<div class="kdsn-error">Couldn't load this project. ${String(err && err.message || err).replace(/</g, '&lt;')}</div>`;
    }
  })();

  // teardown helper for the router (if it calls it)
  return {
    dispose() {
      if (state.scene) state.scene.dispose();
      style.remove();
      toastEl.remove();
    },
  };
}

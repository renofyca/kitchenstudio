/* #/app — Projects dashboard + new project form. */

import { listCatalogs, listProjects, createProject, deleteProject } from "../api.js";
import { toast, esc, loadingBlock, emptyState, fmtDate, busyButton } from "../ui.js";

let wallSeq = 0;
let openingSeq = 0;

function wallId() { return `w${++wallSeq}`; }
function openingId() { return `o${++openingSeq}`; }

/* ---------- New-project form builders ---------- */

function openingRowHtml(oid) {
  return `
    <div class="opening-row" data-opening="${oid}">
      <div class="field">
        <label>Kind</label>
        <select data-f="kind">
          <option value="window">Window</option>
          <option value="door">Door</option>
          <option value="opening">Opening</option>
        </select>
      </div>
      <div class="field"><label>At (in)</label><input type="number" data-f="at_in" min="0" step="0.5" placeholder="0" /></div>
      <div class="field"><label>Width (in)</label><input type="number" data-f="width_in" min="0" step="0.5" placeholder="36" /></div>
      <div class="field"><label>Sill (in)</label><input type="number" data-f="sill_in" min="0" step="0.5" placeholder="36" /></div>
      <div class="field"><label>Height (in)</label><input type="number" data-f="height_in" min="0" step="0.5" placeholder="48" /></div>
      <button type="button" class="btn btn-ghost btn-sm" data-remove-opening title="Remove opening">✕</button>
    </div>`;
}

function wallBlockHtml(wid, letter) {
  return `
    <fieldset class="wall-block" data-wall="${wid}">
      <legend>Wall <span data-wall-letter>${esc(letter)}</span></legend>
      <div class="wall-head">
        <div class="field">
          <label>ID</label>
          <input type="text" data-f="wall_id" value="${esc(letter)}" maxlength="4" />
        </div>
        <div class="field">
          <label>Length (in) <span class="req">*</span></label>
          <input type="number" data-f="length_in" min="0" step="0.5" placeholder="120" />
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-remove-wall>Remove wall</button>
      </div>
      <div class="openings" data-openings></div>
      <div style="margin-top:8px">
        <button type="button" class="btn btn-ghost btn-sm" data-add-opening>+ Add opening (window / door)</button>
      </div>
    </fieldset>`;
}

function collectRoom(formEl) {
  const errors = [];
  const walls = [];
  const wallBlocks = [...formEl.querySelectorAll("[data-wall]")];

  wallBlocks.forEach((wb, i) => {
    const id = (wb.querySelector('[data-f="wall_id"]').value || "").trim() || String.fromCharCode(65 + i);
    const length_in = parseFloat(wb.querySelector('[data-f="length_in"]').value);
    if (!(length_in > 0)) errors.push(`Wall ${id}: length must be greater than 0.`);
    const openings = [];
    wb.querySelectorAll("[data-opening]").forEach((or) => {
      const kind = or.querySelector('[data-f="kind"]').value;
      const at_in = parseFloat(or.querySelector('[data-f="at_in"]').value) || 0;
      const width_in = parseFloat(or.querySelector('[data-f="width_in"]').value) || 0;
      const sill_in = parseFloat(or.querySelector('[data-f="sill_in"]').value) || 0;
      const height_in = parseFloat(or.querySelector('[data-f="height_in"]').value) || 0;
      openings.push({ at_in, width_in, kind, sill_in, height_in });
    });
    walls.push({ id, length_in: length_in || 0, openings });
  });

  if (walls.length === 0) errors.push("Add at least one wall.");

  const ceiling_in = parseFloat(formEl.querySelector('[name="ceiling_in"]').value) || 96;
  const range_in = parseFloat(formEl.querySelector('[name="range_in"]').value) || 30;
  const fridge_in = parseFloat(formEl.querySelector('[name="fridge_in"]').value) || 36;
  const has_dishwasher = formEl.querySelector('[name="has_dishwasher"]').checked;
  const has_microwave = formEl.querySelector('[name="has_microwave"]').checked;

  return {
    room: { walls, ceiling_in, appliances: { range_in, fridge_in, has_dishwasher, has_microwave } },
    errors,
  };
}

/* ---------- Render ---------- */

export async function render(appEl) {
  appEl.innerHTML = `
    <div class="page"><div class="container">
      <div class="page-head">
        <div>
          <h1>Projects</h1>
          <p class="sub">Design a kitchen, price it, and send the quote.</p>
        </div>
        <div class="actions">
          <button class="btn btn-primary" id="new-project-btn" type="button">+ New project</button>
        </div>
      </div>

      <div class="card" id="new-project-card" hidden style="margin-bottom:24px">
        <h3 style="margin-top:0">New project</h3>
        <form class="form" id="new-project-form" novalidate>
          <div class="form-error" id="np-errors" hidden></div>
          <div class="form-row">
            <div class="field" style="flex:2 1 220px">
              <label for="np-name">Project name <span class="req">*</span></label>
              <input type="text" id="np-name" name="name" placeholder="Smith residence — kitchen" />
            </div>
            <div class="field" style="flex:1 1 200px">
              <label for="np-catalog">Catalog <span class="req">*</span></label>
              <select id="np-catalog" name="catalog_id"><option value="">Loading…</option></select>
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label for="np-ceiling">Ceiling height (in)</label>
              <input type="number" id="np-ceiling" name="ceiling_in" value="96" min="0" step="0.5" />
            </div>
            <div class="field">
              <label for="np-range">Range width (in)</label>
              <input type="number" id="np-range" name="range_in" value="30" min="0" step="0.5" />
            </div>
            <div class="field">
              <label for="np-fridge">Fridge width (in)</label>
              <input type="number" id="np-fridge" name="fridge_in" value="36" min="0" step="0.5" />
            </div>
          </div>
          <div class="form-row">
            <label class="check-row"><input type="checkbox" name="has_dishwasher" checked /> Dishwasher</label>
            <label class="check-row"><input type="checkbox" name="has_microwave" /> Microwave / hood combo</label>
          </div>
          <div>
            <h4 style="margin-bottom:8px">Walls</h4>
            <div class="grid" id="walls-list" style="gap:12px"></div>
            <button type="button" class="btn btn-ghost btn-sm" id="add-wall" style="margin-top:12px">+ Add wall</button>
            <p class="hint" style="font-size:0.8rem;color:var(--text-faint)">Measure each wall in inches. Openings are measured <em>from the left end</em> of the wall.</p>
          </div>
          <div class="form-row">
            <button class="btn btn-primary" type="submit" id="np-submit">Create &amp; open designer</button>
            <button class="btn btn-ghost" type="button" id="np-cancel">Cancel</button>
          </div>
        </form>
      </div>

      <div id="projects-list">${loadingBlock("Loading projects…")}</div>
    </div></div>
  `;

  const card = appEl.querySelector("#new-project-card");
  const form = appEl.querySelector("#new-project-form");
  const wallsList = appEl.querySelector("#walls-list");
  const errBox = appEl.querySelector("#np-errors");

  /* --- wall management --- */
  const nextLetter = () => String.fromCharCode(65 + wallsList.querySelectorAll("[data-wall]").length);

  const addWall = () => {
    const wid = wallId();
    const tmp = document.createElement("div");
    tmp.innerHTML = wallBlockHtml(wid, nextLetter());
    wallsList.appendChild(tmp.firstElementChild);
  };

  wallsList.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-add-opening]");
    const remWall = e.target.closest("[data-remove-wall]");
    const remOpening = e.target.closest("[data-remove-opening]");
    if (addBtn) {
      const box = addBtn.closest("[data-wall]").querySelector("[data-openings]");
      const tmp = document.createElement("div");
      tmp.innerHTML = openingRowHtml(openingId());
      box.appendChild(tmp.firstElementChild);
    } else if (remWall) {
      remWall.closest("[data-wall]").remove();
      // Re-letter remaining walls for clarity
      wallsList.querySelectorAll("[data-wall]").forEach((wb, i) => {
        wb.querySelector("[data-wall-letter]").textContent = String.fromCharCode(65 + i);
      });
    } else if (remOpening) {
      remOpening.closest("[data-opening]").remove();
    }
  });

  appEl.querySelector("#add-wall").addEventListener("click", addWall);
  appEl.querySelector("#new-project-btn").addEventListener("click", () => {
    card.hidden = !card.hidden;
    if (!card.hidden) card.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  appEl.querySelector("#np-cancel").addEventListener("click", () => { card.hidden = true; });

  addWall(); // start with one wall row

  /* --- catalog select --- */
  try {
    const catalogs = await listCatalogs();
    const sel = appEl.querySelector("#np-catalog");
    if (!catalogs.length) {
      sel.innerHTML = `<option value="">No catalogs yet — upload one first</option>`;
    } else {
      sel.innerHTML = catalogs
        .map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${c.item_count} items)</option>`)
        .join("");
    }
  } catch (err) {
    appEl.querySelector("#np-catalog").innerHTML = `<option value="">Couldn't load catalogs</option>`;
    toast("Could not load catalogs: " + err.message, "error");
  }

  /* --- submit --- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const name = form.querySelector('[name="name"]').value.trim();
    const catalog_id = parseInt(form.querySelector('[name="catalog_id"]').value, 10);
    const { room, errors } = collectRoom(form);

    const all = [];
    if (!name) all.push("Project name is required.");
    if (!catalog_id) all.push("Choose a catalog (upload one under Catalogs first).");
    all.push(...errors);
    if (all.length) {
      errBox.innerHTML = `<ul style="margin:0;padding-left:1.2em">${all.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`;
      errBox.hidden = false;
      errBox.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const submitBtn = appEl.querySelector("#np-submit");
    const restore = busyButton(submitBtn, "Creating…");
    try {
      const { id } = await createProject({ name, catalog_id, room });
      toast("Project created.", "success");
      location.hash = `#/design?id=${encodeURIComponent(id)}`;
    } catch (err) {
      errBox.textContent = err.message || "Could not create the project.";
      errBox.hidden = false;
      restore();
    }
  });

  /* --- project list --- */
  const listEl = appEl.querySelector("#projects-list");
  const loadProjects = async () => {
    listEl.innerHTML = loadingBlock("Loading projects…");
    let projects;
    try {
      projects = await listProjects();
    } catch (err) {
      listEl.innerHTML = `<div class="form-error" role="alert">Could not load projects: ${esc(err.message)}</div>`;
      return;
    }
    if (!projects.length) {
      listEl.innerHTML = emptyState({
        art: "🏠",
        title: "No projects yet",
        text: "Create your first project — measure a room and let KitchenStudio draft the design.",
        ctaHtml: `<button class="btn btn-primary" id="empty-new" type="button">+ New project</button>`,
      });
      listEl.querySelector("#empty-new").addEventListener("click", () => {
        card.hidden = false;
        card.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return;
    }
    listEl.innerHTML = `
      <div class="grid grid-auto">
        ${projects.map((p) => `
          <div class="card hoverable project-card">
            <h3 class="p-name">${esc(p.name)}</h3>
            <div class="p-meta">
              <span class="badge badge-teal">${esc(p.catalog_name || p.catalog_id || "catalog")}</span>
              <span>Updated ${esc(fmtDate(p.updated))}</span>
            </div>
            <div class="p-actions">
              <a class="btn btn-primary btn-sm" href="#/design?id=${encodeURIComponent(p.id)}">Open</a>
              <a class="btn btn-ghost btn-sm" href="#/quote?id=${encodeURIComponent(p.id)}">Quote</a>
              <button class="btn btn-danger btn-sm" data-delete="${esc(p.id)}" type="button">Delete</button>
            </div>
          </div>`).join("")}
      </div>`;

    listEl.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.delete;
        const name = btn.closest(".project-card").querySelector(".p-name").textContent;
        if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;
        btn.disabled = true;
        try {
          await deleteProject(id);
          toast("Project deleted.", "success");
          loadProjects();
        } catch (err) {
          toast("Delete failed: " + err.message, "error");
          btn.disabled = false;
        }
      });
    });
  };
  await loadProjects();
}

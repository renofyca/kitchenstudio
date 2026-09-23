/* #/catalogs — Manage supplier catalogs: list, upload CSV, view items. */

import { listCatalogs, uploadCatalog, getCatalog, deleteCatalog } from "../api.js";
import { toast, esc, loadingBlock, emptyState, fmtDate, fmtMoney, busyButton } from "../ui.js";

const ALLOWED_CATEGORIES = ["base", "wall", "tall", "panel", "filler", "appliance", "accessory"];
const CSV_COLUMNS = "sku,category,description,width_in,height_in,depth_in,price,notes";

export async function render(appEl) {
  appEl.innerHTML = `
    <div class="page"><div class="container">
      <div class="page-head">
        <div>
          <h1>Catalogs</h1>
          <p class="sub">Your suppliers' price lists — every design prices itself from these.</p>
        </div>
      </div>

      <div class="card" style="margin-bottom:24px">
        <h3 style="margin-top:0">Upload a catalog</h3>
        <form class="form" id="upload-form" novalidate>
          <div class="form-error" id="up-errors" hidden></div>
          <div class="form-row">
            <div class="field" style="flex:1 1 220px">
              <label for="up-name">Catalog name <span class="req">*</span></label>
              <input type="text" id="up-name" name="name" placeholder="Acme Cabinets — 2026 price list" />
            </div>
            <div class="field" style="flex:1 1 220px">
              <label for="up-file">CSV file <span class="req">*</span></label>
              <input type="file" id="up-file" name="file" accept=".csv,text/csv" />
            </div>
          </div>
          <div>
            <button class="btn btn-primary" type="submit" id="up-submit">Upload catalog</button>
          </div>
          <div id="bad-rows-wrap"></div>
        </form>
        <div class="panel help-block" style="margin-top:16px">
          <strong>CSV template</strong> — one row per item, with exactly these columns:
          <br /><code>${esc(CSV_COLUMNS)}</code>
          <ul>
            <li><code>sku</code> — unique item code (required).</li>
            <li><code>category</code> — one of: ${ALLOWED_CATEGORIES.map((c) => `<code>${c}</code>`).join(", ")}.</li>
            <li><code>description</code> — display name, e.g. "Base cabinet, 2 doors".</li>
            <li><code>width_in</code>, <code>height_in</code>, <code>depth_in</code> — dimensions in inches.</li>
            <li><code>price</code> — unit price (numbers only). Leave blank if unknown — the quote will flag it.</li>
            <li><code>notes</code> — optional free text.</li>
          </ul>
          The first row must be the header row shown above.
        </div>
      </div>

      <div id="catalogs-list">${loadingBlock("Loading catalogs…")}</div>
    </div></div>
  `;

  const listEl = appEl.querySelector("#catalogs-list");

  const loadCatalogs = async () => {
    listEl.innerHTML = loadingBlock("Loading catalogs…");
    let catalogs;
    try {
      catalogs = await listCatalogs();
    } catch (err) {
      listEl.innerHTML = `<div class="form-error" role="alert">Could not load catalogs: ${esc(err.message)}</div>`;
      return;
    }
    if (!catalogs.length) {
      listEl.innerHTML = emptyState({
        art: "📚",
        title: "No catalogs yet",
        text: "Upload your first supplier price list above to start pricing designs.",
      });
      return;
    }
    listEl.innerHTML = `
      <div class="grid" style="gap:12px">
        ${catalogs.map((c) => `
          <div class="card" data-catalog="${esc(c.id)}">
            <div class="catalog-row">
              <div class="c-main">
                <p class="c-name">${esc(c.name)}</p>
                <p class="c-meta">${c.item_count} item${c.item_count === 1 ? "" : "s"} · added ${esc(fmtDate(c.created))}</p>
              </div>
              <button class="btn btn-ghost btn-sm" data-view="${esc(c.id)}" type="button">View items</button>
              <button class="btn btn-danger btn-sm" data-del="${esc(c.id)}" type="button">Delete</button>
            </div>
            <div class="catalog-items" data-items hidden></div>
          </div>`).join("")}
      </div>`;

    /* View items (expandable, client-side search) */
    listEl.querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.view;
        const cardEl = listEl.querySelector(`[data-catalog="${CSS.escape(id)}"]`);
        const itemsEl = cardEl.querySelector("[data-items]");
        const expanded = !itemsEl.hidden;
        if (expanded) {
          itemsEl.hidden = true;
          btn.textContent = "View items";
          return;
        }
        btn.disabled = true;
        itemsEl.hidden = false;
        itemsEl.innerHTML = loadingBlock("Loading items…");
        try {
          const full = await getCatalog(id);
          renderItems(itemsEl, full.items || []);
          btn.textContent = "Hide items";
        } catch (err) {
          itemsEl.innerHTML = `<div class="form-error" role="alert">Could not load items: ${esc(err.message)}</div>`;
        } finally {
          btn.disabled = false;
        }
      });
    });

    /* Delete */
    listEl.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.del;
        const cardEl = listEl.querySelector(`[data-catalog="${CSS.escape(id)}"]`);
        const name = cardEl.querySelector(".c-name").textContent;
        if (!confirm(`Delete catalog "${name}"? Projects using it will keep their saved designs but can't re-price.`)) return;
        btn.disabled = true;
        try {
          await deleteCatalog(id);
          toast("Catalog deleted.", "success");
          loadCatalogs();
        } catch (err) {
          toast("Delete failed: " + err.message, "error");
          btn.disabled = false;
        }
      });
    });
  };

  const renderItems = (itemsEl, items) => {
    const catBadge = (cat) => {
      const map = { base: "badge-teal", wall: "badge-amber", tall: "badge-green", appliance: "badge-red", accessory: "badge-grey", panel: "badge-grey", filler: "badge-grey" };
      return `<span class="badge ${map[cat] || "badge-grey"}">${esc(cat)}</span>`;
    };
    itemsEl.innerHTML = `
      <div class="search-row">
        <input type="text" data-search placeholder="Filter by SKU or description…" aria-label="Filter items" />
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr><th>SKU</th><th>Category</th><th>Description</th><th class="num">Size (W×H×D in)</th><th class="num">Price</th><th>Notes</th></tr>
          </thead>
          <tbody data-tbody></tbody>
        </table>
      </div>`;
    const tbody = itemsEl.querySelector("[data-tbody]");
    const draw = (q) => {
      const needle = (q || "").trim().toLowerCase();
      const rows = items.filter((it) =>
        !needle ||
        String(it.sku).toLowerCase().includes(needle) ||
        String(it.description || "").toLowerCase().includes(needle));
      tbody.innerHTML = rows.length ? rows.map((it) => `
        <tr>
          <td class="mono"><strong>${esc(it.sku)}</strong></td>
          <td>${catBadge(it.category)}</td>
          <td>${esc(it.description || "—")}</td>
          <td class="num">${esc(it.width_in ?? "—")}×${esc(it.height_in ?? "—")}×${esc(it.depth_in ?? "—")}</td>
          <td class="num">${it.price === null || it.price === undefined || it.price === "" ? '<span class="price-missing">—</span>' : esc(fmtMoney(it.price))}</td>
          <td>${esc(it.notes || "—")}</td>
        </tr>`).join("")
        : `<tr><td colspan="6" style="text-align:center;color:var(--text-soft)">No items match.</td></tr>`;
    };
    draw("");
    itemsEl.querySelector("[data-search]").addEventListener("input", (e) => draw(e.target.value));
  };

  /* Upload */
  const form = appEl.querySelector("#upload-form");
  const errBox = appEl.querySelector("#up-errors");
  const badRowsWrap = appEl.querySelector("#bad-rows-wrap");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    errBox.textContent = "";
    badRowsWrap.innerHTML = "";

    const name = form.querySelector('[name="name"]').value.trim();
    const file = form.querySelector('[name="file"]').files[0];
    if (!name) { errBox.textContent = "Give the catalog a name."; errBox.hidden = false; return; }
    if (!file) { errBox.textContent = "Choose a CSV file to upload."; errBox.hidden = false; return; }

    const submitBtn = appEl.querySelector("#up-submit");
    const restore = busyButton(submitBtn, "Uploading…");
    try {
      const { id, item_count } = await uploadCatalog(file, name);
      toast(`Catalog uploaded — ${item_count} item${item_count === 1 ? "" : "s"} imported.`, "success");
      form.reset();
      loadCatalogs();
    } catch (err) {
      restore();
      if (err.bad_rows && err.bad_rows.length) {
        errBox.textContent = err.message || "Some rows could not be imported.";
        errBox.hidden = false;
        badRowsWrap.innerHTML = `
          <h4 style="margin:16px 0 8px">Rows that need attention</h4>
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th class="num">Row</th><th>SKU</th><th>Reason</th></tr></thead>
              <tbody>
                ${err.bad_rows.map((r) => `
                  <tr>
                    <td class="num mono">${esc(r.row)}</td>
                    <td class="mono">${esc(r.sku || "—")}</td>
                    <td>${esc(r.reason)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
          <p class="hint" style="font-size:0.83rem;color:var(--text-soft);margin-top:8px">
            Fix these rows in your CSV and upload again.
          </p>`;
      } else {
        errBox.textContent = err.message || "Upload failed. Please try again.";
        errBox.hidden = false;
      }
    }
  });

  await loadCatalogs();
}

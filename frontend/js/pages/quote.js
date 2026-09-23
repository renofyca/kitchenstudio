/* #/quote?id= — Client quote: priced line items, printable. */

import { getProject, getQuote } from "../api.js";
import { toast, esc, loadingBlock, fmtDate, fmtMoney } from "../ui.js";

export async function render(appEl, params) {
  const id = params.get("id");

  if (!id) {
    appEl.innerHTML = `
      <div class="page"><div class="container">
        <div class="empty-state">
          <div class="art" aria-hidden="true">🧾</div>
          <h3>No project selected</h3>
          <p>Pick a project to view its quote.</p>
          <p><a class="btn btn-primary" href="#/app">Go to projects</a></p>
        </div>
      </div></div>`;
    return;
  }

  appEl.innerHTML = `
    <div class="page"><div class="container" id="quote-root">
      ${loadingBlock("Building quote…")}
    </div></div>`;

  const root = appEl.querySelector("#quote-root");

  let project, quote;
  try {
    [project, quote] = await Promise.all([getProject(id), getQuote(id)]);
  } catch (err) {
    root.innerHTML = `
      <div class="form-error" role="alert">Could not load the quote: ${esc(err.message)}</div>
      <p class="back-link-row" style="margin-top:16px"><a class="btn btn-ghost" href="#/app">← Back to projects</a></p>`;
    return;
  }

  const lines = quote.lines || [];
  const missing = lines.filter((l) => l.unit_price === null || l.unit_price === undefined || l.unit_price === "");

  root.innerHTML = `
    <p class="back-link-row"><a href="#/design?id=${encodeURIComponent(id)}">← Back to designer</a></p>

    <div class="quote-head">
      <div>
        <h1>Quote — ${esc(project.name)}</h1>
        <p class="q-meta">
          Prepared ${esc(fmtDate(new Date().toISOString()))}
          ${quote.catalog_name ? ` · Priced from <strong>${esc(quote.catalog_name)}</strong>` : ""}
        </p>
        ${missing.length ? `
          <p><span class="badge badge-amber">⚠ ${missing.length} line${missing.length === 1 ? "" : "s"} missing a price</span></p>
          <p class="hint" style="font-size:0.85rem;color:var(--text-soft)">
            Some items have no price in the catalog. Confirm pricing with the supplier before sending this to the client.
          </p>` : `
          <p><span class="badge badge-green">✓ All items priced</span></p>`}
      </div>
      <div class="quote-total">
        <div class="label">Subtotal</div>
        <div class="amount">${esc(fmtMoney(quote.subtotal))}</div>
        ${missing.length ? `<div class="price-missing" style="font-size:0.8rem">excludes unpriced items</div>` : ""}
      </div>
    </div>

    <div class="quote-actions">
      <button class="btn btn-primary" id="print-btn" type="button">🖨 Print quote</button>
      <a class="btn btn-ghost" href="#/design?id=${encodeURIComponent(id)}">Back to designer</a>
    </div>

    ${lines.length ? `
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Description</th>
              <th>Size</th>
              <th class="num">Qty</th>
              <th class="num">Unit price</th>
              <th class="num">Line total</th>
            </tr>
          </thead>
          <tbody>
            ${lines.map((l) => {
              const unpriced = l.unit_price === null || l.unit_price === undefined || l.unit_price === "";
              return `
                <tr>
                  <td class="mono"><strong>${esc(l.sku)}</strong></td>
                  <td>${esc(l.description || "—")}</td>
                  <td>${esc(l.size || "—")}</td>
                  <td class="num">${esc(l.qty)}</td>
                  <td class="num">${unpriced ? '<span class="price-missing">price missing</span>' : esc(fmtMoney(l.unit_price))}</td>
                  <td class="num"><strong>${unpriced ? "—" : esc(fmtMoney(l.line_total))}</strong></td>
                </tr>`;
            }).join("")}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="5" style="text-align:right;font-weight:700">Subtotal</td>
              <td class="num" style="font-weight:800;font-size:1.05rem">${esc(fmtMoney(quote.subtotal))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="hint" style="font-size:0.83rem;color:var(--text-faint);margin-top:12px">
        Prices are from the catalog at the time the quote was generated and exclude tax, delivery and installation unless noted.
      </p>
    ` : `
      <div class="empty-state">
        <div class="art" aria-hidden="true">🧾</div>
        <h3>No line items yet</h3>
        <p>This project doesn't have a design to quote. Open the designer and generate a layout first.</p>
        <p><a class="btn btn-primary" href="#/design?id=${encodeURIComponent(id)}">Open designer</a></p>
      </div>`}
  `;

  root.querySelector("#print-btn")?.addEventListener("click", () => window.print());
}

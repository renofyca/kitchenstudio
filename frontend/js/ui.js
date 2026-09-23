/* Small shared UI helpers: toasts, escaping, loading/empty states. */

const toastStack = () => document.getElementById("toasts");

/** Show a transient toast. kind: "info" | "success" | "error". */
export function toast(message, kind = "info", ms = 4200) {
  const stack = toastStack();
  if (!stack) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  const icon = kind === "success" ? "✓" : kind === "error" ? "⚠" : "ℹ";
  el.innerHTML = `<span aria-hidden="true">${icon}</span><span></span>`;
  el.querySelector("span:last-child").textContent = message;
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  close.addEventListener("click", () => el.remove());
  el.appendChild(close);
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.25s ease";
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/** Escape a string for safe interpolation into HTML template strings. */
export function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function loadingBlock(message = "Loading…") {
  return `<div class="loading-block"><div class="page-spinner" role="status" aria-label="${esc(message)}"></div><p>${esc(message)}</p></div>`;
}

export function emptyState({ art = "📦", title, text, ctaHtml = "" }) {
  return `
    <div class="empty-state">
      <div class="art" aria-hidden="true">${art}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      ${ctaHtml}
    </div>`;
}

/** Format an ISO timestamp into a short local date/time string. */
export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/** Turn a button into a loading state; returns a restore function. */
export function busyButton(btn, label = "Working…") {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${esc(label)}`;
  return () => { btn.disabled = false; btn.innerHTML = original; };
}

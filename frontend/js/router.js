/* KitchenStudio hash router.
   Routes: #/ home · #/login · #/signup · #/app dashboard ·
           #/catalogs · #/quote?id= · #/design?id= (owned by another worker)
   Auth-gated routes redirect to #/login when no token is present. */

import { getToken, getMe, logout } from "./api.js";
import { toast, loadingBlock } from "./ui.js";

const appEl = document.getElementById("app");
const navEl = document.getElementById("topnav");
const navEmailEl = document.getElementById("nav-email");
const navLogoutBtn = document.getElementById("nav-logout");

const AUTH_REQUIRED = new Set(["app", "catalogs", "quote", "design"]);

/** Parse the current location.hash into { route, params: URLSearchParams }. */
function parseHash() {
  const raw = (location.hash || "#/").slice(1); // drop leading "#"
  const [path, query = ""] = raw.split("?");
  const route = path.replace(/^\/+|\/+$/g, "") || "home";
  return { route, params: new URLSearchParams(query) };
}

/* Route table: route name -> module path (lazy) */
const ROUTES = {
  home: "./pages/home.js",
  login: "./pages/login.js",
  signup: "./pages/signup.js",
  app: "./pages/dashboard.js",
  catalogs: "./pages/catalogs.js",
  quote: "./pages/quote.js",
};

function syncNav(route) {
  const authed = !!getToken();
  navEl.hidden = !authed;
  if (!authed) return;
  const me = getMe();
  navEmailEl.textContent = me?.email || "";
  document.querySelectorAll(".nav-links a").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === route);
  });
}

navLogoutBtn.addEventListener("click", async () => {
  try { await logout(); } catch { /* session is cleared regardless */ }
  toast("Signed out.", "info");
  location.hash = "#/";
});

async function renderRoute() {
  const { route, params } = parseHash();

  // Auth guard
  if (AUTH_REQUIRED.has(route) && !getToken()) {
    if (route !== "login") toast("Please sign in to continue.", "info");
    location.hash = "#/login";
    return;
  }
  // Already-signed-in users don't need auth pages
  if ((route === "login" || route === "signup") && getToken()) {
    location.hash = "#/app";
    return;
  }

  syncNav(route);
  window.scrollTo(0, 0);
  appEl.innerHTML = loadingBlock("Loading…");

  try {
    if (route === "design") {
      // Owned by the designer worker — loaded on demand.
      try {
        const m = await import("./pages/design.js");
        await m.render(appEl, params);
      } catch (e) {
        console.warn("designer module not available yet:", e);
        appEl.innerHTML = `
          <div class="page"><div class="container">
            ${`<div class="empty-state">
              <div class="art" aria-hidden="true">🧰</div>
              <h3>Designer is loading</h3>
              <p>The 3D designer is being prepared. Please check back shortly.</p>
              <p><a class="btn btn-ghost btn-sm" href="#/app">← Back to projects</a></p>
            </div>`}
          </div></div>`;
      }
      return;
    }

    const modPath = ROUTES[route];
    if (!modPath) {
      appEl.innerHTML = `
        <div class="page"><div class="container">
          <div class="empty-state">
            <div class="art" aria-hidden="true">🧭</div>
            <h3>Page not found</h3>
            <p>That link doesn't point anywhere in KitchenStudio.</p>
            <p><a class="btn btn-primary" href="#/">Go home</a></p>
          </div>
        </div></div>`;
      return;
    }

    const m = await import(modPath);
    await m.render(appEl, params);
  } catch (err) {
    console.error("route render failed:", err);
    appEl.innerHTML = `
      <div class="page"><div class="container">
        <div class="form-error" role="alert">
          Something went wrong loading this page: ${String(err?.message || err)}
        </div>
        <p style="margin-top:16px"><a class="btn btn-ghost" href="#/app">Back to projects</a></p>
      </div></div>`;
  }
}

window.addEventListener("hashchange", renderRoute);
renderRoute();

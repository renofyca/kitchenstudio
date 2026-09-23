/* KitchenStudio API client — fetch wrapper against /api.
   Token + user are stored in localStorage under "ks_token" / "ks_user".
   All non-2xx responses throw an Error carrying the server's message,
   with `err.bad_rows` surfaced for CSV upload validation failures. */

const BASE = "/api";
const TOKEN_KEY = "ks_token";
const USER_KEY = "ks_user";

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

/** The signed-in user (from localStorage) or null. */
export function getMe() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function authHeaders(extra = {}) {
  const h = { ...extra };
  const t = getToken();
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

/**
 * Low-level request. `body` may be an object (sent as JSON) or FormData.
 * Throws Error with the server's message on non-2xx; attaches `bad_rows`
 * and `status` to the error when present.
 */
export async function request(path, { method = "GET", body = undefined, form = undefined } = {}) {
  const headers = authHeaders();
  const opts = { method, headers };

  if (form) {
    opts.body = form; // FormData: browser sets multipart boundary
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(BASE + path, opts);
  } catch (e) {
    const err = new Error("Could not reach the KitchenStudio server. Check your connection and try again.");
    err.status = 0;
    throw err;
  }

  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try { data = await res.json(); } catch { data = null; }
  } else if (res.status !== 204) {
    data = await res.text().catch(() => null);
  }

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && data.error) ||
      (typeof data === "string" && data) ||
      `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    if (data && typeof data === "object" && Array.isArray(data.bad_rows)) {
      err.bad_rows = data.bad_rows;
    }
    throw err;
  }
  return data;
}

/* ---------------- Auth ---------------- */

export async function signup({ email, password, name }) {
  const data = await request("/auth/signup", { method: "POST", body: { email, password, name } });
  setSession(data.token, data.user);
  return data;
}

export async function login({ email, password }) {
  const data = await request("/auth/login", { method: "POST", body: { email, password } });
  setSession(data.token, data.user);
  return data;
}

export async function logout() {
  try { await request("/auth/logout", { method: "POST" }); }
  finally { clearSession(); }
}

/* ---------------- Catalogs ---------------- */

export function listCatalogs() {
  return request("/catalogs");
}

/** Upload a CSV catalog. `file` is a File/Blob. Throws with err.bad_rows on 400. */
export function uploadCatalog(file, name) {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  return request("/catalogs", { method: "POST", form });
}

export function getCatalog(id) {
  return request(`/catalogs/${encodeURIComponent(id)}`);
}

export function deleteCatalog(id) {
  return request(`/catalogs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ---------------- Projects ---------------- */

export function listProjects() {
  return request("/projects");
}

export function createProject({ name, catalog_id, room }) {
  return request("/projects", { method: "POST", body: { name, catalog_id, room } });
}

export function getProject(id) {
  return request(`/projects/${encodeURIComponent(id)}`);
}

export function updateProject(id, patch) {
  return request(`/projects/${encodeURIComponent(id)}`, { method: "PUT", body: patch });
}

export function deleteProject(id) {
  return request(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function autodesign(id, opts = {}) {
  return request(`/projects/${encodeURIComponent(id)}/autodesign`, { method: "POST", body: opts });
}

export function saveDesign(id, design) {
  return request(`/projects/${encodeURIComponent(id)}/design`, { method: "PUT", body: { design } });
}

export function getQuote(id) {
  return request(`/projects/${encodeURIComponent(id)}/quote`);
}

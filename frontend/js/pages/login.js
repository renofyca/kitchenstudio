/* #/login — Sign in. */

import { login } from "../api.js";
import { toast, busyButton } from "../ui.js";

export async function render(appEl) {
  appEl.innerHTML = `
    <div class="auth-wrap">
      <div class="card auth-card">
        <div class="brand-row"><span class="brand-mark" aria-hidden="true">▦</span> KitchenStudio</div>
        <h1>Welcome back</h1>
        <p class="lede">Sign in to your KitchenStudio workspace.</p>
        <form class="form" id="login-form" novalidate>
          <div class="form-error" id="form-error" hidden></div>
          <div class="field">
            <label for="email">Email <span class="req">*</span></label>
            <input type="email" id="email" name="email" autocomplete="email" required />
            <span class="field-error" id="err-email" hidden></span>
          </div>
          <div class="field">
            <label for="password">Password <span class="req">*</span></label>
            <input type="password" id="password" name="password" autocomplete="current-password" required />
            <span class="field-error" id="err-password" hidden></span>
          </div>
          <button class="btn btn-primary" type="submit" id="submit-btn">Sign in</button>
        </form>
        <p class="auth-alt">New to KitchenStudio? <a href="#/signup">Create an account</a></p>
      </div>
    </div>
  `;

  const form = appEl.querySelector("#login-form");
  const errBox = appEl.querySelector("#form-error");
  const submitBtn = appEl.querySelector("#submit-btn");

  const setFieldError = (id, msg) => {
    const input = appEl.querySelector(`#${id}`);
    const err = appEl.querySelector(`#err-${id}`);
    if (msg) { input.classList.add("invalid"); err.textContent = msg; err.hidden = false; }
    else { input.classList.remove("invalid"); err.hidden = true; }
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const email = form.querySelector('[name="email"]').value.trim();
    const password = form.querySelector('[name="password"]').value;

    let ok = true;
    if (!email) { setFieldError("email", "Email is required."); ok = false; }
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setFieldError("email", "Enter a valid email address."); ok = false; }
    else setFieldError("email", "");
    if (!password) { setFieldError("password", "Password is required."); ok = false; }
    else setFieldError("password", "");
    if (!ok) return;

    const restore = busyButton(submitBtn, "Signing in…");
    try {
      await login({ email, password });
      toast("Signed in. Welcome back!", "success");
      location.hash = "#/app";
    } catch (err) {
      errBox.textContent = err.message || "Sign-in failed. Please try again.";
      errBox.hidden = false;
      restore();
    }
  });
}

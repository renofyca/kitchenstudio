/* #/signup — Create an account. */

import { signup } from "../api.js";
import { toast, busyButton } from "../ui.js";

export async function render(appEl) {
  appEl.innerHTML = `
    <div class="auth-wrap">
      <div class="card auth-card">
        <div class="brand-row"><span class="brand-mark" aria-hidden="true">▦</span> KitchenStudio</div>
        <h1>Create your account</h1>
        <p class="lede">Start designing kitchens in minutes. Free during beta.</p>
        <form class="form" id="signup-form" novalidate>
          <div class="form-error" id="form-error" hidden></div>
          <div class="field">
            <label for="name">Full name <span class="req">*</span></label>
            <input type="text" id="name" name="name" autocomplete="name" required />
            <span class="field-error" id="err-name" hidden></span>
          </div>
          <div class="field">
            <label for="email">Email <span class="req">*</span></label>
            <input type="email" id="email" name="email" autocomplete="email" required />
            <span class="field-error" id="err-email" hidden></span>
          </div>
          <div class="field">
            <label for="password">Password <span class="req">*</span></label>
            <input type="password" id="password" name="password" autocomplete="new-password" required />
            <span class="hint">At least 8 characters.</span>
            <span class="field-error" id="err-password" hidden></span>
          </div>
          <button class="btn btn-primary" type="submit" id="submit-btn">Create account</button>
        </form>
        <p class="auth-alt">Already have an account? <a href="#/login">Sign in</a></p>
      </div>
    </div>
  `;

  const form = appEl.querySelector("#signup-form");
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
    const name = form.querySelector('[name="name"]').value.trim();
    const email = form.querySelector('[name="email"]').value.trim();
    const password = form.querySelector('[name="password"]').value;

    let ok = true;
    if (!name) { setFieldError("name", "Please tell us your name."); ok = false; }
    else setFieldError("name", "");
    if (!email) { setFieldError("email", "Email is required."); ok = false; }
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setFieldError("email", "Enter a valid email address."); ok = false; }
    else setFieldError("email", "");
    if (!password) { setFieldError("password", "Password is required."); ok = false; }
    else if (password.length < 8) { setFieldError("password", "Use at least 8 characters."); ok = false; }
    else setFieldError("password", "");
    if (!ok) return;

    const restore = busyButton(submitBtn, "Creating account…");
    try {
      await signup({ email, password, name });
      toast(`Welcome to KitchenStudio, ${name.split(" ")[0]}!`, "success");
      location.hash = "#/app";
    } catch (err) {
      errBox.textContent = err.message || "Could not create your account. Please try again.";
      errBox.hidden = false;
      restore();
    }
  });
}

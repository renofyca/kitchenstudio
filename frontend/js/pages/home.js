/* #/ — Product landing page. */

export async function render(appEl) {
  appEl.innerHTML = `
    <section class="landing-hero">
      <div class="container">
        <span class="landing-kicker">For cabinet dealers &amp; designers</span>
        <h1>Kitchen designs, 3D views &amp; quotes — in minutes, not days.</h1>
        <p class="lede">
          KitchenStudio turns room measurements into a cabinet layout draft,
          renders it in 3D, and prices it from <strong>your own supplier
          catalog</strong>. No CAD skills required.
        </p>
        <div class="hero-ctas">
          <a class="btn btn-accent btn-lg" href="#/signup">Start free</a>
          <a class="btn btn-ghost btn-lg" href="#/login" style="color:#fff;border-color:rgba(255,255,255,.35)">Sign in</a>
        </div>
        <p class="hero-note">Free during beta · Upload your catalog as CSV · Cancel anytime</p>
      </div>
    </section>

    <section class="landing-section">
      <div class="container">
        <h2>Everything from measurement to invoice</h2>
        <p class="section-lede">
          One workspace carries the project from the first site measurement
          to a client-ready quote — no re-typing, no spreadsheets.
        </p>
        <div class="grid grid-3">
          <div class="card hoverable feature-card">
            <div class="f-icon" aria-hidden="true">✨</div>
            <h3>Auto-design drafts</h3>
            <p>Enter wall lengths, windows, doors and appliances. KitchenStudio
            drafts a code-sensible cabinet run — base, wall and tall cabinets,
            fillers included — in seconds.</p>
          </div>
          <div class="card hoverable feature-card">
            <div class="f-icon" aria-hidden="true">📚</div>
            <h3>Your catalogs</h3>
            <p>Bring your supplier's price list as a simple CSV. Every design
            prices itself live from your real SKUs, sizes and costs.</p>
          </div>
          <div class="card hoverable feature-card">
            <div class="f-icon" aria-hidden="true">🧊</div>
            <h3>3D + client quotes</h3>
            <p>Walk the kitchen in 3D, then hand the client a clean,
            printable quote with line items, quantities and totals.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="landing-section" style="background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
      <div class="container">
        <h2>How it works</h2>
        <p class="section-lede">Four steps from a tape measure to a signed quote.</p>
        <div class="steps">
          <div class="step">
            <h3>Upload your catalog</h3>
            <p>Drop in your supplier's CSV once. SKUs, dimensions and prices are ready for every project.</p>
          </div>
          <div class="step">
            <h3>Measure the room</h3>
            <p>Add walls with lengths, windows, doors and the appliances the client already picked.</p>
          </div>
          <div class="step">
            <h3>Draft &amp; refine in 3D</h3>
            <p>Auto-design generates the layout. Drag, swap and fine-tune it in the 3D designer.</p>
          </div>
          <div class="step">
            <h3>Quote &amp; print</h3>
            <p>One click builds the priced quote. Print it or walk through it with the client.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="landing-section">
      <div class="container">
        <div class="landing-cta-band">
          <h2>Stop redrawing kitchens by hand.</h2>
          <p>Set up your first catalog and design your first kitchen today.</p>
          <a class="btn btn-accent btn-lg" href="#/signup">Start free</a>
        </div>
      </div>
    </section>

    <footer class="landing-footer">
      <div class="container">
        <span>© 2026 KitchenStudio</span>
        <span>Designed for cabinet dealers, designers &amp; remodelers</span>
      </div>
    </footer>
  `;
}

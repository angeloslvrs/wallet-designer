import { state, subscribe, resetState, replaceState } from "./state.js";
import { renderForm } from "./form.js";
import { mountTabs } from "./tabs.js";
import { renderActiveTab } from "./preview/index.js";
import { wireBuildButton } from "./build.js";
import { initTheme } from "./theme.js";
// Flights is the landing view (light; no barcode deps). Issue and Design's
// heavy deps (bwip-js / @zxing/browser) are reached only via dynamic import()
// from their own modules, so first paint never pays for them.

async function showProfile() {
  const badge = document.getElementById("profile-badge");
  try {
    const r = await fetch("/api/profile").then(r => r.json());
    // Say what the operator cares about: do pushes go out? (dev logs instead)
    badge.textContent = r.profile === "prod" ? "prod · APNs live" : "dev · pushes logged";
    badge.title = r.profile === "prod" ? "Real Pass Type ID cert: passes install and pushes reach phones" : "Self-signed dev cert: passes build but won't install on iOS; pushes are logged, not sent";
    badge.classList.remove("is-err");
  } catch {
    badge.textContent = "API offline";
    badge.classList.add("is-err");
  }
}

// Load a FormState into the Design editor. Saved designs come from
// /api/designs; `?fixture=<name>` deep links read the repo's read-only CI
// fixtures from /api/fixtures.
async function loadInto(url, what, name) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${what} not found: ${name}`);
  replaceState(await r.json());
  renderForm(document.getElementById("form-pane"));
}
const loadDesign = (name) => loadInto(`/api/designs/${encodeURIComponent(name)}`, "design", name);
const loadFixture = (name) => loadInto(`/api/fixtures/${encodeURIComponent(name)}`, "fixture", name);

async function refreshDesignPicker() {
  const picker = document.getElementById("fixture-picker");
  picker.length = 1; // keep the placeholder option, drop the rest
  try {
    const names = await fetch("/api/designs").then(r => r.json());
    for (const n of names) {
      const o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      picker.appendChild(o);
    }
  } catch { /* API offline */ }
}

function wireDesignPicker() {
  const picker = document.getElementById("fixture-picker");
  picker.addEventListener("change", async e => {
    const name = e.target.value;
    if (!name) return;
    try { await loadDesign(name); } catch (err) { alert(err.message); }
    e.target.value = "";
  });
}

// Saved designs are FormState snapshots in designs/ (via /api/designs). The
// Templates shelf lists them as `kind: "studio"` templates.
async function saveDesign() {
  const name = prompt("Save current design as:", state.meta.serialNumber || "my-design");
  if (!name) return;
  const status = document.getElementById("build-status");
  try {
    const r = await fetch(`/api/designs/${encodeURIComponent(name)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state)
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok) { await refreshDesignPicker(); status.textContent = `✓ saved design "${name}"`; }
    else { status.textContent = `⚠ could not save design "${name}" — ${body.error ?? r.status}`; }
  } catch (err) {
    status.textContent = `⚠ could not save design — ${err.message}`;
  }
}

// Masthead segmented control: Flights (landing) · Templates · Issue · Design · Device log.
// Views are code-split: import() on first show, then mount. Because import()
// is async, the user could switch again before it resolves — `activeView`
// records the current selection so a stale import doesn't mount a pane the
// user has already navigated away from. Every mount still calls its module's
// own root._mountAbort teardown (abort-on-remount contract).
function wireViewTabs(initialView = "flights") {
  const tabs = document.getElementById("view-tabs");
  const panes = {
    flights: document.getElementById("flights-pane"),
    templates: document.getElementById("templates-pane"),
    designer: document.querySelector("main"),
    issue: document.getElementById("issue-pane"),
    log: document.getElementById("log-pane")
  };
  let activeView = null;
  // `opts` carries cross-view intent: { template } preselects Issue's template,
  // { bindingsFor } opens a template's Bindings screen.
  const loaders = {
    flights:   () => import("./flights.js").then(m => (root) => m.mountFlights(root, { showIssue: () => show("templates") })),
    templates: () => import("./templates.js").then(m => (root, opts) => m.mountTemplates(root, {
      bindingsFor: opts?.bindingsFor,
      onIssue: (id) => show("issue", { template: id }),
      onEditDesign: async (name) => {
        if (!confirm(`Open "${name}" in the Design editor? It replaces what's currently there.`)) return;
        try { await loadDesign(name); show("designer"); } catch (err) { alert(err.message); }
      },
      onNewDesign: () => {
        if (!confirm("Start a new design? Unsaved changes in the Design editor are replaced by the starter design.")) return;
        resetState();
        renderForm(document.getElementById("form-pane"));
        show("designer");
      }
    })),
    issue:     () => import("./issue.js").then(m => (root, opts) => m.mountIssue(root, () => show("flights"), { template: opts?.template, showTemplates: () => show("templates") })),
    log:       () => import("./log.js").then(m => (root) => m.mountLog(root))
  };
  const moveThumb = () => {
    const thumb = tabs.querySelector(".seg-thumb");
    const active = tabs.querySelector("button.active");
    if (!thumb || !active) return;
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.style.transform = `translateX(${active.offsetLeft}px)`;
  };
  const show = (view, opts) => {
    activeView = view;
    for (const [k, pane] of Object.entries(panes)) pane.hidden = k !== view;
    for (const b of tabs.querySelectorAll("button")) b.classList.toggle("active", b.dataset.view === view);
    moveThumb();
    if (view !== "designer") loaders[view]().then(mount => { if (activeView === view) mount(panes[view], opts); });
    history.replaceState(null, "", `#${view}`);
  };
  tabs.addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) show(b.dataset.view); });
  addEventListener("resize", moveThumb);
  document.fonts?.ready.then(moveThumb);
  // #view in the URL deep-links a view — on load and when the hash changes.
  addEventListener("hashchange", () => { const v = location.hash.slice(1); if (panes[v] && v !== activeView) show(v); });
  const fromHash = location.hash.slice(1);
  show(panes[fromHash] ? fromHash : initialView);
}

// Click a field on the live pass preview → jump to + focus its editor input.
function wireClickToEdit() {
  const stage = document.getElementById("preview-stage");
  if (!stage) return;
  stage.addEventListener("click", (e) => {
    const fieldEl = e.target.closest("[data-fieldkey]");
    const key = fieldEl?.dataset.fieldkey;
    if (!key) return;
    const input = document.querySelector(`#form-pane [data-fieldkey="${CSS.escape(key)}"]`);
    if (!input) return;
    input.scrollIntoView({ block: "center", behavior: "smooth" });
    input.focus();
    const row = input.closest(".wpd-df-row");
    if (row) { row.classList.add("wpd-flash"); setTimeout(() => row.classList.remove("wpd-flash"), 900); }
  });
}

async function maybeLoadFromUrl() {
  const params = new URLSearchParams(location.search);
  const f = params.get("fixture");
  if (!f) return;
  try { await loadFixture(f); } catch (err) { console.warn(err.message); }
}

document.documentElement.dataset.build = "20261009a"; // changes bundle hash → busts stale caches
initTheme();
showProfile();
await maybeLoadFromUrl();
renderForm(document.getElementById("form-pane"));
mountTabs(document.getElementById("tabs"));
wireBuildButton(document.getElementById("build-btn"), document.getElementById("build-status"));
document.getElementById("reset-btn").addEventListener("click", () => {
  resetState();
  renderForm(document.getElementById("form-pane"));
});
wireDesignPicker();
refreshDesignPicker();
document.getElementById("save-tpl-btn").addEventListener("click", saveDesign);
wireViewTabs(new URLSearchParams(location.search).get("fixture") ? "designer" : "flights");
wireClickToEdit();
renderActiveTab();
subscribe(() => renderActiveTab());

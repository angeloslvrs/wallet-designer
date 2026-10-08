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
    badge.textContent = r.profile === "prod" ? "prod cert" : "dev cert";
    badge.classList.remove("is-err");
  } catch {
    badge.textContent = "API offline";
    badge.classList.add("is-err");
  }
}

async function loadFixture(name) {
  const r = await fetch(`/api/fixtures/${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error(`fixture not found: ${name}`);
  const state = await r.json();
  replaceState(state);
  renderForm(document.getElementById("form-pane"));
}

async function refreshFixturePicker() {
  const picker = document.getElementById("fixture-picker");
  picker.length = 1; // keep the placeholder option, drop the rest
  try {
    const names = await fetch("/api/fixtures").then(r => r.json());
    for (const n of names) {
      const o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      picker.appendChild(o);
    }
  } catch { /* API offline */ }
}

function wireFixturePicker() {
  const picker = document.getElementById("fixture-picker");
  picker.addEventListener("change", async e => {
    const name = e.target.value;
    if (!name) return;
    try { await loadFixture(name); } catch (err) { alert(err.message); }
    e.target.value = "";
  });
}

// "Saved designs" are FormState snapshots persisted via /api/fixtures — distinct
// from ".pkpasstemplate" bundles, which the Issue view calls "templates".
async function saveDesign() {
  const name = prompt("Save current design as:", state.meta.serialNumber || "my-design");
  if (!name) return;
  const status = document.getElementById("build-status");
  try {
    const r = await fetch(`/api/fixtures/${encodeURIComponent(name)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state)
    });
    if (r.ok) { await refreshFixturePicker(); status.textContent = `✓ saved design "${name}"`; }
    else { status.textContent = `⚠ could not save design "${name}" (${r.status})`; }
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
        try { await loadFixture(name); show("designer"); } catch (err) { alert(err.message); }
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
wireFixturePicker();
refreshFixturePicker();
document.getElementById("save-tpl-btn").addEventListener("click", saveDesign);
wireViewTabs(new URLSearchParams(location.search).get("fixture") ? "designer" : "flights");
wireClickToEdit();
renderActiveTab();
subscribe(() => renderActiveTab());

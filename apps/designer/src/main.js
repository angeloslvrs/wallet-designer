import { state, subscribe, resetState, replaceState } from "./state.js";
import { renderForm } from "./form.js";
import { mountTabs } from "./tabs.js";
import { renderActiveTab } from "./preview/index.js";
import { wireBuildButton } from "./build.js";
import { mountManage } from "./manage.js";
import { mountIssue } from "./issue.js";

async function showProfile() {
  try {
    const r = await fetch("/api/profile").then(r => r.json());
    document.getElementById("profile-badge").textContent = `profile: ${r.profile}`;
  } catch {
    document.getElementById("profile-badge").textContent = "API offline";
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
  const r = await fetch(`/api/fixtures/${encodeURIComponent(name)}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state)
  });
  if (r.ok) { await refreshFixturePicker(); document.getElementById("build-status").textContent = `✓ saved design "${name}"`; }
  else { alert("Could not save design"); }
}

// Issue / Manage / Design view toggle. The template→issue→manage flow is the
// front door; the hand-designer is the secondary "Design (advanced)" tab.
function wireViewTabs(initialView = "issue") {
  const tabs = document.getElementById("view-tabs");
  const main = document.querySelector("main");
  const managePane = document.getElementById("manage-pane");
  const issuePane = document.getElementById("issue-pane");
  const show = (view) => {
    main.hidden = view !== "designer";
    managePane.hidden = view !== "manage";
    issuePane.hidden = view !== "issue";
    for (const b of tabs.querySelectorAll("button")) b.classList.toggle("active", b.dataset.view === view);
    if (view === "manage") mountManage(managePane, () => show("designer"));
    if (view === "issue") mountIssue(issuePane, () => show("manage"));
  };
  tabs.addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) show(b.dataset.view); });
  show(initialView);   // land on the issue flow, not the hand-designer
}

// Click a field on the live pass preview → jump to + focus its editor input.
// The preview fields carry data-fieldkey (from the built pass); the Design
// editor's display-field value inputs carry the same key. A no-op when a
// clicked field has no matching editor input (e.g. a derived/iOS-26 field).
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

document.documentElement.dataset.build = "20260610a"; // changes bundle hash → busts stale caches
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
wireViewTabs();
wireClickToEdit();
renderActiveTab();
subscribe(() => renderActiveTab());

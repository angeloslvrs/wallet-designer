import { state, subscribe, resetState, replaceState } from "./state.js";
import { renderForm } from "./form.js";
import { mountTabs } from "./tabs.js";
import { renderActiveTab } from "./preview/index.js";
import { wireBuildButton } from "./build.js";
import { mountTrip } from "./trip.js";
import { mountManage } from "./manage.js";

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

async function saveTemplate() {
  const name = prompt("Save current design as template named:", state.meta.serialNumber || "my-template");
  if (!name) return;
  const r = await fetch(`/api/fixtures/${encodeURIComponent(name)}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state)
  });
  if (r.ok) { await refreshFixturePicker(); document.getElementById("build-status").textContent = `✓ saved template "${name}"`; }
  else { alert("Could not save template"); }
}

// Designer / Manage view toggle.
function wireViewTabs() {
  const tabs = document.getElementById("view-tabs");
  const main = document.querySelector("main");
  const managePane = document.getElementById("manage-pane");
  const show = (view) => {
    const designer = view === "designer";
    main.hidden = !designer;
    managePane.hidden = designer;
    for (const b of tabs.querySelectorAll("button")) b.classList.toggle("active", b.dataset.view === view);
    if (!designer) mountManage(managePane, () => show("designer"));
  };
  tabs.addEventListener("click", e => { if (e.target.dataset?.view) show(e.target.dataset.view); });
}

async function maybeLoadFromUrl() {
  const params = new URLSearchParams(location.search);
  const f = params.get("fixture");
  if (!f) return;
  try { await loadFixture(f); } catch (err) { console.warn(err.message); }
}

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
document.getElementById("save-tpl-btn").addEventListener("click", saveTemplate);
wireViewTabs();
mountTrip(document.getElementById("live-controls"));
renderActiveTab();
subscribe(() => renderActiveTab());

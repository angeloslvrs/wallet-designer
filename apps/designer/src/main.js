import { subscribe, resetState, replaceState } from "./state.js";
import { renderForm } from "./form.js";
import { mountTabs } from "./tabs.js";
import { renderActiveTab } from "./preview/index.js";
import { wireBuildButton } from "./build.js";
import { mountTrip } from "./trip.js";

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

async function populateFixturePicker() {
  const picker = document.getElementById("fixture-picker");
  try {
    const names = await fetch("/api/fixtures").then(r => r.json());
    for (const n of names) {
      const o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      picker.appendChild(o);
    }
  } catch {}
  picker.addEventListener("change", async e => {
    const name = e.target.value;
    if (!name) return;
    try { await loadFixture(name); } catch (err) { alert(err.message); }
    e.target.value = "";
  });
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
populateFixturePicker();
mountTrip(document.getElementById("live-controls"));
renderActiveTab();
subscribe(() => renderActiveTab());

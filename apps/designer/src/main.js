import { subscribe } from "./state.js";
import { renderForm } from "./form.js";
import { mountTabs } from "./tabs.js";
import { renderActiveTab } from "./preview/index.js";
import { wireBuildButton } from "./build.js";

async function showProfile() {
  try {
    const r = await fetch("/api/profile").then(r => r.json());
    document.getElementById("profile-badge").textContent = `profile: ${r.profile}`;
  } catch {
    document.getElementById("profile-badge").textContent = "API offline";
  }
}

showProfile();
renderForm(document.getElementById("form-pane"));
mountTabs(document.getElementById("tabs"));
wireBuildButton(document.getElementById("build-btn"), document.getElementById("build-status"));
renderActiveTab();
subscribe(() => renderActiveTab());

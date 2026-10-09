import { subscribe } from "./state.js";
import { mountTabs } from "./tabs.js";
import { renderActiveTab } from "./preview/index.js";
import { initTheme } from "./theme.js";
import { initDesign, openDesign, newDesign, isDirty } from "./design.js";
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

// Masthead segmented control: Flights (landing) · Templates · Device log. Issue
// and Design are full-screen workspaces entered from the Templates shelf; while
// one is open the nav hides and the workspace offers ‹ Templates.
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
    flights:   () => import("./flights.js").then(m => (root, opts) => m.mountFlights(root, { showIssue: () => show("templates"), selectGroup: opts?.selectGroup })),
    templates: () => import("./templates.js").then(m => (root, opts) => m.mountTemplates(root, {
      bindingsFor: opts?.bindingsFor,
      onIssue: (id, kind) => show("issue", { template: id, kind }),
      onEditDesign: async (name) => {
        if (isDirty() && !confirm(`Open "${name}"? The editor has unsaved changes; they'll be replaced.`)) return;
        try { await openDesign(name); show("designer"); } catch (err) { alert(err.message); }
      },
      onNewDesign: () => {
        if (isDirty() && !confirm("Start a new design? The editor has unsaved changes; they'll be replaced by the starter design.")) return;
        newDesign();
        show("designer");
      }
    })),
    // Issue is a workspace, entered from a template card: it hides the nav and
    // offers ‹ Templates. `#issue` without a template lands back on the shelf.
    issue:     () => import("./issue/index.js").then(m => (root, opts) => m.mountIssue(root, {
      template: opts?.template, kind: opts?.kind,
      onBack: () => show("templates"),
      showTemplates: () => show("templates"),
      openFlight: (gid) => show("flights", { selectGroup: gid })
    })),
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
    document.getElementById("app-shell").classList.toggle("is-workspace", view === "issue" || view === "designer");
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
  show(panes[fromHash] && fromHash !== "issue" ? fromHash : initialView);
  return show;
}

// Tab strips (role="tablist"): ← / → move between tabs and select, Home/End jump
// to the ends — the WAI-ARIA tabs pattern, once for every view.
function wireTablistKeys() {
  document.addEventListener("keydown", (e) => {
    const list = e.target.closest?.('[role="tablist"]');
    if (!list || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const tabs = [...list.querySelectorAll('[role="tab"]:not([disabled])')];
    const i = tabs.indexOf(e.target.closest('[role="tab"]'));
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  });
}

async function maybeLoadFromUrl() {
  const f = new URLSearchParams(location.search).get("fixture");
  if (!f) return false;
  try { await openDesign(f, { fixture: true }); return true; } catch (err) { console.warn(err.message); return false; }
}

document.documentElement.dataset.build = "20261009b"; // changes bundle hash → busts stale caches
initTheme();
showProfile();
mountTabs(document.getElementById("tabs"));
wireTablistKeys();
let showView = null;   // set once the nav is wired (design hooks fire only on clicks)
initDesign({
  onBack: () => showView?.("templates"),
  onIssue: (name) => showView?.("issue", { template: name, kind: "studio" }),
  listDesigns: () => fetch("/api/designs").then(r => r.json()).catch(() => [])
});
const fromFixture = await maybeLoadFromUrl();
showView = wireViewTabs(fromFixture ? "designer" : "flights");
renderActiveTab();
subscribe(() => renderActiveTab());

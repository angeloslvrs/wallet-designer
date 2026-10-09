// Design workspace — the Studio template editor on the same canvas as Issue:
// left = one section of the editor (Look · Fields · Flight data · Barcode ·
// Advanced), centre = the Apple-faithful pass (Front/Back/iOS 26 detail,
// click a field to edit it), right = what's on the pass + whether Apple's
// required tags are present. The footer's one primary saves the design as a
// Studio template (designs/ via /api/designs); "Issue passes →" saves first,
// then opens the Issue workspace on it — the Design view no longer issues
// passes itself (one issue path).

import { DOC_REQUIRED_SEMANTICS, SEMANTIC_CATALOG } from "@wpd/pass-builder/semantics.js";
import { formStateToPassJson } from "@wpd/pass-builder/form-to-pass.js";
import { state, subscribe, resetState, replaceState } from "./state.js";
import { renderForm, DESIGN_SECTIONS } from "./form.js";
import { esc } from "./esc.js";
import { toast } from "./toast.js";

export const DESIGN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

let section = "look";
let name = "";          // saved design this editor holds ("" = never saved)
let savedHash = null;   // hash of the state as last saved/loaded (dirty check)
let session = 0;        // bumps on open/new, so a slow Save can't relabel a newer editor
let hooks = {};

/** FNV-1a over the state's JSON: small enough to persist next to it (images and all). */
export function stateHash(obj) {
  const str = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

// The editor's FormState survives reloads (state.js persists it); so do which
// saved design it is and what was last saved. The meta records the hash of the
// state it describes: if the persisted state isn't that state (a write failed,
// e.g. over quota), the identity is dropped rather than pinned on other content.
const META_KEY = "wpd:design-meta";
function persistMeta() {
  try { localStorage.setItem(META_KEY, JSON.stringify({ name, savedHash, stateHash: stateHash(state) })); }
  catch { try { localStorage.removeItem(META_KEY); } catch { /* private mode */ } }
}
function restoreMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) ?? "null");
    if (m && typeof m === "object" && m.stateHash === stateHash(state)) {
      name = typeof m.name === "string" ? m.name : "";
      savedHash = typeof m.savedHash === "string" ? m.savedHash : null;
    }
  } catch { /* ignore */ }
}

const $ = (s) => document.querySelector(s);
const formPane = () => document.getElementById("form-pane");
export const isDirty = () => stateHash(state) !== savedHash;
const typedName = () => { const v = ($("#design-name")?.value ?? "").trim(); return DESIGN_NAME_RE.test(v) ? v : designNameFrom(v); };

/** Slug a free-typed name into a design name ("Rocket Partners" → "rocket-partners"). */
export function designNameFrom(s) {
  return String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "").slice(0, 64);
}

function showSection(next) {
  section = next;
  for (const b of document.querySelectorAll("#design-tabs [data-section]")) b.setAttribute("aria-selected", String(b.dataset.section === section));
  renderForm(formPane(), { section });
  formPane().scrollTop = 0;
}

function refreshChrome() {
  const title = $("#design-title"), sub = $("#design-sub"), nameInput = $("#design-name");
  if (title) title.textContent = name || state.meta?.organizationName || "New design";
  const renamed = nameInput && nameInput.value.trim() && typedName() !== name;
  if (sub) sub.textContent = `Studio design · ${!name ? "not saved yet" : isDirty() || renamed ? "unsaved changes" : "saved"}`;
  if (nameInput && document.activeElement !== nameInput && !nameInput.value) nameInput.value = name;
  renderSide();
}

// Right pane: the fields on the pass and Apple's required-tag check.
function renderSide() {
  const side = $("#design-side");
  if (!side) return;
  let pass;
  try { pass = formStateToPassJson(state); } catch (err) { side.innerHTML = `<p class="iw-note is-err">Can’t build this design: ${esc(err.message)}</p>`; return; }
  const bp = pass.boardingPass ?? {};
  const zones = [["headerFields", "Header"], ["primaryFields", "Primary"], ["secondaryFields", "Secondary"], ["auxiliaryFields", "Auxiliary"], ["backFields", "Back"]];
  const show = (v) => { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(v ?? "")); return m ? `${m[1]} ${m[2]}` : String(v ?? ""); };
  const rows = zones.flatMap(([z, label]) => (bp[z] ?? []).map(f =>
    `<button type="button" class="dw-frow" data-jump-field="${esc(f.key)}"><span>${esc(f.label || f.key)}<small>${esc(label)} · ${esc(f.key)}</small></span><b>${esc(show(f.value))}</b></button>`)).join("");
  const sem = pass.semantics ?? {};
  const missing = DOC_REQUIRED_SEMANTICS.filter(k => sem[k] === undefined || sem[k] === "");
  const have = DOC_REQUIRED_SEMANTICS.length - missing.length;
  side.innerHTML = `
    <h2 class="iw-side-h">Apple’s boarding tags</h2>
    <p class="iw-note ${missing.length ? "is-warn" : ""}">${have} of ${DOC_REQUIRED_SEMANTICS.length} present${missing.length ? ` — without the rest iOS 26 falls back to the classic pass: ${esc(missing.map(k => SEMANTIC_CATALOG[k]?.label ?? k).join(", "))}.` : " — the iOS 26 boarding view and Live Activity have what they need."}</p>
    ${missing.length ? `<button type="button" class="btn-link" data-design-act="section" data-section="flight">Open Flight data</button>` : ""}
    <h2 class="iw-side-h">On the pass</h2>
    <div class="dw-frows">${rows || `<p class="iw-empty">No fields yet — add some under Fields.</p>`}</div>`;
}

async function saveDesign({ quiet = false } = {}) {
  const input = $("#design-name");
  const typed = (input?.value ?? "").trim();
  const next = DESIGN_NAME_RE.test(typed) ? typed : designNameFrom(typed);
  const status = $("#build-status");
  if (!next) {
    status.textContent = "Name the template first.";
    input?.focus();
    return false;
  }
  if (input) input.value = next;
  if (next !== name && hooks.listDesigns) {
    const names = await hooks.listDesigns();
    if (names.includes(next) && !confirm(`A template named “${next}” already exists. Replace it?`)) return false;
  }
  status.textContent = "Saving…";
  // One snapshot is both what's sent and what counts as saved: edits made while
  // the request is in flight stay dirty.
  const snapshot = JSON.parse(JSON.stringify(state));
  const mine = session;
  let r, j;
  try {
    r = await fetch(`/api/designs/${encodeURIComponent(next)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot) });
    j = await r.json().catch(() => ({}));
  } catch (err) { status.textContent = `Not saved — ${err.message}`; return false; }
  if (!r.ok) { status.textContent = `Not saved — ${j.error ?? r.status}`; return false; }
  if (mine !== session) return false;   // the editor moved on to another design meanwhile
  name = next;
  savedHash = stateHash(snapshot);
  persistMeta();
  status.textContent = "";
  if (!quiet) toast(`Saved “${name}” to Templates`);
  refreshChrome();
  hooks.onSaved?.();
  return true;
}

/** Load a saved design (or a read-only CI fixture) into the editor. */
export async function openDesign(designName, { fixture = false } = {}) {
  const url = fixture ? `/api/fixtures/${encodeURIComponent(designName)}` : `/api/designs/${encodeURIComponent(designName)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${fixture ? "fixture" : "design"} not found: ${designName}`);
  session++;
  replaceState(await r.json());
  // A fixture opens as an unsaved copy: saving it writes a new design, never fixtures/.
  name = fixture ? "" : designName;
  savedHash = fixture ? null : stateHash(state);
  persistMeta();
  const input = $("#design-name"); if (input) input.value = name;
  showSection("look");
  refreshChrome();
}

/** Start a fresh design from the starter. */
export function newDesign() {
  session++;
  resetState();
  name = "";
  savedHash = null;
  persistMeta();
  const input = $("#design-name"); if (input) input.value = "";
  showSection("look");
  refreshChrome();
}

/**
 * Wire the Design workspace once at boot.
 * @param {{onBack: () => void, onIssue: (name: string) => void, onSaved?: () => void,
 *          listDesigns?: () => Promise<string[]>}} h
 */
export function initDesign(h) {
  hooks = h;
  restoreMeta();
  const input = $("#design-name"); if (input) input.value = name;
  const tabs = $("#design-tabs");
  tabs.innerHTML = DESIGN_SECTIONS.map(([k, label]) =>
    `<button type="button" role="tab" class="iw-tab" data-section="${k}" aria-selected="${k === section}">${label}</button>`).join("");
  tabs.addEventListener("click", (e) => { const b = e.target.closest("[data-section]"); if (b) showSection(b.dataset.section); });

  document.querySelector("main").addEventListener("click", async (e) => {
    const t = e.target.closest("[data-design-act], [data-jump-field]");
    if (!t) return;
    if (t.dataset.jumpField !== undefined) return jumpToField(t.dataset.jumpField);
    const act = t.dataset.designAct;
    if (act === "back") {
      if (isDirty() && !confirm("Leave the editor? Unsaved changes stay here until you start over, but aren’t on the Templates shelf.")) return;
      return hooks.onBack?.();
    }
    if (act === "section") return showSection(t.dataset.section);
    if (act === "save") return saveDesign();
    if (act === "issue") {
      // Save first unless the shelf already has exactly this design under this name.
      if ((!name || isDirty() || typedName() !== name) && !(await saveDesign({ quiet: true }))) return;
      return hooks.onIssue?.(name);
    }
    if (act === "reset") {
      if (!confirm("Start over from the starter design? Unsaved changes here are lost.")) return;
      return newDesign();
    }
  });

  // Click a field on the live pass → the Fields section, focused on its value.
  document.getElementById("preview-stage")?.addEventListener("click", (e) => {
    const key = e.target.closest("[data-fieldkey]")?.dataset.fieldkey;
    if (key) jumpToField(key);
  });

  subscribe(() => { persistMeta(); refreshChrome(); });
  $("#design-name")?.addEventListener("input", () => refreshChrome());
  showSection(section);
  refreshChrome();
}

function jumpToField(key) {
  if (section !== "fields") showSection("fields");
  const input = document.querySelector(`#form-pane [data-fieldkey="${CSS.escape(key)}"]`);
  if (!input) return;
  input.scrollIntoView({ block: "center", behavior: "smooth" });
  input.focus();
  const row = input.closest(".wpd-df-row");
  if (row) { row.classList.add("wpd-flash"); setTimeout(() => row.classList.remove("wpd-flash"), 900); }
}

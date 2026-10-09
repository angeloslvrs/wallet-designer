import { esc } from "./esc.js";
import { BOARDING_SEMANTICS } from "@wpd/pass-builder/semantics.js";
import { toPassView } from "./preview/wallet/model.js";
import { renderFront } from "./preview/wallet/card.js";
import "./preview/wallet/wallet.css";

// Templates view — one shelf for both kinds of template:
//   designer: a Pass Designer `.pkpasstemplate` bundle (GET /api/templates)
//   studio:   a design saved from the in-app Design view (GET /api/studio-templates,
//             backed by designs/*.json; DELETE /api/designs/:name)
// plus the Bindings review screen for either kind (semanticKey → fieldKey;
// PUT /api/templates/:id/bindings or /api/designs/:name/bindings). Uploading a
// bundle lands on its Bindings screen. A studio design's confirmed bindings
// survive its sample values being cleared; "Reset to automatic" DELETEs them.

const SEMANTIC_KEYS = Object.keys(BOARDING_SEMANTICS);
const FIELD_ZONES = ["headerFields", "primaryFields", "secondaryFields", "auxiliaryFields", "backFields", "additionalInfoFields"];

/** Slug a dropped file name into a template id ("Odyssey Air.pkpasstemplate.zip" → "odyssey-air"). */
export function templateIdFromFile(name) {
  return String(name ?? "")
    .replace(/\.zip$/i, "").replace(/\.pkpasstemplate$/i, "")
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "template";
}

/** { fieldKey: displayed sample value } across every field zone of a pass.json. */
export function fieldSamples(passJson) {
  const out = {};
  for (const zone of FIELD_ZONES) {
    for (const f of passJson?.boardingPass?.[zone] ?? []) {
      if (f?.key && out[f.key] === undefined) out[f.key] = f.value;
    }
  }
  return out;
}

/** camelCase / kebab / snake → lowercase tokens, plural s stripped ("departureGate" → ["departure","gate"]). */
const tokens = (k) => String(k ?? "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(t => t.replace(/s$/, ""));
/**
 * Is a discovered binding safe enough to skip a human look? Date-proximity and
 * seat-composite matches are always a guess; a value/name match whose field key
 * shares a word (or a 4+ letter prefix) with the semantic ("departureGate" →
 * "gate", "passengerName" → "passenger", "flightCode" → "flight") is treated as
 * matched. Confirmed (manual) and field-declared (high) bindings never need one.
 */
export function needsReview(sem, b) {
  if (!b) return false;
  if (b.source === "manual" || b.confidence === "high") return false;
  if (b.source === "date-proximity" || b.source === "seat-composite") return true;
  const st = tokens(sem), kt = tokens(b.fieldKey);
  const hit = kt.some(k => st.some(t => t === k || (k.length >= 4 && (t.startsWith(k) || k.startsWith(t)))));
  return !hit;
}

/** Bindings that still need a human look (see needsReview). */
export const guessCount = (bindings) =>
  Object.entries(bindings ?? {}).filter(([sem, b]) => needsReview(sem, b)).length;

const confidenceLabel = (sem, b) => {
  if (!b) return { cls: "un", text: "new" };
  if (b.source === "manual") return { cls: "hi", text: "confirmed" };
  if (b.confidence === "high") return { cls: "hi", text: "declared" };
  if (!needsReview(sem, b)) return { cls: "hi", text: "matched" };
  const how = { "value-match": "value match", "date-proximity": "±120 s", "seat-composite": "composite", "name-match": "name match" }[b.source] ?? b.source;
  return { cls: "lo", text: `check · ${how}` };
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const fmtSample = (v) => {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "string" && ISO_RE.test(v)) {
    const d = new Date(v);
    if (!isNaN(d)) return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
};

// Shelf grouping (Airline › Route › Flight): templates of one airline code sit
// together. An organization name of "Airline" (Pass Designer's placeholder)
// names nothing, so the code stands in.
const GENERIC_ORG = new Set(["airline", ""]);
/**
 * Templates grouped by airline: key = semantics.airlineCode, else the
 * organization name. Name = the first non-generic organization name (Studio
 * designs first), else the code. Sorted by name.
 * @returns {{key: string, code: string, name: string, templates: {kind: string, t: object}[]}[]}
 */
export function airlineGroups(designer, studio) {
  const groups = new Map();
  const all = [...studio.map(t => ({ kind: "studio", t })), ...designer.map(t => ({ kind: "designer", t }))];
  for (const e of all) {
    const code = String(e.t.semantics?.airlineCode ?? "").trim();
    const key = code ? `code:${code}` : `org:${e.t.organizationName || e.t.id}`;
    if (!groups.has(key)) groups.set(key, { key, code, name: "", templates: [] });
    const g = groups.get(key);
    g.templates.push(e);
    if (!g.name && !GENERIC_ORG.has(String(e.t.organizationName ?? "").trim().toLowerCase())) g.name = e.t.organizationName;
  }
  for (const g of groups.values()) {
    g.name ||= g.code || g.templates[0].t.id;
    // Keep each kind's own order (designer before studio inside a group reads oddly, so studio first).
    g.templates.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "studio" ? -1 : 1));
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const routeFlight = (r) => r.values?.flightCode || (r.values?.airlineCode && r.values?.flightNumber !== undefined ? `${r.values.airlineCode}${r.values.flightNumber}` : r.id);

/** Render a scaled, barcode-free Wallet front for a shelf/preview thumbnail. */
function mountThumb(host, passJson, logo) {
  if (!host || !passJson) return;
  const view = toPassView(passJson);
  // No encoder on the shelf: an unknown format makes renderBarcode draw its
  // neutral placeholder instead of lazy-loading the ~900 kB barcode library.
  if (view.barcode) view.barcode = { format: "thumbnail", message: "", altText: view.barcode.altText };
  host.replaceChildren();
  renderFront(host, view, logo ?? null);
}

export function mountTemplates(root, { onIssue, onRoute, onEditDesign, onNewDesign, bindingsFor } = {}) {
  root._mountAbort?.abort();
  const { signal } = (root._mountAbort = new AbortController());

  let designer = [];      // GET /api/templates
  let studio = [];        // GET /api/studio-templates
  let issued = {};        // template id → issued pass count
  let issuedDesign = {};  // studio design name → issued pass count (pass.designName)
  let routes = [];        // GET /api/routes
  let issuedRoute = {};   // route id → issued pass count (pass.routeId)
  let mode = bindingsFor ? { view: "bindings", kind: "designer", id: bindingsFor } : { view: "shelf" };
  let draft = null;       // bindings screen: { semanticKey: fieldKey }; null = seed from server
  let flash = "";         // one-shot status line on the shelf

  const $ = (s) => root.querySelector(s);
  const listOf = (kind) => (kind === "studio" ? studio : designer);
  const bindingsUrl = (kind, id) => (kind === "studio" ? `/api/designs/${encodeURIComponent(id)}/bindings` : `/api/templates/${encodeURIComponent(id)}/bindings`);

  // ---- data -----------------------------------------------------------------
  async function load() {
    if (signal.aborted) return;
    if (!designer.length && !studio.length) root.innerHTML = `<div class="view"><p class="empty">Loading templates…</p></div>`;
    const get = (u) => fetch(u, { signal }).then(r => r.json());
    let d, s, p, rt;
    try { [d, s, p, rt] = await Promise.all([get("/api/templates"), get("/api/studio-templates").catch(() => []), get("/api/passes").catch(() => []), get("/api/routes").catch(() => [])]); }
    catch { if (signal.aborted) return; root.innerHTML = `<div class="view"><p class="empty">API offline.</p></div>`; return; }
    if (signal.aborted) return;
    designer = Array.isArray(d) ? d : [];
    studio = Array.isArray(s) ? s : [];
    routes = Array.isArray(rt) ? rt : [];
    issued = {};
    issuedDesign = {};
    issuedRoute = {};
    for (const pass of Array.isArray(p) ? p : []) {
      if (pass.routeId) issuedRoute[pass.routeId] = (issuedRoute[pass.routeId] ?? 0) + 1;
      if (pass.template) issued[pass.template] = (issued[pass.template] ?? 0) + 1;
      else if (pass.designName) issuedDesign[pass.designName] = (issuedDesign[pass.designName] ?? 0) + 1;
    }
    render();
  }

  // ---- shelf ----------------------------------------------------------------
  // A template's routes (PR 2987 MNL → TAC 16:35), with Issue / Edit / Move to /
  // Delete. Move lists the airline's other templates (variants).
  function routesHtml(kind, t, siblings) {
    const mine = routes.filter(r => r.template?.kind === kind && r.template?.id === t.id);
    const others = siblings.filter(s => !(s.kind === kind && s.t.id === t.id) && !s.t.error);
    const rows = mine.map(r => {
      const v = r.values ?? {};
      const leg = v.departureAirportCode || v.destinationAirportCode ? `${v.departureAirportCode ?? "—"} → ${v.destinationAirportCode ?? "—"}` : "";
      const n = issuedRoute[r.id] ?? 0;
      const move = others.length
        ? `<select class="tpl-route-move" data-route-move="${esc(r.id)}" aria-label="Move route ${esc(r.id)} to another template"><option value="">Move to…</option>${others.map(o => `<option value="${esc(`${o.kind}:${o.t.id}`)}">${esc(o.t.id)}</option>`).join("")}</select>`
        : "";
      return `<li class="tpl-route" data-route="${esc(r.id)}">
        <div class="tpl-route-main"><b>${esc(routeFlight(r))}</b><span>${esc([leg, r.schedule?.departure ?? ""].filter(Boolean).join(" · "))}${n ? ` · ${n} issued` : ""}</span></div>
        <div class="tpl-route-acts">
          <button type="button" class="btn-link" data-act="route-edit" data-id="${esc(t.id)}" data-kind="${kind}" data-route-id="${esc(r.id)}">Edit</button>
          ${move}
          <button type="button" class="btn-link danger" data-act="route-del" data-route-id="${esc(r.id)}">Delete</button>
          <button type="button" class="btn btn-sm" data-act="route-issue" data-id="${esc(t.id)}" data-kind="${kind}" data-route-id="${esc(r.id)}">Issue →</button>
        </div>
      </li>`;
    }).join("");
    return `<ul class="tpl-routes" aria-label="Routes">${rows}<li><button type="button" class="btn-link" data-act="route-new" data-id="${esc(t.id)}" data-kind="${kind}">+ Route</button></li></ul>`;
  }

  function designerCard(t, siblings = []) {
    if (t.error) {
      return `<article class="tpl-card is-broken" data-tpl="${esc(t.id)}">
        <div class="tpl-thumb tpl-thumb--broken">⚠</div>
        <div class="tpl-meta"><div class="tpl-name">${esc(t.id)}</div><div class="tpl-sub">Bundle won’t load: ${esc(t.error)}</div></div>
        <div class="tpl-acts"><button type="button" class="btn-link danger" data-act="tpl-del" data-id="${esc(t.id)}">Delete</button></div>
      </article>`;
    }
    const guesses = guessCount(t.bindings);
    const n = issued[t.id] ?? 0;
    return `<article class="tpl-card" data-tpl="${esc(t.id)}" data-kind="designer">
      <div class="tpl-thumb" data-thumb="designer:${esc(t.id)}"></div>
      <div class="tpl-meta">
        <div class="tpl-name">${esc(t.organizationName || t.id)}</div>
        <div class="tpl-sub">${esc(t.id)} · ${(t.fieldKeys ?? []).length} fields${n ? ` · ${n} issued` : ""}</div>
      </div>
      <div class="tpl-chips"><span class="kind-chip">Pass Designer</span>${guesses ? `<span class="kind-chip kind-chip--warn">${guesses} binding${guesses === 1 ? "" : "s"} to check</span>` : ""}</div>
      <div class="tpl-acts">
        <button type="button" class="btn-link" data-act="bindings" data-id="${esc(t.id)}">Bindings</button>
        <button type="button" class="btn-link danger" data-act="tpl-del" data-id="${esc(t.id)}">Delete</button>
        <button type="button" class="btn btn-primary btn-sm" data-act="issue" data-id="${esc(t.id)}" data-kind="designer">Issue →</button>
      </div>
      ${routesHtml("designer", t, siblings)}
      <div class="tpl-status" data-tpl-status="${esc(t.id)}"></div>
    </article>`;
  }

  function studioCard(t, siblings = []) {
    const del = `<button type="button" class="btn-link danger" data-act="design-del" data-id="${esc(t.id)}">Delete</button>`;
    if (t.error) {
      return `<article class="tpl-card is-broken" data-tpl="${esc(t.id)}" data-kind="studio">
        <div class="tpl-thumb tpl-thumb--broken">⚠</div>
        <div class="tpl-meta"><div class="tpl-name">${esc(t.id)}</div><div class="tpl-sub">Design won’t build: ${esc(t.error)}</div></div>
        <div class="tpl-acts">${del}</div>
        <div class="tpl-status" data-tpl-status="${esc(t.id)}"></div>
      </article>`;
    }
    const n = issuedDesign[t.id] ?? 0;
    // Discovered guesses only matter until the operator confirms the map.
    const guesses = t.bindingsSaved ? 0 : guessCount(t.bindings);
    return `<article class="tpl-card" data-tpl="${esc(t.id)}" data-kind="studio">
      <div class="tpl-thumb" data-thumb="studio:${esc(t.id)}"></div>
      <div class="tpl-meta">
        <div class="tpl-name">${esc(t.organizationName || t.id)}</div>
        <div class="tpl-sub">${esc(t.id)}${t.description ? ` · ${esc(t.description)}` : ""}${n ? ` · ${n} issued` : ""}</div>
      </div>
      <div class="tpl-chips"><span class="kind-chip kind-chip--studio">Studio design</span>${guesses ? `<span class="kind-chip kind-chip--warn">${guesses} binding${guesses === 1 ? "" : "s"} to check</span>` : ""}</div>
      <div class="tpl-acts">
        <button type="button" class="btn-link" data-act="edit-design" data-id="${esc(t.id)}">Edit design</button>
        <button type="button" class="btn-link" data-act="bindings" data-id="${esc(t.id)}" data-kind="studio">Bindings</button>
        ${del}
        <button type="button" class="btn btn-primary btn-sm" data-act="issue" data-id="${esc(t.id)}" data-kind="studio">Issue →</button>
      </div>
      ${routesHtml("studio", t, siblings)}
      <div class="tpl-status" data-tpl-status="${esc(t.id)}"></div>
    </article>`;
  }

  function renderShelf() {
    const groups = airlineGroups(designer, studio);
    const sections = groups.map(g => {
      const nRoutes = routes.filter(r => g.templates.some(e => e.kind === r.template?.kind && e.t.id === r.template?.id)).length;
      const cards = g.templates.map(e => (e.kind === "studio" ? studioCard(e.t, g.templates) : designerCard(e.t, g.templates))).join("");
      return `<section class="tpl-section">
          <div class="eyebrow">${esc(g.name)}${g.code && g.code !== g.name ? ` · ${esc(g.code)}` : ""} · ${g.templates.length} template${g.templates.length === 1 ? "" : "s"}${nRoutes ? ` · ${nRoutes} route${nRoutes === 1 ? "" : "s"}` : ""}</div>
          <div class="tpl-grid stagger">${cards}</div>
        </section>`;
    }).join("");
    root.innerHTML = `
      <div class="view tpl-view">
        <div class="view-head">
          <div><h1>Templates</h1><p class="view-sub">Each airline’s look, with its routes underneath. Issue from a route to pick a date and add passengers, or straight from a template.</p></div>
          <div class="tpl-head-acts">
            <input type="file" accept=".zip" id="tpl-file" hidden />
            <button type="button" class="btn" data-act="upload">Upload .pkpasstemplate</button>
            <button type="button" class="btn" data-act="new-design">New design</button>
          </div>
        </div>
        <p class="tpl-flash" id="tpl-flash">${esc(flash)}</p>
        ${sections}
        <section class="tpl-section">
          <div class="eyebrow">Add an airline</div>
          <div class="tpl-grid stagger">
            <button type="button" class="tpl-card tpl-card--new" data-act="new-design"><b>+</b><span>Design a new look</span><small>build one in the Design editor</small></button>
            <button type="button" class="tpl-card tpl-card--new" data-act="upload"><b>+</b><span>Upload a .pkpasstemplate</span><small>zip the bundle from Pass Designer</small></button>
          </div>
        </section>
      </div>`;
    flash = "";
    for (const t of designer) if (!t.error) mountThumb($(`[data-thumb="designer:${CSS.escape(t.id)}"]`), t.preview, t.logo);
    for (const t of studio) if (!t.error) mountThumb($(`[data-thumb="studio:${CSS.escape(t.id)}"]`), t.preview, t.logo);
  }

  // ---- bindings -------------------------------------------------------------
  function renderBindings() {
    const studioKind = mode.kind === "studio";
    const t = listOf(mode.kind).find(x => x.id === mode.id && !x.error);
    if (!t) { flash = studioKind ? `Design "${mode.id ?? ""}" isn’t saved.` : `Template "${mode.id ?? ""}" isn’t installed.`; mode = { view: "shelf" }; renderShelf(); return; }
    const samples = fieldSamples(t.preview);
    const fieldOpts = (sel) => [""].concat(t.fieldKeys ?? []).map(k =>
      `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(k || "— unbound")}</option>`).join("");
    const rows = Object.keys(draft).sort().map(sem => {
      const b = t.bindings?.[sem];
      const conf = b && b.fieldKey === draft[sem] ? confidenceLabel(sem, b) : { cls: "hi", text: "edited" };
      return `<tr data-sem-row="${esc(sem)}" data-field="${esc(draft[sem])}">
        <td><code id="sem-${esc(sem)}">${esc(sem)}</code></td>
        <td><select class="bind-sel ${conf.cls === "lo" ? "is-guess" : ""}" data-bind-sem="${esc(sem)}" aria-labelledby="sem-${esc(sem)}" aria-label="Template field for ${esc(sem)}">${fieldOpts(draft[sem])}</select></td>
        <td><span class="conf conf--${conf.cls}">${esc(conf.text)}</span></td>
        <td class="bind-sample">${esc(fmtSample(samples[draft[sem]]))}</td>
      </tr>`;
    }).join("");
    const unbound = SEMANTIC_KEYS.filter(k => !draft[k]);
    const guesses = Object.keys(draft).filter(sem => { const b = t.bindings?.[sem]; return b && b.fieldKey === draft[sem] && needsReview(sem, b); }).length;
    const hasBaseIcon = (t.assets ?? []).includes("icon.png");
    root.innerHTML = `
      <div class="view tpl-view">
        <div class="view-head">
          <div><button type="button" class="btn btn-sm" data-act="back">‹ Templates</button>
            <h1>${esc(t.id)} · bindings</h1>${studioKind ? ` <span class="kind-chip kind-chip--studio">Studio design</span>` : ""}
            <p class="view-sub">${(t.fieldKeys ?? []).length} fields · ${Object.keys(draft).length} bound${guesses ? ` · <b class="warn-text">${guesses} to check</b>` : ` · <span class="ok-text">nothing to check</span>`}</p></div>
          <div class="tpl-head-acts">
            ${studioKind && t.bindingsSaved ? `<button type="button" class="btn-link" data-act="bind-reset" title="Automatic bindings follow the design’s sample values; confirmed ones stay fixed when you clear them.">Reset to automatic</button>` : ""}
            <button type="button" class="btn" data-act="back">Later</button>
            <button type="button" class="btn btn-primary" data-act="bind-save">Confirm bindings</button>
          </div>
        </div>
        <div class="bind-split">
          <div class="card bind-card">
            <p class="bind-explain">Apple’s semantic tags are a fixed vocabulary; this template’s field keys are its own. Each binding says which visible field shows a semantic, so a status push updates both. Rows marked <b>check</b> were matched by timing or by splitting a value and deserve a look; the rest matched by name. Unbound tags still render on iOS 26 from semantics alone.</p>
            <table class="bind-table">
              <thead><tr><th>Apple semantic</th><th>Template field</th><th>Confidence</th><th>Sample</th></tr></thead>
              <tbody>${rows || `<tr><td colspan="4" class="empty">No bindings yet — add one below.</td></tr>`}</tbody>
            </table>
            <div class="bind-add">
              <select data-add-sem aria-label="Semantic to bind"><option value="">+ bind a semantic…</option>${unbound.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}</select>
              <select data-add-field aria-label="Template field">${fieldOpts("")}</select>
              <button type="button" class="btn btn-sm" data-act="bind-add">Add</button>
              <span class="tpl-status" id="bind-status"></span>
            </div>
          </div>
          <aside class="bind-side">
            <div class="eyebrow">Template as exported · hover a row to find its field</div>
            <div class="bind-thumb" data-thumb="bind"></div>
            ${studioKind ? `
            <div class="eyebrow" style="margin-top:20px">Studio design</div>
            <div class="kv"><span>Fields</span>${(t.fieldKeys ?? []).length}</div>
            <div class="kv"><span>Bindings</span>${t.bindingsSaved ? "confirmed" : "automatic (from sample values)"}</div>
            <div class="kv"><span>Issued from it</span>${issuedDesign[t.id] ?? 0}</div>` : `
            <div class="eyebrow" style="margin-top:20px">Bundle</div>
            <div class="kv"><span>pass.json</span>${(t.fieldKeys ?? []).length} fields</div>
            <div class="kv"><span>Images</span>${esc((t.assets ?? []).filter(a => /\.png$/i.test(a)).join(", ") || "none")}</div>
            <div class="kv"><span>Base icon.png</span>${hasBaseIcon ? "included" : `<span class="ok-text">synthesized from @2x</span>`}</div>
            <div class="kv"><span>Issued from it</span>${issued[t.id] ?? 0}</div>`}
            <button type="button" class="btn btn-sm" style="margin-top:16px" data-act="issue" data-id="${esc(t.id)}" data-kind="${studioKind ? "studio" : "designer"}">Issue from this template →</button>
          </aside>
        </div>
      </div>`;
    mountThumb($('[data-thumb="bind"]'), t.preview, t.logo);
  }

  function openBindings(id, kind = "designer") {
    const t = listOf(kind).find(x => x.id === id);
    draft = Object.fromEntries(Object.entries(t?.bindings ?? {}).map(([sem, b]) => [sem, b.fieldKey]));
    mode = { view: "bindings", kind, id };
    render();
  }

  function render() {
    if (mode.view === "bindings") {
      if (draft === null) {
        const t = listOf(mode.kind).find(x => x.id === mode.id);
        draft = Object.fromEntries(Object.entries(t?.bindings ?? {}).map(([sem, b]) => [sem, b.fieldKey]));
      }
      renderBindings();
    } else renderShelf();
  }

  // ---- actions --------------------------------------------------------------
  async function saveBindings() {
    const { id, kind } = mode;
    const status = $("#bind-status");
    if (status) status.textContent = "Saving…";
    let r, j;
    try {
      r = await fetch(bindingsUrl(kind, id), {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft), signal
      });
      j = await r.json().catch(() => ({}));
    } catch { if (signal.aborted) return; if (status) status.textContent = "✗ API offline"; return; }
    if (signal.aborted) return;
    if (!r.ok) { if (status) status.textContent = `✗ ${j.error ?? r.status}`; return; }
    flash = `✓ Saved ${Object.keys(j.bindings ?? {}).length} binding(s) for ${id}.`;
    mode = { view: "shelf" };
    draft = null;
    await load();
  }

  // Studio only: forget the confirmed map so bindings follow the design's
  // sample values again.
  async function resetBindings() {
    const { id } = mode;
    const status = $("#bind-status");
    if (status) status.textContent = "Resetting…";
    let r;
    try { r = await fetch(bindingsUrl("studio", id), { method: "DELETE", signal }); }
    catch { if (signal.aborted) return; if (status) status.textContent = "✗ API offline"; return; }
    if (signal.aborted) return;
    if (!r.ok) { if (status) status.textContent = `✗ reset failed (${r.status})`; return; }
    flash = `✓ ${id} is back to automatic bindings.`;
    mode = { view: "shelf" };
    draft = null;
    await load();
  }

  async function upload(file) {
    if (!file) return;
    const id = templateIdFromFile(file.name);
    const fl = $("#tpl-flash");
    if (fl) fl.textContent = `Uploading ${id}…`;
    let r, j;
    try {
      r = await fetch(`/api/templates/${encodeURIComponent(id)}`, {
        method: "POST", headers: { "Content-Type": "application/zip" }, body: await file.arrayBuffer(), signal
      });
      j = await r.json().catch(() => ({}));
    } catch { if (signal.aborted) return; if (fl) fl.textContent = "✗ API offline"; return; }
    if (signal.aborted) return;
    if (!r.ok) { if (fl) fl.textContent = `✗ Upload failed: ${j.error ?? r.status}`; return; }
    // Land on the fresh template's bindings so the operator confirms the guesses.
    await load();
    if (signal.aborted) return;
    openBindings(id);
  }

  async function deleteTemplate(id) {
    if (!confirm(`Delete template "${id}"?`)) return;
    const st = $(`[data-tpl-status="${CSS.escape(id)}"]`) ?? $("#tpl-flash");
    if (st) st.textContent = "Deleting…";
    let r, j;
    try {
      r = await fetch(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE", signal });
      j = await r.json().catch(() => ({}));
    } catch (err) { if (signal.aborted) return; if (st) st.textContent = `✗ delete failed — ${err.message}`; return; }
    if (signal.aborted) return;
    // 409 = passes still rebuild from this bundle; show the server's reason.
    if (!r.ok) { if (st) st.textContent = `✗ ${j.error ?? `delete failed (${r.status})`}`; return; }
    flash = `✓ Deleted ${id}.`;
    await load();
  }

  // Deleting a design only removes the look from the shelf: passes already
  // issued from it carry their own FormState and keep updating.
  async function deleteDesign(id) {
    const n = issuedDesign[id] ?? 0;
    const tail = n ? ` The ${n} pass${n === 1 ? "" : "es"} already issued from it keep working.` : "";
    if (!confirm(`Delete studio design "${id}"?${tail}`)) return;
    const st = $(`[data-tpl-status="${CSS.escape(id)}"]`) ?? $("#tpl-flash");
    if (st) st.textContent = "Deleting…";
    let r, j;
    try {
      r = await fetch(`/api/designs/${encodeURIComponent(id)}`, { method: "DELETE", signal });
      j = await r.json().catch(() => ({}));
    } catch (err) { if (signal.aborted) return; if (st) st.textContent = `✗ delete failed — ${err.message}`; return; }
    if (signal.aborted) return;
    if (!r.ok) { if (st) st.textContent = `✗ ${j.error ?? `delete failed (${r.status})`}`; return; }
    flash = `✓ Deleted ${id}.`;
    await load();
  }

  async function deleteRoute(rid) {
    const n = issuedRoute[rid] ?? 0;
    if (!confirm(`Delete route "${rid}"?${n ? ` The ${n} pass${n === 1 ? "" : "es"} already issued from it keep working.` : ""}`)) return;
    let r;
    try { r = await fetch(`/api/routes/${encodeURIComponent(rid)}`, { method: "DELETE", signal }); }
    catch { if (signal.aborted) return; flash = "✗ API offline"; render(); return; }
    if (signal.aborted) return;
    flash = r.ok ? `✓ Deleted route ${rid}.` : `✗ Couldn’t delete route ${rid} (${r.status}).`;
    await load();
  }

  async function moveRoute(rid, target) {
    const r0 = routes.find(r => r.id === rid);
    const [kind, ...rest] = target.split(":");
    if (!r0 || !kind || !rest.length) return;
    const { id: _id, ...body } = r0;
    body.template = { kind, id: rest.join(":") };
    let r, j;
    try {
      r = await fetch(`/api/routes/${encodeURIComponent(rid)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
      j = await r.json().catch(() => ({}));
    } catch { if (signal.aborted) return; flash = "✗ API offline"; render(); return; }
    if (signal.aborted) return;
    flash = r.ok ? `✓ Moved ${rid} to ${body.template.id}.` : `✗ ${j.error ?? `move failed (${r.status})`}`;
    await load();
  }

  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (!t || !root.contains(t)) return;
    const { act, id, kind } = t.dataset;
    if (act === "route-issue") { onIssue?.(id, kind, t.dataset.routeId); return; }
    if (act === "route-edit") { onRoute?.(id, kind, t.dataset.routeId); return; }
    if (act === "route-new") { onRoute?.(id, kind); return; }
    if (act === "route-del") { deleteRoute(t.dataset.routeId); return; }
    if (act === "upload") { $("#tpl-file")?.click(); return; }
    if (act === "new-design") { onNewDesign?.(); return; }
    if (act === "issue") { onIssue?.(id, kind ?? "designer"); return; }
    if (act === "edit-design") { onEditDesign?.(id); return; }
    if (act === "bindings") { openBindings(id, kind ?? "designer"); return; }
    if (act === "back") { mode = { view: "shelf" }; draft = null; render(); return; }
    if (act === "tpl-del") { deleteTemplate(id); return; }
    if (act === "design-del") { deleteDesign(id); return; }
    if (act === "bind-save") { saveBindings(); return; }
    if (act === "bind-reset") { resetBindings(); return; }
    if (act === "bind-add") {
      const sem = $("select[data-add-sem]")?.value, field = $("select[data-add-field]")?.value;
      if (!sem || !field) return;
      draft = { ...draft, [sem]: field };
      renderBindings();
    }
  }, { signal });

  // Hovering a bindings row lights the matching field on the thumbnail.
  root.addEventListener("mouseover", (e) => {
    const row = e.target.closest?.("[data-sem-row]");
    const thumb = root.querySelector('[data-thumb="bind"]');
    if (!thumb) return;
    for (const f of thumb.querySelectorAll(".wallet-field--clickable.is-hi")) f.classList.remove("is-hi");
    if (!row?.dataset.field) return;
    for (const f of thumb.querySelectorAll(`[data-fieldkey="${CSS.escape(row.dataset.field)}"]`)) f.classList.add("is-hi");
  }, { signal });

  root.addEventListener("change", (e) => {
    if (e.target.id === "tpl-file") { upload(e.target.files?.[0]); e.target.value = ""; return; }
    if (e.target.dataset?.routeMove && e.target.value) { moveRoute(e.target.dataset.routeMove, e.target.value); return; }
    const sem = e.target.dataset?.bindSem;
    if (sem) {
      if (e.target.value) draft = { ...draft, [sem]: e.target.value };
      else { const { [sem]: _drop, ...rest } = draft; draft = rest; }
      renderBindings();
      root.querySelector(`select[data-bind-sem="${CSS.escape(sem)}"]`)?.focus();
    }
  }, { signal });

  load();
}

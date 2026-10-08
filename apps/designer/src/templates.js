import { esc } from "./esc.js";
import { BOARDING_SEMANTICS } from "@wpd/pass-builder/semantics.js";
import { toPassView } from "./preview/wallet/model.js";
import { renderFront } from "./preview/wallet/card.js";
import "./preview/wallet/wallet.css";

// Templates view — one shelf for both kinds of template:
//   designer: a Pass Designer `.pkpasstemplate` bundle (GET /api/templates)
//   studio:   a design saved from the in-app Design view (GET /api/studio-templates,
//             backed by fixtures/*.json)
// plus the Bindings review screen for a designer template (semanticKey → fieldKey,
// PUT /api/templates/:id/bindings). Uploading a bundle lands on its Bindings screen.

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

/** Bindings the server guessed (anything not user-confirmed / field-declared). */
export const guessCount = (bindings) =>
  Object.values(bindings ?? {}).filter(b => b && b.confidence !== "high").length;

const confidenceLabel = (b) => {
  if (!b) return { cls: "un", text: "new" };
  if (b.source === "manual") return { cls: "hi", text: "confirmed" };
  if (b.confidence === "high") return { cls: "hi", text: "declared" };
  const how = { "value-match": "value match", "date-proximity": "±120 s", "seat-composite": "composite", "name-match": "name match" }[b.source] ?? b.source;
  return { cls: "lo", text: `guess · ${how}` };
};

const fmtSample = (v) => {
  if (v === undefined || v === null || v === "") return "—";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
};

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

export function mountTemplates(root, { onIssue, onEditDesign, onNewDesign, bindingsFor } = {}) {
  root._mountAbort?.abort();
  const { signal } = (root._mountAbort = new AbortController());

  let designer = [];      // GET /api/templates
  let studio = [];        // GET /api/studio-templates
  let issued = {};        // template id → issued pass count
  let mode = bindingsFor ? { view: "bindings", id: bindingsFor } : { view: "shelf" };
  let draft = null;       // bindings screen: { semanticKey: fieldKey }; null = seed from server
  let flash = "";         // one-shot status line on the shelf

  const $ = (s) => root.querySelector(s);

  // ---- data -----------------------------------------------------------------
  async function load() {
    if (signal.aborted) return;
    if (!designer.length && !studio.length) root.innerHTML = `<div class="view"><p class="empty">Loading templates…</p></div>`;
    const get = (u) => fetch(u, { signal }).then(r => r.json());
    let d, s, p;
    try { [d, s, p] = await Promise.all([get("/api/templates"), get("/api/studio-templates").catch(() => []), get("/api/passes").catch(() => [])]); }
    catch { if (signal.aborted) return; root.innerHTML = `<div class="view"><p class="empty">API offline.</p></div>`; return; }
    if (signal.aborted) return;
    designer = Array.isArray(d) ? d : [];
    studio = Array.isArray(s) ? s : [];
    issued = {};
    for (const pass of Array.isArray(p) ? p : []) if (pass.template) issued[pass.template] = (issued[pass.template] ?? 0) + 1;
    render();
  }

  // ---- shelf ----------------------------------------------------------------
  function designerCard(t) {
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
      <div class="tpl-chips"><span class="kind-chip">Pass Designer</span>${guesses ? `<button type="button" class="kind-chip kind-chip--warn" data-act="bindings" data-id="${esc(t.id)}">${guesses} binding${guesses === 1 ? "" : "s"} to confirm</button>` : ""}</div>
      <div class="tpl-acts">
        <button type="button" class="btn-link" data-act="bindings" data-id="${esc(t.id)}">Bindings</button>
        <button type="button" class="btn-link danger" data-act="tpl-del" data-id="${esc(t.id)}">Delete</button>
        <button type="button" class="btn btn-primary btn-sm" data-act="issue" data-id="${esc(t.id)}">Issue →</button>
      </div>
      <div class="tpl-status" data-tpl-status="${esc(t.id)}"></div>
    </article>`;
  }

  function studioCard(t) {
    if (t.error) {
      return `<article class="tpl-card is-broken" data-tpl="${esc(t.id)}" data-kind="studio">
        <div class="tpl-thumb tpl-thumb--broken">⚠</div>
        <div class="tpl-meta"><div class="tpl-name">${esc(t.id)}</div><div class="tpl-sub">Design won’t build: ${esc(t.error)}</div></div>
      </article>`;
    }
    // No Delete for studio designs: they live in fixtures/, which also holds the
    // repo's tracked regression fixtures (CI builds and schema-checks them).
    return `<article class="tpl-card" data-tpl="${esc(t.id)}" data-kind="studio">
      <div class="tpl-thumb" data-thumb="studio:${esc(t.id)}"></div>
      <div class="tpl-meta">
        <div class="tpl-name">${esc(t.organizationName || t.id)}</div>
        <div class="tpl-sub">${esc(t.id)}${t.description ? ` · ${esc(t.description)}` : ""}</div>
      </div>
      <div class="tpl-chips"><span class="kind-chip kind-chip--studio">Studio design</span></div>
      <div class="tpl-acts">
        <span class="tpl-note" title="The rebuilt Issue flow will issue straight from studio designs">Issue from the design editor for now</span>
        <button type="button" class="btn btn-primary btn-sm" data-act="edit-design" data-id="${esc(t.id)}">Edit design</button>
      </div>
    </article>`;
  }

  function renderShelf() {
    const designerCards = designer.map(designerCard).join("");
    const studioCards = studio.map(studioCard).join("");
    root.innerHTML = `
      <div class="view tpl-view">
        <div class="view-head">
          <div><h1>Templates</h1><p class="view-sub">A template is a look plus default fields. Issue passes from a Pass Designer template, or design your own.</p></div>
          <div class="tpl-head-acts">
            <input type="file" accept=".zip" id="tpl-file" hidden />
            <button type="button" class="btn" data-act="upload">Upload .pkpasstemplate</button>
            <button type="button" class="btn btn-primary" data-act="new-design">New design</button>
          </div>
        </div>
        <p class="tpl-flash" id="tpl-flash">${esc(flash)}</p>
        <section class="tpl-section">
          <div class="eyebrow">Pass Designer · ${designer.length}</div>
          <div class="tpl-grid stagger">
            ${designerCards}
            <button type="button" class="tpl-card tpl-card--new" data-act="upload"><b>+</b><span>Upload a .pkpasstemplate</span><small>zip the bundle from Pass Designer</small></button>
          </div>
        </section>
        <section class="tpl-section">
          <div class="eyebrow">Studio designs · ${studio.length}</div>
          <div class="tpl-grid stagger">
            ${studioCards}
            <button type="button" class="tpl-card tpl-card--new" data-act="new-design"><b>+</b><span>Design a new look</span><small>build one in the Design editor</small></button>
          </div>
        </section>
      </div>`;
    flash = "";
    for (const t of designer) if (!t.error) mountThumb($(`[data-thumb="designer:${CSS.escape(t.id)}"]`), t.preview, t.logo);
    for (const t of studio) if (!t.error) mountThumb($(`[data-thumb="studio:${CSS.escape(t.id)}"]`), t.preview, t.logo);
  }

  // ---- bindings -------------------------------------------------------------
  function renderBindings() {
    const t = designer.find(x => x.id === mode.id && !x.error);
    if (!t) { flash = `Template "${mode.id ?? ""}" isn’t installed.`; mode = { view: "shelf" }; renderShelf(); return; }
    const samples = fieldSamples(t.preview);
    const fieldOpts = (sel) => [""].concat(t.fieldKeys ?? []).map(k =>
      `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(k || "— unbound")}</option>`).join("");
    const rows = Object.keys(draft).sort().map(sem => {
      const b = t.bindings?.[sem];
      const conf = b && b.fieldKey === draft[sem] ? confidenceLabel(b) : { cls: "hi", text: "edited" };
      return `<tr data-sem-row="${esc(sem)}">
        <td><code>${esc(sem)}</code></td>
        <td><select class="bind-sel ${conf.cls === "lo" ? "is-guess" : ""}" data-bind-sem="${esc(sem)}">${fieldOpts(draft[sem])}</select></td>
        <td><span class="conf conf--${conf.cls}">${esc(conf.text)}</span></td>
        <td class="bind-sample">${esc(fmtSample(samples[draft[sem]]))}</td>
      </tr>`;
    }).join("");
    const unbound = SEMANTIC_KEYS.filter(k => !draft[k]);
    const guesses = Object.keys(draft).filter(sem => { const b = t.bindings?.[sem]; return b && b.fieldKey === draft[sem] && b.confidence !== "high"; }).length;
    const hasBaseIcon = (t.assets ?? []).includes("icon.png");
    root.innerHTML = `
      <div class="view tpl-view">
        <div class="view-head">
          <div><button type="button" class="btn-link" data-act="back">‹ Templates</button>
            <h1>${esc(t.id)} · bindings</h1>
            <p class="view-sub">${(t.fieldKeys ?? []).length} fields · ${Object.keys(draft).length} bound${guesses ? ` · <b class="warn-text">${guesses} guess${guesses === 1 ? "" : "es"} to confirm</b>` : ""}</p></div>
          <div class="tpl-head-acts">
            <button type="button" class="btn" data-act="back">Later</button>
            <button type="button" class="btn btn-primary" data-act="bind-save">Confirm bindings</button>
          </div>
        </div>
        <div class="bind-split">
          <div class="card bind-card stagger">
            <p class="bind-explain">Apple’s semantic tags are a fixed vocabulary; this template’s field keys are its own. Each binding says which visible field shows a semantic, so a status push updates both. Unbound tags still render on iOS 26 from semantics alone.</p>
            <table class="bind-table">
              <thead><tr><th>Apple semantic</th><th>Template field</th><th>Confidence</th><th>Sample</th></tr></thead>
              <tbody>${rows || `<tr><td colspan="4" class="empty">No bindings yet — add one below.</td></tr>`}</tbody>
            </table>
            <div class="bind-add">
              <select data-add-sem><option value="">+ bind a semantic…</option>${unbound.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}</select>
              <select data-add-field>${fieldOpts("")}</select>
              <button type="button" class="btn btn-sm" data-act="bind-add">Add</button>
              <span class="tpl-status" id="bind-status"></span>
            </div>
          </div>
          <aside class="bind-side">
            <div class="eyebrow">Preview · sample values</div>
            <div class="bind-thumb" data-thumb="bind"></div>
            <div class="eyebrow" style="margin-top:20px">Bundle</div>
            <div class="kv"><span>pass.json</span>${(t.fieldKeys ?? []).length} fields</div>
            <div class="kv"><span>Images</span>${esc((t.assets ?? []).filter(a => /\.png$/i.test(a)).join(", ") || "none")}</div>
            <div class="kv"><span>Base icon.png</span>${hasBaseIcon ? "included" : `<span class="ok-text">synthesized from @2x</span>`}</div>
            <div class="kv"><span>Issued from it</span>${issued[t.id] ?? 0}</div>
            <button type="button" class="btn btn-sm" style="margin-top:16px" data-act="issue" data-id="${esc(t.id)}">Issue from this template →</button>
          </aside>
        </div>
      </div>`;
    mountThumb($('[data-thumb="bind"]'), t.preview, t.logo);
  }

  function openBindings(id) {
    const t = designer.find(x => x.id === id);
    draft = Object.fromEntries(Object.entries(t?.bindings ?? {}).map(([sem, b]) => [sem, b.fieldKey]));
    mode = { view: "bindings", id };
    render();
  }

  function render() {
    if (mode.view === "bindings") {
      if (draft === null) {
        const t = designer.find(x => x.id === mode.id);
        draft = Object.fromEntries(Object.entries(t?.bindings ?? {}).map(([sem, b]) => [sem, b.fieldKey]));
      }
      renderBindings();
    } else renderShelf();
  }

  // ---- actions --------------------------------------------------------------
  async function saveBindings() {
    const id = mode.id;
    const status = $("#bind-status");
    if (status) status.textContent = "Saving…";
    let r, j;
    try {
      r = await fetch(`/api/templates/${encodeURIComponent(id)}/bindings`, {
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

  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (!t || !root.contains(t)) return;
    const { act, id } = t.dataset;
    if (act === "upload") { $("#tpl-file")?.click(); return; }
    if (act === "new-design") { onNewDesign?.(); return; }
    if (act === "issue") { onIssue?.(id); return; }
    if (act === "edit-design") { onEditDesign?.(id); return; }
    if (act === "bindings") { openBindings(id); return; }
    if (act === "back") { mode = { view: "shelf" }; draft = null; render(); return; }
    if (act === "tpl-del") { deleteTemplate(id); return; }
    if (act === "bind-save") { saveBindings(); return; }
    if (act === "bind-add") {
      const sem = $("select[data-add-sem]")?.value, field = $("select[data-add-field]")?.value;
      if (!sem || !field) return;
      draft = { ...draft, [sem]: field };
      renderBindings();
    }
  }, { signal });

  root.addEventListener("change", (e) => {
    if (e.target.id === "tpl-file") { upload(e.target.files?.[0]); e.target.value = ""; return; }
    const sem = e.target.dataset?.bindSem;
    if (sem) {
      if (e.target.value) draft = { ...draft, [sem]: e.target.value };
      else { const { [sem]: _drop, ...rest } = draft; draft = rest; }
      renderBindings();
    }
  }, { signal });

  load();
}

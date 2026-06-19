import bwipjs from "bwip-js";
import { BOARDING_SEMANTICS } from "@wpd/pass-builder/semantics.js";
import { esc } from "./esc.js";
import { harvestSemantics, renderSemanticsEditor } from "./semantics-editor.js";
import { suggestDisplayValues } from "@wpd/pass-builder/suggest.js";
import { kindAttrs, validateFieldValue } from "@wpd/pass-builder/field-kinds.js";
import { renderTypedInput } from "./inputs.js";
import { parseBCBP, bcbpToSemantics } from "@wpd/pass-builder/bcbp.js";
import { showBcbpPreview } from "./bcbp-preview.js";
import { scanBarcode } from "./scan.js";

// The boarding semantic subset offered in the bindings editor — structured
// keys included (seats/passengerName decompose at issue time).
const SEMANTIC_KEYS = Object.keys(BOARDING_SEMANTICS);

// Issue view — issue template-backed passes from the browser: pick an
// installed .pkpasstemplate, name the trip (groupId), fill one row per
// passenger (inputs generated from the template's field keys), then one
// POST /api/passes per row with per-row success/error inline.

const SERIAL_PAD = 3;

/**
 * Compose the trip groupId the server requires for template passes,
 * e.g. ("RP247", "2026-06-20") → "RP247@2026-06-20".
 * @returns {string} empty when either piece is missing
 */
export function composeGroupId(flight, date) {
  const f = (flight ?? "").trim().toUpperCase();
  const d = (date ?? "").trim();
  return f && d ? `${f}@${d}` : "";
}

/**
 * Suggested serial for passenger row n (1-based): <groupId>-<NNN>.
 * Serials are caller-supplied in the template flow; this is only a default.
 * @returns {string} empty when there is no groupId yet
 */
export function suggestSerial(groupId, n) {
  const g = (groupId ?? "").trim();
  return g ? `${g}-${String(n).padStart(SERIAL_PAD, "0")}` : "";
}

/**
 * Map one passenger row to the POST /api/passes template body.
 * Values are plain strings at issue time (the {value, changeMessage} object
 * form is for updates); empty inputs are left out so template defaults apply.
 */
export function buildIssueRequest({ template, groupId, serial, values, semantics, barcodeMessage }) {
  const data = {};
  for (const [key, raw] of Object.entries(values ?? {})) {
    const v = (raw ?? "").trim();
    if (v) data[key] = v;
  }
  const sem = harvestSemantics(semantics ?? {});
  if (Object.keys(sem).length) data.semantics = sem;
  const bc = (barcodeMessage ?? "").trim();
  if (bc) data.barcodeMessage = bc;
  return { template, serialNumber: (serial ?? "").trim(), groupId: (groupId ?? "").trim(), data };
}

/**
 * One-line per-row summary of an issue response. Errors (e.g. unknown field
 * keys from the dry-run merge) are surfaced verbatim.
 * @returns {string} plain text — esc() before any innerHTML use
 */
export function describeIssueResult(ok, j) {
  return ok ? "✓ issued" : `✗ ${j?.error ?? "error"}`;
}

// Semantics that naturally vary per passenger. Used only to pre-select which
// template fields START "per-passenger" in the trip editor — read from the
// template's discovered bindings, never by guessing field-key names (polarity
// rule: field keys are the template's arbitrary vocabulary).
const PER_PASSENGER_SEMANTICS = ["passengerName", "seats", "boardingSequenceNumber"];

/**
 * Field keys that should default to per-passenger for a template, derived from
 * its semanticKey→{fieldKey} bindings. Everything else defaults to shared.
 * @returns {string[]}
 */
export function defaultIndividualKeys(bindings) {
  const out = [];
  for (const sem of PER_PASSENGER_SEMANTICS) {
    const fk = bindings?.[sem]?.fieldKey;
    if (fk) out.push(fk);
  }
  return out;
}

/**
 * Compose one passenger row's issue values: the trip's shared field values,
 * overlaid with this row's values for the keys marked individual. A shared
 * value for a key that is individual is dropped — it belongs to the row, not
 * the trip — so re-sharing never leaks a stale per-passenger value.
 * @returns {Record<string,string>}
 */
export function mergeTripValues(sharedValues = {}, rowValues = {}, individualKeys = []) {
  const ind = individualKeys instanceof Set ? individualKeys : new Set(individualKeys);
  const out = {};
  for (const [k, v] of Object.entries(sharedValues)) if (!ind.has(k)) out[k] = v;
  for (const k of ind) if (rowValues[k] !== undefined) out[k] = rowValues[k];
  return out;
}

export function mountIssue(root, showManage) {
  // Re-mounted on every tab visit — drop the previous mount's listeners or
  // one click would fire issueAll() once per visit (duplicate POSTs).
  root._mountAbort?.abort();
  const { signal } = (root._mountAbort = new AbortController());

  let templates = [];        // [{ id, fieldKeys, bindings, assets, error? }]
  let selected = null;       // template id
  let groupId = "";
  let rows = [{ values: {}, serial: "", serialEdited: false, semantics: {} }];
  // Per-template unsaved binding edits: { tplId: { semanticKey: fieldKey } }.
  // Seeded from the server's discovered/stored map on load; PUT on save.
  let bindingDrafts = {};
  // Trip individualization: which template field keys vary per passenger (the
  // rest are shared and entered once). `shared` holds the shared field values.
  let individualKeys = new Set();
  let shared = {};
  let fieldsInitFor = null;    // template id whose shared/individual split is seeded
  let baseSemantics = {};      // the selected template's baked semantics (editor seed)
  // Serials already issued (GET /api/passes). Apple requires serialNumber to be
  // unique per pass type — re-posting one UPDATES that pass rather than creating
  // a new one, so we warn before an issue would silently overwrite an existing one.
  let existingSerials = new Set();

  const $ = (sel) => root.querySelector(sel);
  const current = () => templates.find(t => t.id === selected);
  // A field's full descriptor (kind/required/affordances), server-derived in
  // templateFieldDescriptors by resolving the field's bound semantic. Defaults
  // to free text for an unknown key.
  const descriptorFor = (k) => current()?.fields?.find(f => f.key === k) ?? { key: k, kind: "text", required: false };
  // A field's expected input type: "date" fields hold ISO-8601 and get a
  // datetime picker so a mistyped value can't ship a pass iOS won't install;
  // iata/number/seat get their own affordance; everything else is free text.
  const fieldKind = (k) => descriptorFor(k).kind;

  // HTML attribute string for a non-date input, from the kind's affordances.
  function inputAttrs(kind) {
    const a = kindAttrs(kind);
    const out = [`data-kind="${esc(kind)}"`];
    if (a.maxLength) out.push(`maxlength="${a.maxLength}"`);
    if (a.inputmode) out.push(`inputmode="${esc(a.inputmode)}"`);
    return out.join(" ");
  }
  const errMsg = (k, value) => {
    const d = descriptorFor(k);
    return validateFieldValue({ kind: d.kind, required: d.required }, value);
  };
  const setErr = (span, msg) => { if (span) { span.textContent = msg ?? ""; span.classList.toggle("show", Boolean(msg)); } };
  const sharedErrSpan = (k) => root.querySelector(`[data-err-shared="${CSS.escape(k)}"]`);
  const rowErrSpan = (i, k) => root.querySelector(`.iss-row[data-i="${i}"] [data-err-key="${CSS.escape(k)}"]`);
  const serialErrSpan = (i) => root.querySelector(`.iss-row[data-i="${i}"] [data-err-serial]`);
  const DUP_SERIAL_MSG = "duplicate serial — each pass needs a unique serial";
  // Row indices whose (trimmed, non-empty) serial duplicates another row's. Two
  // rows sharing a serial would silently overwrite each other at issue time —
  // Apple keys a pass by serialNumber + passTypeId — so it is always a mistake.
  function serialDuplicateIndices() {
    const seen = new Map(); const dup = new Set();
    for (const inp of root.querySelectorAll("input[data-serial]")) {
      const i = Number(inp.closest(".iss-row").dataset.i);
      const v = (inp.value ?? "").trim();
      if (!v) continue;
      if (seen.has(v)) { dup.add(i); dup.add(seen.get(v)); } else seen.set(v, i);
    }
    return dup;
  }
  function refreshSerialErrors() {
    for (const span of root.querySelectorAll("[data-err-serial]")) setErr(span, "");
    for (const i of serialDuplicateIndices()) setErr(serialErrSpan(i), DUP_SERIAL_MSG);
  }
  // The error slot for a given typed input element (shared or row-scoped).
  const spanOf = (inp) => inp.dataset.sharedKey
    ? sharedErrSpan(inp.dataset.sharedKey)
    : (inp.closest(".iss-row") ? rowErrSpan(Number(inp.closest(".iss-row").dataset.i), inp.dataset.key) : null);
  // While typing: clear an already-shown error the moment the value becomes
  // valid, but don't surface a new error mid-keystroke (that waits for blur).
  const liveClearError = (inp) => {
    const span = spanOf(inp);
    if (span?.classList.contains("show")) setErr(span, errMsg(inp.dataset.sharedKey ?? inp.dataset.key, inp.value));
  };

  // The shared/individual field controls + their inline-error slots. A date
  // field keeps the typed picker (mounted post-render); the rest are plain
  // inputs carrying their kind's affordances.
  function sharedFieldHtml(k) {
    const control = fieldKind(k) === "date"
      ? `<div class="iss-typed" data-typed-shared="${esc(k)}" title="${esc(k)} (ISO-8601)"></div>`
      : `<input data-shared-key="${esc(k)}" ${inputAttrs(fieldKind(k))} placeholder="${esc(k)}" value="${esc(shared[k] ?? "")}" />`;
    return `${control}<span class="field-err" data-err-shared="${esc(k)}"></span>`;
  }
  function rowFieldHtml(k, r, i) {
    const control = fieldKind(k) === "date"
      ? `<div class="iss-typed" data-typed-key="${esc(k)}" data-i="${i}" title="${esc(k)} (ISO-8601)"></div>`
      : `<input data-key="${esc(k)}" ${inputAttrs(fieldKind(k))} placeholder="${esc(k)}" value="${esc(r.values[k] ?? "")}" />`;
    return `<span class="iss-field">${control}<span class="field-err" data-err-key="${esc(k)}"></span></span>`;
  }

  // Every invalid field across the trip, reading text inputs from the DOM and
  // date fields from state (their pickers write straight to state). Required-
  // but-empty fields count as invalid so the Issue button stays disabled.
  function collectValidationErrors() {
    const tpl = current();
    if (!tpl || tpl.error) return [];
    const errs = [];
    const sharedKeys = (tpl.fieldKeys ?? []).filter(k => !individualKeys.has(k));
    for (const k of sharedKeys) {
      const v = fieldKind(k) === "date" ? shared[k] : (root.querySelector(`input[data-shared-key="${CSS.escape(k)}"]`)?.value ?? shared[k] ?? "");
      const msg = errMsg(k, v);
      if (msg) errs.push({ scope: "shared", key: k, msg });
    }
    const indKeys = (tpl.fieldKeys ?? []).filter(k => individualKeys.has(k));
    rows.forEach((r, i) => {
      const rowEl = root.querySelector(`.iss-row[data-i="${i}"]`);
      for (const k of indKeys) {
        const v = fieldKind(k) === "date" ? r.values[k] : (rowEl?.querySelector(`input[data-key="${CSS.escape(k)}"]`)?.value ?? r.values[k] ?? "");
        const msg = errMsg(k, v);
        if (msg) errs.push({ scope: "row", i, key: k, msg });
      }
    });
    for (const i of serialDuplicateIndices()) errs.push({ scope: "serial", i, msg: DUP_SERIAL_MSG });
    return errs;
  }

  // Disable the Issue button while anything is invalid, with a visible reason.
  function refreshGate() {
    const btn = root.querySelector('button[data-act="issue"]');
    if (!btn) return;
    const errs = collectValidationErrors();
    btn.disabled = errs.length > 0;
    const reason = root.querySelector("#iss-gate-reason");
    if (reason) reason.textContent = errs.length ? `Fix ${errs.length} field(s) before issuing` : "";
  }

  // Render an error beside every offending field (used on submit).
  function showAllErrors() {
    for (const span of root.querySelectorAll(".field-err")) setErr(span, "");
    const errs = collectValidationErrors();
    for (const e of errs) setErr(
      e.scope === "shared" ? sharedErrSpan(e.key)
        : e.scope === "serial" ? serialErrSpan(e.i)
          : rowErrSpan(e.i, e.key), e.msg);
    refreshGate();
    return errs;
  }

  function reSuggestSerials() {
    rows = rows.map((r, i) => r.serialEdited ? r : { ...r, serial: suggestSerial(groupId, i + 1) });
  }

  // Seed the shared/individual split once per template (from its bindings), so
  // re-renders and reloads (upload/delete/save-bindings) keep the user's toggles.
  function ensureFieldDefaults() {
    if (fieldsInitFor === selected) return;
    individualKeys = new Set(defaultIndividualKeys(current()?.bindings));
    shared = {};
    baseSemantics = current()?.semantics ?? {};
    // Seed each row's semantics editor from the template's baked block (a row the
    // user has already edited keeps its own).
    rows = rows.map(r => (Object.keys(r.semantics ?? {}).length ? r : { ...r, semantics: { ...baseSemantics } }));
    fieldsInitFor = selected;
  }

  function syncFromInputs() {
    groupId = $("#iss-group")?.value ?? groupId;
    const nextShared = { ...shared };
    for (const inp of root.querySelectorAll("input[data-shared-key]")) nextShared[inp.dataset.sharedKey] = inp.value;
    shared = nextShared;
    rows = rows.map((r, i) => {
      const rowEl = root.querySelector(`.iss-row[data-i="${i}"]`);
      if (!rowEl) return r;
      const values = { ...r.values };   // preserve values for keys not shown (toggled to shared)
      for (const inp of rowEl.querySelectorAll("input[data-key]")) values[inp.dataset.key] = inp.value;
      return { ...r, values, serial: rowEl.querySelector("input[data-serial]")?.value ?? r.serial };
    });
  }

  function rowHtml(r, i) {
    const fields = (current()?.fieldKeys ?? []).filter(k => individualKeys.has(k)).map(k => rowFieldHtml(k, r, i)).join("");
    return `
      <div class="iss-row mg-row" data-i="${i}">
        <div class="iss-sem-wrap">
          <div class="iss-sem" data-sem-row="${i}"></div>
          <button data-act="suggest" data-i="${i}" class="iss-toggle" title="fill the display fields below from these semantics">Suggest values ↓</button>
          <button data-scan-row="${i}" class="iss-toggle" title="scan or paste a boarding pass barcode to autofill this row">📷 Scan / paste boarding pass</button>
        </div>
        <div class="iss-fields">
          ${fields}
          <input data-serial placeholder="serial" value="${esc(r.serial)}" class="iss-serial" title="Serial number (caller-supplied; suggested from the trip id) — must be unique per pass" />
          <span class="field-err" data-err-serial="${i}"></span>
          <button data-act="rm" data-i="${i}" ${rows.length === 1 ? "disabled" : ""} title="remove">✕</button>
        </div>
        <div class="mg-status" data-row-status="${i}"></div>
      </div>`;
  }

  // Binding editor for one template: a dropdown per bound semantic (field
  // keys × the boarding semantic subset), an add row for unbound semantics,
  // and a save → PUT /api/templates/:id/bindings. Unbound is informational —
  // iOS 26 renders the semantic scheme from semantics, bound field or not.
  function bindingsEditor(t) {
    const draft = bindingDrafts[t.id] ?? {};
    const fieldOptions = (sel) => [""].concat(t.fieldKeys ?? []).map(k =>
      `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(k || "(unbound)")}</option>`).join("");
    const guessed = (sem) => {
      const b = t.bindings?.[sem];
      return b && b.fieldKey === draft[sem] && b.confidence !== "high"
        ? ` <span class="mg-badge" title="auto-discovered from the template's sample values (${esc(b.source)})">guess</span>` : "";
    };
    const bound = Object.keys(draft).sort().map(sem => `
      <div class="live-row tpl-bind-row">
        <label><code>${esc(sem)}</code>${guessed(sem)}</label>
        <select data-bind-sem="${esc(sem)}" data-tpl="${esc(t.id)}">${fieldOptions(draft[sem])}</select>
      </div>`).join("");
    const unbound = SEMANTIC_KEYS.filter(k => !draft[k]);
    return `
      <details class="tpl-bindings">
        <summary>Bindings: ${Object.keys(draft).length} bound · ${unbound.length} unbound (informational)</summary>
        ${bound || `<p class="hint">No bindings yet — add one below.</p>`}
        <div class="live-row tpl-bind-row">
          <select data-add-sem data-tpl="${esc(t.id)}">
            <option value="">+ bind semantic…</option>
            ${unbound.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}
          </select>
          <select data-add-field data-tpl="${esc(t.id)}">${fieldOptions("")}</select>
          <button data-act="bind-add" data-id="${esc(t.id)}">Add</button>
          <button data-act="bind-save" data-id="${esc(t.id)}">Save bindings</button>
          <span class="mg-grp-status" data-bind-status="${esc(t.id)}"></span>
        </div>
        <p class="hint">Unbound semantics still update on push — modern devices render from semantics; a bound field also updates the classic layout.</p>
      </details>`;
  }

  function templatesCard() {
    const rows = templates.map(t => `
      <div class="mg-row">
        <div class="mg-info">
          <b>${esc(t.id)}</b>
          ${t.error
            ? `<span class="mg-badge" style="background:#fdf1f2;color:#c0182f">broken: ${esc(t.error)}</span>`
            : `· ${(t.fieldKeys ?? []).length} field key(s) · ${(t.assets ?? []).length} asset(s)`}
          ${t.error ? "" : bindingsEditor(t)}
        </div>
        <div class="mg-acts">
          <button data-act="tpl-del" data-id="${esc(t.id)}" class="danger">Delete</button>
        </div>
      </div>`).join("");
    return `
      <div class="mg-card">
        <div class="mg-card-head">
          <div class="mg-trip"><span class="mg-trip-id">Templates</span><span class="mg-badge">${templates.length} installed</span></div>
        </div>
        <div class="mg-list">${rows || `<p class="mg-empty">None installed — see <code>templates/README.md</code>.</p>`}</div>
        <div class="mg-editor-acts">
          <input id="tpl-id" placeholder="id (defaults to file name)" />
          <input id="tpl-file" type="file" accept=".zip" />
          <button data-act="tpl-upload">Upload zipped .pkpasstemplate</button>
          <span class="mg-grp-status" id="tpl-status"></span>
        </div>
      </div>`;
  }

  function render() {
    const tpl = current();
    ensureFieldDefaults();
    const sharedKeys = (tpl?.fieldKeys ?? []).filter(k => !individualKeys.has(k));
    const indKeys = (tpl?.fieldKeys ?? []).filter(k => individualKeys.has(k));
    const sharedCard = tpl && !tpl.error ? `
        <div class="mg-card">
          <div class="mg-card-head">
            <div class="mg-trip"><span class="mg-trip-id">Shared across the trip</span><span class="mg-badge">${sharedKeys.length} field(s)</span></div>
          </div>
          <div class="mg-list">
            ${sharedKeys.map(k => `
              <div class="iss-shared-row">
                <label title="${esc(k)}">${esc(k)}</label>
                ${sharedFieldHtml(k)}
                <button data-act="to-individual" data-key="${esc(k)}" class="iss-toggle" title="vary this per passenger">individualize →</button>
              </div>`).join("") || `<p class="hint">No shared fields — every field is per-passenger.</p>`}
          </div>
        </div>` : "";
    const indHeader = indKeys.length
      ? `<div class="iss-colhead">${indKeys.map(k => `<span class="iss-col"><code>${esc(k)}</code> <button data-act="to-shared" data-key="${esc(k)}" class="iss-toggle" title="same for the whole trip">← share</button></span>`).join("")}</div>`
      : `<p class="hint">All fields are shared — click <b>individualize →</b> above to vary a field per passenger (otherwise every passenger is identical except for the serial).</p>`;
    const options = templates.map(t =>
      `<option value="${esc(t.id)}" ${t.id === selected ? "selected" : ""} ${t.error ? "disabled" : ""}>` +
      `${esc(t.id)}${t.error ? " (broken)" : ""}</option>`).join("");

    root.innerHTML = `
      <div class="mg-wrap">
        <div class="mg-head"><h2>Issue passes from a template</h2></div>
        <div class="mg-card">
          <div class="live-row">
            <label>Template</label>
            <select id="iss-tpl" style="flex:1">${options}</select>
          </div>
          ${tpl?.error ? `<p class="hint">✗ ${esc(tpl.error)}</p>` : `
          <p class="hint">Fields: ${(tpl?.fieldKeys ?? []).map(k => `<code>${esc(k)}</code>`).join(" ")}
             · ${tpl?.assets?.length ?? 0} asset(s)</p>`}
          <div class="live-row">
            <label>Trip id</label>
            <input id="iss-group" placeholder='RP247@2026-06-20 (required)' value="${esc(groupId)}" style="flex:1" />
          </div>
          <div class="live-row iss-compose">
            <label class="hint">or compose:</label>
            <input id="iss-flight" placeholder="RP247" />
            <input id="iss-date" type="date" />
            <button data-act="compose">→ Trip id</button>
          </div>
        </div>
        ${sharedCard}
        <div class="mg-card">
          <div class="mg-card-head">
            <div class="mg-trip"><span class="mg-trip-id">Passengers</span><span class="mg-badge">${rows.length} row(s)</span></div>
            <div class="mg-grp-acts"><button data-act="add">+ Add passenger</button></div>
          </div>
          <div class="mg-list">${indHeader}${rows.map(rowHtml).join("")}</div>
          <div class="mg-editor-acts">
            <button data-act="issue">Issue ${rows.length} pass(es)</button>
            <span class="hint" id="iss-gate-reason"></span>
            <span class="mg-grp-status" id="iss-status"></span>
          </div>
        </div>
        ${templatesCard()}
      </div>`;
    mountSemanticsEditors();
    mountTypedFields();
    refreshSerialErrors();   // flag any colliding serials right away
    refreshGate();   // initial button state (required-but-empty fields disable it)
    root.querySelectorAll("[data-scan-row]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const i = Number(btn.dataset.scanRow);
        syncFromInputs();
        const text = await scanBarcode();
        if (!text) return;
        let parsed = null;
        try { parsed = parseBCBP(text); } catch { /* not BCBP */ }
        if (!parsed) { alert("Not a recognized boarding pass — barcode not autofilled."); return; }
        if (!(await showBcbpPreview(parsed))) return;
        rows[i] = {
          ...rows[i],
          semantics: { ...(rows[i].semantics ?? {}), ...bcbpToSemantics(parsed) },
          barcodeMessage: text
        };
        const map = Object.fromEntries(Object.entries(current()?.bindings ?? {}).map(([sem, b]) => [sem, b.fieldKey]));
        rows[i].values = { ...(rows[i].values ?? {}), ...suggestDisplayValues(rows[i].semantics, map) };
        render();
      });
    });
  }

  // Mount typed inputs (currently ISO-8601 date pickers) into their placeholders
  // after render() sets innerHTML — same pattern as mountSemanticsEditors. The
  // picker reports a correctly-formatted value via onChange straight into state,
  // so syncFromInputs (which only reads plain text inputs) leaves them intact.
  function mountTypedFields() {
    for (const ph of root.querySelectorAll("[data-typed-shared]")) {
      const k = ph.dataset.typedShared;
      ph.replaceChildren(renderTypedInput({
        type: "date", value: shared[k],
        onChange: (v) => { shared = { ...shared, [k]: v }; }
      }));
    }
    for (const ph of root.querySelectorAll("[data-typed-key]")) {
      const k = ph.dataset.typedKey, i = Number(ph.dataset.i);
      if (!rows[i]) continue;
      ph.replaceChildren(renderTypedInput({
        type: "date", value: rows[i].values[k],
        onChange: (v) => { rows = rows.map((r, n) => n === i ? { ...r, values: { ...r.values, [k]: v } } : r); }
      }));
    }
  }

  // The semantics editor is a DOM component (typed inputs), so it is mounted into
  // each row's placeholder after render() sets innerHTML — same pattern as drawQrCodes.
  function mountSemanticsEditors() {
    for (const c of root.querySelectorAll("[data-sem-row]")) {
      const i = Number(c.dataset.semRow);
      if (!rows[i]) continue;
      c.replaceChildren(renderSemanticsEditor({
        values: rows[i].semantics ?? {},
        onChange: (next) => { rows = rows.map((r, n) => n === i ? { ...r, semantics: next } : r); }
      }));
    }
  }

  function renderEmpty() {
    root.innerHTML = `
      <div class="mg-wrap">
        <div class="mg-head"><h2>Issue passes from a template</h2></div>
        <p class="mg-empty">No templates installed yet — drop a <code>.pkpasstemplate</code> bundle into
        <code>templates/</code> or upload one below (see <code>templates/README.md</code>).</p>
        ${templatesCard()}
      </div>`;
  }

  function setRowStatus(i, html) {
    const el = root.querySelector(`[data-row-status="${i}"]`);
    if (el) el.innerHTML = html;
  }

  function walletAffordance(serial, updated = false) {
    const url = `${location.origin}/api/passes/${encodeURIComponent(serial)}/pkpass`;
    const label = updated ? "↻ updated existing pass" : "✓ issued";
    return `${label} · <a class="btn wallet" href="${esc(url)}">Add to Wallet</a> <canvas class="iss-qr" data-qr="${esc(url)}" title="Scan with the iPhone"></canvas>`;
  }

  function drawQrCodes() {
    for (const c of root.querySelectorAll("canvas[data-qr]")) {
      try { bwipjs.toCanvas(c, { bcid: "qrcode", text: c.dataset.qr, scale: 2 }); } catch { /* ignore */ }
      c.removeAttribute("data-qr");
    }
  }

  async function issueAll() {
    syncFromInputs();
    const status = $("#iss-status");
    if (!groupId.trim()) { status.textContent = "✗ trip id is required for template passes"; return; }
    const invalid = showAllErrors();
    if (invalid.length) { status.textContent = `✗ fix ${invalid.length} invalid field(s) before issuing`; return; }
    // Apple keys a pass by serialNumber — re-posting an existing serial UPDATES
    // that pass, it does not create a second one. Confirm before doing so by
    // accident; an intentional re-issue (e.g. a gate correction) just says OK.
    const clashes = [...new Set(rows.map(r => (r.serial ?? "").trim()).filter(s => existingSerials.has(s)))];
    if (clashes.length && !confirm(
      `${clashes.length} serial(s) already exist and will be UPDATED, not created:\n\n` +
      `${clashes.join("\n")}\n\nContinue? (Cancel to change the serial and issue a new pass instead.)`)) {
      status.textContent = "✗ cancelled — change the serial(s) to issue new passes";
      return;
    }
    status.textContent = "Issuing…";
    let okCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const values = mergeTripValues(shared, rows[i].values, individualKeys);
      const body = buildIssueRequest({ template: selected, groupId, serial: rows[i].serial, values, semantics: rows[i].semantics, barcodeMessage: rows[i].barcodeMessage });
      if (!body.serialNumber) { setRowStatus(i, "✗ serial is required"); continue; }
      let r, j;
      try {
        r = await fetch("/api/passes", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        j = await r.json().catch(() => ({}));
      } catch { setRowStatus(i, "✗ API offline"); continue; }
      if (r.ok) { okCount++; existingSerials.add(j.serialNumber ?? body.serialNumber); setRowStatus(i, walletAffordance(j.serialNumber, j.created === false)); }
      else setRowStatus(i, esc(describeIssueResult(false, j)));
    }
    drawQrCodes();
    status.innerHTML = okCount
      ? `✓ issued ${okCount}/${rows.length} for <b>${esc(groupId)}</b> · <button data-act="manage">Manage trip →</button>`
      : "✗ nothing issued — fix the rows above";
  }

  async function load() {
    root.innerHTML = `<div class="mg-wrap"><p class="mg-empty">Loading templates…</p></div>`;
    try { templates = await fetch("/api/templates").then(r => r.json()); }
    catch { root.innerHTML = `<div class="mg-wrap"><p class="mg-empty">API offline.</p></div>`; return; }
    if (!Array.isArray(templates)) { renderEmpty(); return; }
    bindingDrafts = Object.fromEntries(templates.filter(t => !t.error).map(t =>
      [t.id, Object.fromEntries(Object.entries(t.bindings ?? {}).map(([sem, b]) => [sem, b.fieldKey]))]));
    if (!templates.length) { renderEmpty(); return; }
    // Existing serials → warn before an issue would silently overwrite a pass.
    try {
      const passes = await fetch("/api/passes").then(r => r.json());
      existingSerials = new Set((Array.isArray(passes) ? passes : []).map(p => p.serial));
    } catch { existingSerials = new Set(); }
    selected ??= (templates.find(t => !t.error) ?? templates[0]).id;
    reSuggestSerials();
    render();
  }

  root.addEventListener("click", (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    if (act === "compose") {
      const gid = composeGroupId($("#iss-flight").value, $("#iss-date").value);
      if (!gid) return;
      syncFromInputs();
      groupId = gid;
      // Composing names a new trip — re-derive every serial, including
      // manually edited ones (they belonged to the old trip id).
      rows = rows.map(r => ({ ...r, serialEdited: false }));
      reSuggestSerials();
      render();
      return;
    }
    if (act === "add") { syncFromInputs(); rows = [...rows, { values: {}, serial: suggestSerial(groupId, rows.length + 1), serialEdited: false, semantics: { ...baseSemantics } }]; render(); return; }
    if (act === "rm")  { syncFromInputs(); rows = rows.filter((_, i) => i !== Number(e.target.dataset.i)); reSuggestSerials(); render(); return; }
    if (act === "to-individual") {
      syncFromInputs();
      const k = e.target.dataset.key;
      individualKeys = new Set(individualKeys); individualKeys.add(k);
      const seed = shared[k] ?? "";                      // start each row from the shared value
      rows = rows.map(r => (r.values[k] ? r : { ...r, values: { ...r.values, [k]: seed } }));
      render();
      return;
    }
    if (act === "to-shared") {
      syncFromInputs();
      const k = e.target.dataset.key;
      const next = new Set(individualKeys); next.delete(k); individualKeys = next;
      if (!shared[k]) {                                  // seed the shared value from the first row that has one
        const firstVal = rows.map(r => r.values[k]).find(v => v != null && v !== "");
        if (firstVal != null) shared = { ...shared, [k]: firstVal };
      }
      render();
      return;
    }
    if (act === "suggest") {
      syncFromInputs();
      const i = Number(e.target.dataset.i);
      const map = Object.fromEntries(Object.entries(current()?.bindings ?? {}).map(([sem, b]) => [sem, b.fieldKey]));
      rows = rows.map((r, n) => n === i ? { ...r, values: { ...r.values, ...suggestDisplayValues(r.semantics, map) } } : r);
      render();
      return;
    }
    if (act === "issue") return issueAll();
    if (act === "manage") return showManage?.();
    if (act === "tpl-upload") return uploadTemplate();
    if (act === "tpl-del") return deleteTemplate(e.target.dataset.id);
    if (act === "bind-add") {
      const id = e.target.dataset.id;
      const sem = root.querySelector(`select[data-add-sem][data-tpl="${CSS.escape(id)}"]`)?.value;
      const field = root.querySelector(`select[data-add-field][data-tpl="${CSS.escape(id)}"]`)?.value;
      if (!sem || !field) return;
      syncFromInputs();
      bindingDrafts = { ...bindingDrafts, [id]: { ...bindingDrafts[id], [sem]: field } };
      render();
      return;
    }
    if (act === "bind-save") return saveBindings(e.target.dataset.id);
  }, { signal });

  async function saveBindings(id) {
    const status = root.querySelector(`[data-bind-status="${CSS.escape(id)}"]`);
    if (status) status.textContent = "Saving…";
    let r, j;
    try {
      r = await fetch(`/api/templates/${encodeURIComponent(id)}/bindings`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bindingDrafts[id] ?? {})
      });
      j = await r.json().catch(() => ({}));
    } catch { if (status) status.textContent = "✗ API offline"; return; }
    if (!r.ok) { if (status) status.textContent = `✗ ${j.error ?? r.status}`; return; }
    syncFromInputs();
    await load();
    const el = root.querySelector(`[data-bind-status="${CSS.escape(id)}"]`);
    if (el) el.textContent = `✓ saved ${Object.keys(j.bindings ?? {}).length} binding(s)`;
  }

  async function uploadTemplate() {
    const status = $("#tpl-status");
    const file = $("#tpl-file").files[0];
    if (!file) { status.textContent = "✗ choose a zipped .pkpasstemplate first"; return; }
    const id = ($("#tpl-id").value.trim() || file.name.replace(/\.zip$/i, "").replace(/\.pkpasstemplate$/i, ""));
    status.textContent = `Uploading ${id}…`;
    let r, j;
    try {
      r = await fetch(`/api/templates/${encodeURIComponent(id)}`, {
        method: "POST", headers: { "Content-Type": "application/zip" }, body: await file.arrayBuffer()
      });
      j = await r.json().catch(() => ({}));
    } catch { status.textContent = "✗ API offline"; return; }
    if (!r.ok) { status.textContent = `✗ ${j.error ?? r.status}`; return; }
    syncFromInputs();
    await load();
    const el = $("#tpl-status");
    if (el) el.textContent = `✓ uploaded "${id}" (${(j.fieldKeys ?? []).length} field keys)`;
  }

  async function deleteTemplate(id) {
    if (!confirm(`Delete template "${id}"? Passes already issued from it keep working only while the bundle exists.`)) return;
    const status = $("#tpl-status");
    let r, j;
    try {
      r = await fetch(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
      j = await r.json().catch(() => ({}));
    } catch { status.textContent = "✗ API offline"; return; }
    if (!r.ok) { status.textContent = `✗ ${j.error ?? r.status}`; return; }
    if (selected === id) selected = null;
    syncFromInputs();
    await load();
    const el = $("#tpl-status");
    if (el) el.textContent = `✓ deleted "${id}"`;
  }

  root.addEventListener("input", (e) => {
    if (e.target.id === "iss-group") {
      groupId = e.target.value;
      syncFromInputs();
      reSuggestSerials();
      for (const rowEl of root.querySelectorAll(".iss-row")) {
        const i = Number(rowEl.dataset.i);
        const inp = rowEl.querySelector("input[data-serial]");
        if (inp && !rows[i].serialEdited) inp.value = rows[i].serial;
      }
      refreshSerialErrors();
      refreshGate();
    }
    if (e.target.matches("input[data-serial]")) {
      const i = Number(e.target.closest(".iss-row").dataset.i);
      rows = rows.map((r, n) => n === i ? { ...r, serialEdited: true } : r);
      refreshSerialErrors();
      refreshGate();
    }
    if (e.target.matches("input[data-kind]")) {
      const inp = e.target;
      if (inp.dataset.kind === "iata" && inp.value !== inp.value.toUpperCase()) {
        const pos = inp.selectionStart;
        inp.value = inp.value.toUpperCase();
        try { inp.setSelectionRange(pos, pos); } catch { /* unfocused / unsupported */ }
      }
      liveClearError(inp);
      refreshGate();
    }
  }, { signal });

  // Validate a typed field when focus leaves it — show the inline error then.
  root.addEventListener("focusout", (e) => {
    const inp = e.target;
    if (!inp?.matches?.("input[data-kind]")) return;
    setErr(spanOf(inp), errMsg(inp.dataset.sharedKey ?? inp.dataset.key, inp.value));
    refreshGate();
  }, { signal });

  root.addEventListener("change", (e) => {
    if (e.target.id === "iss-tpl") { syncFromInputs(); selected = e.target.value; render(); }
    if (e.target.matches("select[data-bind-sem]")) {
      const { bindSem, tpl } = e.target.dataset;
      const draft = { ...bindingDrafts[tpl] };
      if (e.target.value) draft[bindSem] = e.target.value; else delete draft[bindSem];
      bindingDrafts = { ...bindingDrafts, [tpl]: draft };
      if (!e.target.value) { syncFromInputs(); render(); }   // row disappears → re-render
    }
  }, { signal });

  load();
}

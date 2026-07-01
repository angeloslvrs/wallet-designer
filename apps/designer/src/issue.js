import { BOARDING_SEMANTICS, SEMANTIC_CATALOG } from "@wpd/pass-builder/semantics.js";
import { esc } from "./esc.js";
import { harvestSemantics, renderSemanticsEditor } from "./semantics-editor.js";
import { suggestDisplayValues } from "@wpd/pass-builder/suggest.js";
import { kindAttrs, validateFieldValue } from "@wpd/pass-builder/field-kinds.js";
import { renderTypedInput, widgetFor, fieldHint } from "./inputs.js";
import { parseBCBP, bcbpToSemantics } from "@wpd/pass-builder/bcbp.js";
import { showBcbpPreview } from "./bcbp-preview.js";
import { scanBarcode } from "./scan.js";
import { appleWalletButton } from "./wallet-badge.js";

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
export function buildIssueRequest({ template, groupId, serial, values, semantics, barcodeMessage, expirationDate }) {
  const data = {};
  for (const [key, raw] of Object.entries(values ?? {})) {
    const v = (raw ?? "").trim();
    if (v) data[key] = v;
  }
  const sem = harvestSemantics(semantics ?? {});
  if (Object.keys(sem).length) data.semantics = sem;
  const bc = (barcodeMessage ?? "").trim();
  if (bc) data.barcodeMessage = bc;
  const exp = (expirationDate ?? "").trim();
  if (exp) data.expirationDate = exp;
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
  let tripExpiry = "";   // optional ISO-8601 expiry override — blank = server derives arrival + 1

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

  // The widget a field renders with: a typed picker for date and (via its bound
  // semantic) IANA time-zone fields; null means a plain text input.
  const typedWidgetFor = (k) => {
    const d = descriptorFor(k);
    if (/TimeZone$/.test(d.boundSemantic ?? "")) return "timezone";
    if (d.kind === "date") return "date";
    return null;
  };
  // "What to enter" hint for a field, from its bound semantic (none when unbound).
  const fieldHintFor = (k) => {
    const sem = descriptorFor(k).boundSemantic;
    if (!sem) return "";
    return fieldHint(sem, widgetFor(sem, SEMANTIC_CATALOG[sem]?.type ?? "text"));
  };
  // Friendly display name for a field: its template label, else the bound
  // semantic's catalog label, else the raw key. Required by-binding gets a *.
  const friendlyLabel = (k) => {
    const d = descriptorFor(k);
    return d.label || (d.boundSemantic && SEMANTIC_CATALOG[d.boundSemantic]?.label) || k;
  };
  const requiredMark = (k) => (descriptorFor(k).required ? " *" : "");
  // Required-by-binding fields first (stable within each tier).
  const orderByRequired = (keys) =>
    [...keys].sort((a, b) => (descriptorFor(b).required ? 1 : 0) - (descriptorFor(a).required ? 1 : 0));

  // HTML attribute string for a plain (non-typed-widget) input, from the kind's
  // affordances.
  function inputAttrs(kind) {
    const a = kindAttrs(kind);
    const out = [`data-kind="${esc(kind)}"`];
    if (a.maxLength) out.push(`maxlength="${a.maxLength}"`);
    if (a.pattern) out.push(`pattern="${esc(a.pattern)}"`);
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
    const w = typedWidgetFor(k);
    const hint = fieldHintFor(k);
    const control = w
      ? `<div class="iss-typed" data-typed-shared="${esc(k)}" data-tw="${esc(w)}" title="${esc(k)}"></div>`
      : `<input data-shared-key="${esc(k)}" ${inputAttrs(fieldKind(k))} placeholder="${esc(k)}" value="${esc(shared[k] ?? "")}" title="${esc(hint || k)}" />`;
    return `${control}${hint ? `<span class="iss-hint">${esc(hint)}</span>` : ""}<span class="field-err" data-err-shared="${esc(k)}"></span>`;
  }
  function rowFieldHtml(k, r, i) {
    const w = typedWidgetFor(k);
    const hint = fieldHintFor(k);
    const control = w
      ? `<div class="iss-typed" data-typed-key="${esc(k)}" data-i="${i}" data-tw="${esc(w)}" title="${esc(hint || k)}"></div>`
      : `<input data-key="${esc(k)}" ${inputAttrs(fieldKind(k))} placeholder="${esc(k)}" value="${esc(r.values[k] ?? "")}" title="${esc(hint || k)}" />`;
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

  // Disable the Issue button while anything is invalid, with a visible reason +
  // a status dot (green when ready) in the sticky issue bar.
  function refreshGate() {
    const btn = root.querySelector('button[data-act="issue"]');
    if (!btn) return;
    const errs = collectValidationErrors();
    btn.disabled = errs.length > 0;
    const reason = root.querySelector("#iss-gate-reason");
    if (reason) reason.textContent = errs.length ? `${errs.length} field(s) need attention` : "Ready to issue";
    const dot = root.querySelector("#iss-gate-dot");
    if (dot) dot.classList.toggle("is-ready", errs.length === 0);
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
    tripExpiry = $("#iss-expiry")?.value ?? tripExpiry;
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

  // Shared grid template for the passenger table head + each row, so columns
  // line up: #, one column per individualized field, the serial, the remove btn.
  function colTemplate(n) {
    const mid = n ? `repeat(${n},minmax(120px,1fr)) ` : "";
    const minW = 34 + n * 120 + 188 + 34 + (n + 2) * 8;
    return `grid-template-columns:34px ${mid}minmax(188px,1.3fr) 34px; min-width:${minW}px;`;
  }

  function rowHtml(r, i) {
    const indKeys = orderByRequired((current()?.fieldKeys ?? []).filter(k => individualKeys.has(k)));
    const cells = indKeys.map(k => rowFieldHtml(k, r, i)).join("");
    return `
      <div class="iss-row" data-i="${i}">
        <div class="wpd-prow" style="${colTemplate(indKeys.length)}">
          <span class="wpd-prow-num">${i + 1}</span>
          ${cells}
          <div class="wpd-prow-cell">
            <input data-serial placeholder="serial" value="${esc(r.serial)}" class="iss-serial" title="Serial number (caller-supplied; suggested from the trip id) — must be unique per pass" />
            <span class="field-err" data-err-serial="${i}"></span>
          </div>
          <button data-act="rm" data-i="${i}" ${rows.length === 1 ? "disabled" : ""} class="wpd-prow-rm" title="remove passenger">✕</button>
        </div>
        <details class="wpd-prow-adv iss-adv">
          <summary>Scan / paste boarding pass &amp; semantic tags</summary>
          <div class="iss-row-tools">
            <button data-scan-row="${i}" class="iss-toggle" title="scan or paste a boarding pass barcode to autofill this row">📷 Scan / paste boarding pass</button>
            <button data-act="suggest" data-i="${i}" class="iss-toggle" title="fill the display fields below from these semantics">Suggest values ↓</button>
          </div>
          <div class="iss-sem" data-sem-row="${i}"></div>
        </details>
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
      <div class="tpl-bindings">
        <p class="hint">${Object.keys(draft).length} bound · ${unbound.length} unbound (informational)</p>
        ${bound || `<p class="hint">No bindings yet — add one below.</p>`}
        <div class="live-row tpl-bind-row">
          <select data-add-sem data-tpl="${esc(t.id)}">
            <option value="">+ bind semantic…</option>
            ${unbound.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}
          </select>
          <select data-add-field data-tpl="${esc(t.id)}">${fieldOptions("")}</select>
          <button data-act="bind-add" data-id="${esc(t.id)}" class="wpd-ghost">Add</button>
          <button data-act="bind-save" data-id="${esc(t.id)}" class="wpd-ghost">Save bindings</button>
          <span class="mg-grp-status" data-bind-status="${esc(t.id)}"></span>
        </div>
        <p class="hint">Unbound semantics still update on push — modern devices render from semantics; a bound field also updates the classic layout.</p>
      </div>`;
  }

  // "Advanced — semantic bindings" drawer: the selected template's editable
  // field-key → semantic-tag map.
  function advancedDrawer() {
    const t = current();
    const body = (t && !t.error)
      ? `<p class="wpd-drawer-note">Semantic tags are Apple’s fixed vocabulary; field keys are this template’s. Bound fields update the classic layout; unbound semantics still render on iOS&nbsp;26.</p>${bindingsEditor(t)}`
      : `<p class="hint">Select a working template to edit its semantic bindings.</p>`;
    return `
      <details class="wpd-drawer">
        <summary class="wpd-drawer-summary">Advanced — semantic bindings</summary>
        <div class="wpd-drawer-body">${body}</div>
      </details>`;
  }

  // "Template manager" drawer: installed .pkpasstemplate bundles + upload.
  function templatesCard(open = false) {
    const list = templates.map(t => `
      <div class="wpd-tpl-row">
        <div>
          <div class="wpd-tpl-row-name">${esc(t.id)}</div>
          <div class="wpd-tpl-row-meta">${t.error
            ? `<span class="mg-badge" style="background:#FBE9ED;color:#B0203C">broken: ${esc(t.error)}</span>`
            : `${(t.fieldKeys ?? []).length} field keys · ${(t.assets ?? []).length} assets`}</div>
        </div>
        <button data-act="tpl-del" data-id="${esc(t.id)}" class="wpd-ghost danger">Delete</button>
      </div>`).join("");
    return `
      <details class="wpd-drawer" ${open ? "open" : ""}>
        <summary class="wpd-drawer-summary">Template manager <span class="mg-badge">${templates.length} installed</span></summary>
        <div class="wpd-drawer-body">
          ${list || `<p class="hint">None installed — see <code>templates/README.md</code>.</p>`}
          <div class="wpd-tpl-upload">
            <input id="tpl-id" placeholder="id (defaults to file name)" />
            <input id="tpl-file" type="file" accept=".zip" />
            <button data-act="tpl-upload" class="wpd-ghost">Upload zipped .pkpasstemplate</button>
            <span class="mg-grp-status" id="tpl-status"></span>
          </div>
        </div>
      </details>`;
  }

  function render() {
    const tpl = current();
    ensureFieldDefaults();
    const sharedKeys = orderByRequired((tpl?.fieldKeys ?? []).filter(k => !individualKeys.has(k)));
    const indKeys = orderByRequired((tpl?.fieldKeys ?? []).filter(k => individualKeys.has(k)));

    // Step 1 — template picker buttons + field-key chips
    const tplButtons = templates.map(t => {
      const meta = t.error ? esc(t.error) : `${(t.fieldKeys ?? []).length} fields · ${(t.assets ?? []).length} assets`;
      return `<button data-act="sel-tpl" data-id="${esc(t.id)}" class="wpd-tpl-btn${t.id === selected ? " is-active" : ""}" ${t.error ? "disabled" : ""}>
          <span class="wpd-tpl-name">${esc(t.id)}${t.error ? " · broken" : ""}</span>
          <span class="wpd-tpl-meta">${meta}</span>
        </button>`;
    }).join("");
    const chips = (tpl?.fieldKeys ?? []).map(k => `<span class="wpd-chip${requiredMark(k) ? " is-required" : ""}">${esc(k)}</span>`).join("");

    // Step 2 — shared fields grid (each with a "per passenger →" toggle)
    const sharedStep = tpl && !tpl.error && sharedKeys.length ? `
        <section class="wpd-step">
          <div class="wpd-step-head"><span class="wpd-step-num">2</span><span class="wpd-step-title">Shared across the trip</span><span class="wpd-step-sub">— entered once, same for everyone</span></div>
          <div class="wpd-shared-grid">
            ${sharedKeys.map(k => `
              <div class="wpd-shared-field">
                <div class="wpd-shared-top">
                  <label title="${esc(k)}${descriptorFor(k).boundSemantic ? " · " + esc(descriptorFor(k).boundSemantic) : ""}">${esc(friendlyLabel(k))}${requiredMark(k)}</label>
                  <button data-act="to-individual" data-key="${esc(k)}" class="wpd-ghost-mini" title="vary this per passenger">per&nbsp;passenger&nbsp;→</button>
                </div>
                ${sharedFieldHtml(k)}
              </div>`).join("")}
          </div>
        </section>` : "";

    // Step 3 — passenger table; header columns line up with each row via colTemplate
    const tableHead = `
      <div class="wpd-prow-head" style="${colTemplate(indKeys.length)}">
        <span class="wpd-prow-num">#</span>
        ${indKeys.map(k => `<span class="wpd-col-head"><code title="${esc(friendlyLabel(k))}${fieldHintFor(k) ? " — " + esc(fieldHintFor(k)) : ""}">${esc(k)}${requiredMark(k)}</code><button data-act="to-shared" data-key="${esc(k)}" class="wpd-col-share" title="make this shared for the whole trip">share</button></span>`).join("")}
        <span class="wpd-col-head">Serial</span>
        <span></span>
      </div>`;

    root.innerHTML = `
      <div class="wpd-view wpd-issue">
        <div class="wpd-view-head">
          <h1>Issue boarding passes</h1>
          <p>Pick a boarding-pass template, name the trip, then add one row per passenger. Each row becomes a signed, installable <code>.pkpass</code>.</p>
        </div>

        <section class="wpd-step">
          <div class="wpd-step-head"><span class="wpd-step-num">1</span><span class="wpd-step-title">Template &amp; trip</span></div>
          <div class="wpd-tpl-grid">${tplButtons || `<p class="hint">No templates installed.</p>`}</div>
          ${tpl?.error ? `<p class="hint">✗ ${esc(tpl.error)}</p>` : (chips ? `<div class="wpd-chips">${chips}</div>` : "")}
          <div class="wpd-grid2">
            <div class="wpd-field">
              <label>Trip id <span class="wpd-req">*</span></label>
              <input id="iss-group" class="mono" placeholder="RP247@2026-06-20" value="${esc(groupId)}" />
              <div class="wpd-compose">
                <span class="hint">or compose:</span>
                <input id="iss-flight" class="wpd-compose-flight" placeholder="RP247" />
                <input id="iss-date" type="date" />
                <button data-act="compose" class="wpd-ghost">→ Trip id</button>
              </div>
            </div>
            <div class="wpd-field">
              <label>Pass expiry</label>
              <input id="iss-expiry" placeholder="blank = arrival + 1 day" value="${esc(tripExpiry)}" />
            </div>
          </div>
        </section>

        ${sharedStep}

        <section class="wpd-step">
          <div class="wpd-step-head"><span class="wpd-step-num">3</span><span class="wpd-step-title">Passengers</span><span class="wpd-pill">${rows.length}</span></div>
          ${indKeys.length ? "" : `<p class="hint">All fields are shared — use <b>per&nbsp;passenger&nbsp;→</b> above to give a field its own column (otherwise every passenger is identical except the serial).</p>`}
          <div class="wpd-ptable-scroll wpd-scroll">${tableHead}${rows.map(rowHtml).join("")}</div>
          <div class="wpd-prow-add">
            <button data-act="add" class="wpd-ghost">+ Add passenger</button>
            <span class="hint">tip: toggle a shared field to “per passenger” to give it its own column</span>
          </div>
        </section>

        <div class="wpd-issue-bar">
          <button data-act="issue" class="wpd-issue-btn">Issue ${rows.length} pass(es)</button>
          <span class="wpd-dot" id="iss-gate-dot"></span>
          <span class="wpd-issue-reason" id="iss-gate-reason"></span>
          <span class="mg-grp-status" id="iss-status"></span>
        </div>

        <div class="wpd-drawers">
          ${advancedDrawer()}
          ${templatesCard()}
        </div>
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
      const k = ph.dataset.typedShared, w = ph.dataset.tw || "date";
      ph.replaceChildren(renderTypedInput({
        type: w, value: shared[k], attrs: kindAttrs(fieldKind(k)),
        onChange: (v) => { shared = { ...shared, [k]: v }; }
      }));
    }
    for (const ph of root.querySelectorAll("[data-typed-key]")) {
      const k = ph.dataset.typedKey, i = Number(ph.dataset.i), w = ph.dataset.tw || "date";
      if (!rows[i]) continue;
      ph.replaceChildren(renderTypedInput({
        type: w, value: rows[i].values[k], attrs: kindAttrs(fieldKind(k)),
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
      <div class="wpd-view wpd-issue">
        <div class="wpd-view-head">
          <h1>Issue boarding passes</h1>
          <p>No templates installed yet — drop a <code>.pkpasstemplate</code> bundle into
          <code>templates/</code> or upload one below (see <code>templates/README.md</code>).</p>
        </div>
        <div class="wpd-drawers">${templatesCard(true)}</div>
      </div>`;
  }

  function setRowStatus(i, html) {
    const el = root.querySelector(`[data-row-status="${i}"]`);
    if (el) el.innerHTML = html;
  }

  function walletAffordance(serial, updated = false) {
    const url = `${location.origin}/api/passes/${encodeURIComponent(serial)}/pkpass`;
    const label = updated ? "↻ updated existing pass" : "✓ issued";
    return `<canvas class="iss-qr" data-qr="${esc(url)}" title="Scan with the iPhone"></canvas><span class="wpd-result-status">${label}</span>${appleWalletButton(url)}`;
  }

  // bwip-js is only needed to draw the result QR codes after passes are issued,
  // so it's lazily imported here (its own chunk) rather than at module load — the
  // Issue view renders and validates without ever pulling in the barcode encoder.
  async function drawQrCodes() {
    const canvases = [...root.querySelectorAll("canvas[data-qr]")];
    if (!canvases.length) return;
    let bwipjs;
    try { ({ default: bwipjs } = await import("bwip-js")); } catch { return; }
    for (const c of canvases) {
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
      const body = buildIssueRequest({ template: selected, groupId, serial: rows[i].serial, values, semantics: rows[i].semantics, barcodeMessage: rows[i].barcodeMessage, expirationDate: tripExpiry });
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
    if (act === "sel-tpl") {
      const id = e.target.closest("[data-id]")?.dataset.id;
      if (!id || id === selected) return;
      syncFromInputs();
      selected = id;
      render();
      return;
    }
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

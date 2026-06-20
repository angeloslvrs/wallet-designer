import {
  SEMANTIC_CATALOG, REQUIRED_SEMANTICS, RECOMMENDED_SEMANTICS, TIMEZONE_KEY_ALIASES
} from "@wpd/pass-builder/semantics.js";
import { semanticKind, kindAttrs, validateFieldValue } from "@wpd/pass-builder/field-kinds.js";
import { renderTypedInput, isEmptyTyped, widgetFor, fieldHint } from "./inputs.js";

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

// Section order + human labels for the semantic groups (semantics.js owns the
// per-key `group`; this is the display order). Unknown groups append at the end.
const GROUP_ORDER = ["flight", "route", "schedule", "passenger", "status", "pricing"];
const GROUP_LABEL = {
  flight: "Flight", route: "Route & airports", schedule: "Schedule",
  passenger: "Passenger & ticket", status: "Day-of-travel status", pricing: "Pricing"
};

// departure/destination LocationTimeZone are the doc-spelling twins of the
// *AirportTimeZone keys; we edit only the AirportTimeZone (required) and mirror
// the value to its twin, so the build emits both spellings. The Location rows
// are hidden to avoid a confusing duplicate field.
const TZ_TWIN = {};
for (const [loc, air] of Object.entries(TIMEZONE_KEY_ALIASES)) { TZ_TWIN[loc] = air; TZ_TWIN[air] = loc; }
const HIDDEN_KEYS = new Set(Object.keys(TIMEZONE_KEY_ALIASES));

/** Drop empty values (emit-only-filled); keep typed shapes and real falsey values. */
export function harvestSemantics(values = {}) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    const type = SEMANTIC_CATALOG[k]?.type ?? "text";
    if (!isEmptyTyped(type, v)) out[k] = v;
  }
  return out;
}

/**
 * Render the semantics editor: required + recommended fields shown by default,
 * grouped under section headers, each with a typed input, a format hint, and
 * inline validation; optional fields added via a grouped picker.
 * @param {{values:Record<string,*>, onChange:(values:Record<string,*>)=>void}} opts
 *   `values` seeds the editor; a fresh copy is passed to onChange on each edit.
 */
export function renderSemanticsEditor({ values = {}, onChange }) {
  const wrap = el("div", { className: "sem-editor" });
  const state = { ...values };
  const touched = new Set();
  const shown = new Set(
    [...REQUIRED_SEMANTICS, ...RECOMMENDED_SEMANTICS, ...Object.keys(values)]
      .filter(k => SEMANTIC_CATALOG[k] && !HIDDEN_KEYS.has(k))
  );

  const body = el("div", { className: "sem-body" });
  const picker = el("select", { className: "sem-add" });

  const setVal = (key, v) => {
    state[key] = v;
    const twin = TZ_TWIN[key];
    if (twin) state[twin] = v;   // keep doc/designer time-zone spellings in sync
    onChange?.({ ...state });
  };

  const fieldRow = (key) => {
    const entry = SEMANTIC_CATALOG[key];
    const widget = widgetFor(key, entry.type);
    const row = el("div", { className: "sem-row" });
    row.dataset.sem = key;

    const lbl = el("label", {
      textContent: entry.label + (entry.required ? " *" : entry.recommended ? " (recommended)" : "")
    });
    if (entry.required) lbl.title = "Required by Apple's boarding-pass validator";
    else if (entry.recommended) lbl.title = "Recommended by Apple's boarding-pass validator";

    const field = el("div", { className: "sem-field" });
    const err = el("div", { className: "field-err" });
    const validate = (force) => {
      const msg = validateFieldValue({ kind: semanticKind(key), required: entry.required }, state[key]);
      err.textContent = msg ?? "";
      err.classList.toggle("show", Boolean(msg && (force || touched.has(key))));
    };

    const input = renderTypedInput({
      type: widget, value: state[key], enumOptions: entry.enumOptions,
      attrs: kindAttrs(semanticKind(key)),
      onChange: (v) => { setVal(key, v); validate(false); }
    });
    input.addEventListener("focusout", () => { touched.add(key); validate(true); });

    field.append(input);
    const hintText = fieldHint(key, widget);
    if (hintText) field.append(el("div", { className: "sem-hint", textContent: hintText }));
    field.append(err);
    row.append(lbl, field);
    return row;
  };

  // required first, then recommended, then optional (stable within each tier).
  const tier = (k) => SEMANTIC_CATALOG[k].required ? 0 : SEMANTIC_CATALOG[k].recommended ? 1 : 2;
  const orderGroups = (map) => [
    ...GROUP_ORDER.filter(g => map[g]),
    ...Object.keys(map).filter(g => !GROUP_ORDER.includes(g)).sort()
  ];

  function renderBody() {
    body.replaceChildren();
    const map = {};
    for (const key of shown) {
      if (!SEMANTIC_CATALOG[key] || HIDDEN_KEYS.has(key)) continue;
      (map[SEMANTIC_CATALOG[key].group] ??= []).push(key);
    }
    for (const g of orderGroups(map)) {
      const section = el("div", { className: "sem-section" });
      section.dataset.group = g;
      section.append(el("div", { className: "sem-head", textContent: GROUP_LABEL[g] ?? g }));
      for (const key of [...map[g]].sort((a, b) => tier(a) - tier(b))) section.append(fieldRow(key));
      body.append(section);
    }
  }

  function renderPicker() {
    picker.replaceChildren(el("option", { value: "", textContent: "+ add optional semantic…" }));
    const map = {};
    for (const [key, entry] of Object.entries(SEMANTIC_CATALOG)) {
      if (shown.has(key) || HIDDEN_KEYS.has(key)) continue;
      (map[entry.group] ??= []).push([key, entry]);
    }
    for (const g of orderGroups(map)) {
      const og = el("optgroup", { label: GROUP_LABEL[g] ?? g });
      for (const [key, entry] of map[g]) og.append(el("option", { value: key, textContent: entry.label }));
      picker.append(og);
    }
  }

  picker.addEventListener("change", () => {
    const key = picker.value;
    if (!key) return;
    shown.add(key);
    renderBody();
    renderPicker();
    picker.value = "";
    body.querySelector(`[data-sem="${key}"] input, [data-sem="${key}"] select`)?.focus();
  });

  renderBody();
  renderPicker();
  wrap.append(body, picker);
  return wrap;
}

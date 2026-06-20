import { SEMANTIC_CATALOG, REQUIRED_SEMANTICS, RECOMMENDED_SEMANTICS } from "@wpd/pass-builder/semantics.js";
import { renderTypedInput, isEmptyTyped } from "./inputs.js";

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

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
 * Render the semantics editor.
 * @param {{values:Record<string,*>, onChange:(values:Record<string,*>)=>void}} opts
 *   `values` seeds the editor; a fresh copy is passed to onChange on each edit.
 */
export function renderSemanticsEditor({ values = {}, onChange }) {
  const wrap = el("div", { className: "sem-editor" });
  const state = { ...values };
  const shown = new Set([...REQUIRED_SEMANTICS, ...RECOMMENDED_SEMANTICS, ...Object.keys(values)]);

  const fieldRow = (key) => {
    const { type, label, required, recommended, enumOptions } = SEMANTIC_CATALOG[key];
    const row = el("div", { className: "sem-row" });
    row.dataset.sem = key;
    const lbl = el("label", { textContent: label + (required ? " *" : recommended ? " (recommended)" : "") });
    const input = renderTypedInput({
      type, value: state[key], enumOptions,
      onChange: (v) => { state[key] = v; onChange?.({ ...state }); }
    });
    row.append(lbl, input);
    return row;
  };

  const body = el("div", { className: "sem-body" });
  for (const key of [...shown].filter(k => SEMANTIC_CATALOG[k])) body.append(fieldRow(key));

  // "+ add semantic" picker for catalog keys not yet shown, grouped.
  const picker = el("select");
  picker.append(el("option", { value: "", textContent: "+ add semantic…" }));
  for (const [key, { label, group }] of Object.entries(SEMANTIC_CATALOG)) {
    if (shown.has(key)) continue;
    picker.append(el("option", { value: key, textContent: `${group} · ${label}` }));
  }
  picker.addEventListener("change", () => {
    const key = picker.value; if (!key) return;
    shown.add(key); body.append(fieldRow(key));
    picker.querySelector(`option[value="${key}"]`)?.remove();
    picker.value = "";
  });

  wrap.append(body, picker);
  return wrap;
}

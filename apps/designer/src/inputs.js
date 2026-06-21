// Shared typed-input helpers. Pure functions here are unit-tested; the DOM
// renderer (renderTypedInput) is added in a later task.

// ISO-8601 <-> datetime-local. <input type=datetime-local> only edits the
// wall-clock part, so the UTC offset is parsed/preserved separately.
export const splitIso = (v) => {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(v || "");
  return m ? { local: m[1], offset: m[2] || "" } : { local: "", offset: "" };
};
export const joinIso = (local, offset) => (local ? `${local}:00${offset || ""}` : "");

// Type-aware emptiness lives in the package so the Suggest engine and the
// designer share one implementation (drives emit-only-filled).
export { isEmptyTyped } from "@wpd/pass-builder/suggest-empty.js";
import { semanticKind } from "@wpd/pass-builder/field-kinds.js";

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

// IANA time-zone list for the timezone picker's type-ahead. Intl.supportedValuesOf
// is available in Node 24 + modern browsers; degrade to a free-text input if not.
let _zones = null;
function ianaZones() {
  if (_zones) return _zones;
  try { _zones = Intl.supportedValuesOf?.("timeZone") ?? []; }
  catch { _zones = []; }
  return _zones;
}
let tzSeq = 0;

const applyAttrs = (inp, attrs = {}) => {
  if (attrs.maxLength != null) inp.maxLength = attrs.maxLength;
  if (attrs.pattern) inp.pattern = attrs.pattern;
  if (attrs.inputmode) inp.inputMode = attrs.inputmode;
};

/**
 * The widget a semantic key should render with. Defaults to its catalog `type`,
 * but any `*TimeZone` key gets the IANA timezone picker (presentation refinement
 * — the catalog still types these as plain strings).
 * @param {string} key semantic key
 * @param {string} type catalog widget type
 * @returns {string}
 */
export function widgetFor(key, type) {
  if (/TimeZone$/.test(key)) return "timezone";
  if (key === "passengerCapabilities") return "capabilities";
  return type;
}

/**
 * A short "what to enter" hint for a semantic field, by widget + validation kind.
 * Empty string when the control is self-explanatory (boolean/enum/plain text).
 * @param {string} key semantic key
 * @param {string} type widget type (from {@link widgetFor})
 * @returns {string}
 */
export function fieldHint(key, type) {
  switch (type) {
    case "timezone":    return "IANA time zone, e.g. Asia/Manila";
    case "date":        return "Local date + time, with UTC offset";
    case "seats":       return "Seats, e.g. 14A, 14B";
    case "personName":  return "Given + family name";
    case "currency":    return "Amount + ISO currency code (USD)";
    case "location":    return "Latitude, longitude";
    case "stringArray": return "Comma-separated values";
    case "capabilities": return "Renders as baggage / eligibility badges on iOS 26 (exact value casing matters)";
    case "boolean":
    case "enum":        return "";
  }
  switch (semanticKind(key)) {
    case "iata":   return "3-letter IATA code, e.g. MNL";
    case "number": return "Whole number";
    default:       return "";
  }
}

/**
 * Render one typed input. Returns a wrapper element; reports the typed value via onChange.
 * @param {{type:string, value:*, onChange:(v:*)=>void, enumOptions?:string[],
 *          attrs?:{maxLength?:number, pattern?:string, inputmode?:string}}} opts
 *   `attrs` (from field-kinds kindAttrs) constrain the text/number/timezone input.
 */
export function renderTypedInput({ type, value, onChange, enumOptions = [], attrs = {} }) {
  const wrap = el("div", { className: "typed-input" });
  const fire = (v) => onChange?.(v);

  switch (type) {
    case "timezone": {
      const listId = `tz-list-${++tzSeq}`;
      const inp = el("input", { type: "text", value: value ?? "", placeholder: "Asia/Manila" });
      inp.setAttribute("list", listId);
      applyAttrs(inp, attrs);
      const dl = el("datalist", { id: listId });
      for (const z of ianaZones()) dl.append(el("option", { value: z }));
      inp.addEventListener("input", () => fire(inp.value));
      wrap.append(inp, dl); break;
    }
    case "date": {
      wrap.style.cssText = "display:flex;gap:6px;align-items:center";
      const { local, offset } = splitIso(value);
      const dt = el("input", { type: "datetime-local", step: "60", value: local });
      const off = el("input", { type: "text", value: offset, placeholder: "-07:00", title: "UTC offset (blank = none)" });
      off.style.cssText = "width:78px;flex:none"; dt.style.flex = "1";
      const sync = () => fire(joinIso(dt.value, off.value.trim()));
      dt.addEventListener("input", sync); off.addEventListener("input", sync);
      wrap.append(dt, off); break;
    }
    case "number": {
      const inp = el("input", { type: "number", value: value ?? "" });
      applyAttrs(inp, attrs);
      inp.addEventListener("input", () => fire(inp.value === "" ? "" : Number(inp.value)));
      wrap.append(inp); break;
    }
    case "boolean": {
      const sel = el("select");
      for (const [v, t] of [["false", "No / false"], ["true", "Yes / true"]]) sel.append(el("option", { value: v, textContent: t }));
      sel.value = value ? "true" : "false";
      sel.addEventListener("change", () => fire(sel.value === "true"));
      wrap.append(sel); break;
    }
    case "personName": {
      wrap.style.cssText = "display:flex;gap:6px";
      const g = el("input", { placeholder: "Given", value: value?.givenName ?? "" });
      const f = el("input", { placeholder: "Family", value: value?.familyName ?? "" });
      const sync = () => fire({ givenName: g.value, familyName: f.value });
      g.addEventListener("input", sync); f.addEventListener("input", sync);
      wrap.append(g, f); break;
    }
    case "seats": {
      // Minimal seats editor: comma list of "row+letter" tokens (e.g. "14A, 14B").
      const inp = el("input", { placeholder: "14A, 14B", value: (value ?? []).map(s => `${s.seatRow ?? ""}${s.seatNumber ?? ""}`).join(", ") });
      inp.addEventListener("input", () => fire(
        inp.value.split(",").map(t => t.trim()).filter(Boolean).map(t => {
          const m = /^(\d+)\s*([A-Za-z]+)$/.exec(t);
          return m ? { seatRow: m[1], seatNumber: m[2].toUpperCase() } : { seatNumber: t };
        })
      ));
      wrap.append(inp); break;
    }
    case "stringArray": {
      const inp = el("input", { placeholder: "comma, separated", value: (value ?? []).join(", ") });
      inp.addEventListener("input", () => fire(inp.value.split(",").map(s => s.trim()).filter(Boolean)));
      wrap.append(inp); break;
    }
    case "enum": {
      const sel = el("select");
      for (const o of enumOptions) sel.append(el("option", { value: o, textContent: o }));
      if (value != null) sel.value = value;
      sel.addEventListener("change", () => fire(sel.value));
      wrap.append(sel); break;
    }
    case "capabilities": {
      // Multi-select checkbox group over known capability constants. Value is
      // an array of selected constant strings. Any seeded value not in the
      // known set (e.g. a stale `PKPassengerCapabilityCarryon`) is shown as an
      // "(unrecognized)" row so it's visible and can be unchecked.
      wrap.style.cssText = "display:flex;flex-direction:column;gap:4px";
      const selected = new Set(Array.isArray(value) ? value : []);
      const opts = enumOptions.map(o => (typeof o === "string" ? { value: o, label: o } : { ...o }));
      const known = new Set(opts.map(o => o.value));
      for (const v of selected) if (!known.has(v)) opts.push({ value: v, label: `${v} (unrecognized)` });
      const boxes = [];
      const sync = () => fire(boxes.filter(b => b.checked).map(b => b.value));
      for (const o of opts) {
        const lbl = el("label");
        lbl.style.cssText = "display:flex;gap:6px;align-items:center;font-weight:400;cursor:pointer";
        const cb = el("input", { type: "checkbox", value: o.value, checked: selected.has(o.value) });
        cb.addEventListener("change", sync);
        boxes.push(cb);
        lbl.append(cb, el("span", { textContent: o.label }));
        wrap.append(lbl);
      }
      break;
    }
    case "location": {
      wrap.style.cssText = "display:flex;gap:6px";
      const lat = el("input", { type: "number", placeholder: "lat", value: value?.latitude ?? "" });
      const lng = el("input", { type: "number", placeholder: "lng", value: value?.longitude ?? "" });
      const sync = () => fire({ latitude: Number(lat.value), longitude: Number(lng.value) });
      lat.addEventListener("input", sync); lng.addEventListener("input", sync);
      wrap.append(lat, lng); break;
    }
    case "currency": {
      wrap.style.cssText = "display:flex;gap:6px";
      const amt = el("input", { type: "number", placeholder: "amount", value: value?.amount ?? "" });
      const cur = el("input", { placeholder: "USD", value: value?.currencyCode ?? "" });
      const sync = () => fire({ amount: amt.value === "" ? "" : Number(amt.value), currencyCode: cur.value });
      amt.addEventListener("input", sync); cur.addEventListener("input", sync);
      wrap.append(amt, cur); break;
    }
    default: {
      const inp = el("input", { type: "text", value: value ?? "" });
      applyAttrs(inp, attrs);
      inp.addEventListener("input", () => fire(inp.value));
      wrap.append(inp);
    }
  }
  return wrap;
}

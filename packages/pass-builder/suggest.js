import { SEMANTIC_CATALOG } from "./semantics.js";
import { isEmptyTyped } from "./suggest-empty.js";

// Deterministic 12-hour wall-clock from an ISO string (no locale dependence).
function formatTime(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || "");
  if (!m) return String(iso ?? "");
  let h = Number(m[1]); const min = m[2]; const ampm = h < 12 ? "AM" : "PM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

/** Format one semantic value into a human display string, keyed by its catalog type. */
export function formatSemanticValue(key, value) {
  const type = SEMANTIC_CATALOG[key]?.type ?? "text";
  switch (type) {
    case "date": return formatTime(value);
    case "personName": return [value?.givenName, value?.familyName].filter(Boolean).join(" ").toUpperCase();
    case "seats": return (value ?? []).map(s => `${s.seatRow ?? ""}${s.seatNumber ?? ""}`).join(", ");
    case "boolean": return value ? "Yes" : "No";
    case "stringArray": return (value ?? []).join(", ");
    case "number": return String(value);
    default: return String(value ?? "");
  }
}

/**
 * Suggested display-field values from semantics.
 * @param {Record<string,unknown>} semantics
 * @param {Record<string,string>} mapping  semanticKey -> fieldKey
 * @returns {Record<string,string>} fieldKey -> formatted value (only mapped, non-empty semantics)
 */
export function suggestDisplayValues(semantics, mapping) {
  const out = {};
  for (const [sem, fieldKey] of Object.entries(mapping ?? {})) {
    const v = semantics?.[sem];
    const type = SEMANTIC_CATALOG[sem]?.type ?? "text";
    if (isEmptyTyped(type, v)) continue;
    out[fieldKey] = formatSemanticValue(sem, v);
  }
  return out;
}

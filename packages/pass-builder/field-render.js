// Studio field extensions → plain Apple fields. A Studio design may carry three
// things Wallet doesn't understand, and none may reach an emitted pass.json:
//  - label tokens: "{departureCityName:upper}" fills a label from the pass's
//    own semantics, so one airline layout serves every route;
//  - timeFormat "24h": the field stores an ISO date (so Issue, bindings and
//    status updates keep treating it as a date) and is rendered "HH:mm";
//  - optional: true: the field is left off the pass while its value is blank
//    (an airline's "Terminal note" that only some routes fill).
// Runs at the end of formStateToPassJson and in the wallet preview. Browser-safe
// imports only — the designer bundle ships this file.

import { FIELD_ZONES, styleKey } from "./field-zones.js";
import { SEMANTIC_CATALOG } from "./semantics.js";
import { isLooseIsoDateTime } from "./iso-date.js";

export const LABEL_TOKEN_RE = /\{([A-Za-z][A-Za-z0-9]*)(?::(upper))?\}/g;

function tokenText(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

/** A label with its known-semantic tokens filled in (others stay literal). */
function resolveLabel(label, semantics) {
  let replaced = false;
  const out = label.replace(LABEL_TOKEN_RE, (whole, key, upper) => {
    if (!(key in SEMANTIC_CATALOG)) return whole;
    replaced = true;
    const text = tokenText(semantics[key]);
    return upper ? text.toUpperCase() : text;
  });
  return replaced ? out.replace(/\s+/g, " ").trim() : label;
}

/** "HH:mm" read from the ISO string itself — its offset is the airport's. */
function time24(value) {
  if (!isLooseIsoDateTime(value)) return value;
  return /T(\d{2}):(\d{2})/.exec(value.trim()).slice(1).join(":");
}

/**
 * Resolve label tokens and timeFormat fields in every field zone.
 * Pure and idempotent; a pass with nothing to resolve comes back deep-equal.
 * @param {object} passJson
 * @returns {object}
 */
export function resolvePassFields(passJson) {
  const style = styleKey(passJson);
  if (!style) return passJson;
  const semantics = passJson.semantics ?? {};
  const out = structuredClone(passJson);
  for (const zone of FIELD_ZONES) {
    const list = out[style][zone];
    if (!Array.isArray(list)) continue;
    out[style][zone] = list.flatMap(f => {
      if (!f || typeof f !== "object") return f;
      let next = f;
      if (typeof f.label === "string" && f.label.includes("{")) {
        const label = resolveLabel(f.label, semantics);
        if (label !== f.label) next = { ...next, label };
      }
      if (f.timeFormat !== undefined) {
        const { timeFormat, dateStyle, timeStyle, ...rest } = next;
        next = timeFormat === "24h" ? { ...rest, value: time24(rest.value) } : rest;
      }
      if (f.optional !== undefined) {
        const { optional, ...rest } = next;
        if (optional === true && (rest.value === undefined || rest.value === null || String(rest.value).trim() === "")) return [];
        next = rest;
      }
      return [next];
    });
  }
  return out;
}

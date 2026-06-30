// The validation "kind" of an issue/status input, and the rules that hang off
// it. Rules attach to APPLE'S SEMANTICS, never to a template's field-key names
// (polarity rule — see bindings.js); a visible field reaches its kind through
// the template's discovered semanticKey → fieldKey binding map. Pure and
// dependency-free so the designer (browser), the server, and the builder all
// share one implementation.

import { BOARDING_SEMANTICS } from "./semantics.js";
import { isStrictIsoDateTime } from "./iso-date.js";

/** @typedef {"date"|"number"|"iata"|"name"|"seat"|"text"} FieldKind */

// Airport-code semantics are typed "string" by Apple, but the issuer enters a
// 3-letter IATA code — recognise them by the conventional key suffix rather
// than an enumerated list, so any future *AirportCode semantic is covered.
const isAirportCodeSemantic = (semanticKey) => /AirportCode$/.test(semanticKey);

// Localizable-string semantics Apple types as strings but the issuer enters as
// digits (most airlines number the boarding sequence).
const NUMERIC_STRING_SEMANTICS = new Set(["boardingSequenceNumber"]);

/**
 * The input kind a field bound to `semanticKey` should validate against,
 * resolved from the value shape Apple's SemanticTags spec gives the semantic
 * (encoded in {@link BOARDING_SEMANTICS}).
 * @param {string} semanticKey
 * @returns {FieldKind}
 */
export function semanticKind(semanticKey) {
  switch (BOARDING_SEMANTICS[semanticKey]) {
    case "date":       return "date";
    case "number":     return "number";
    case "personName": return "name";
    case "seats":      return "seat";
    default: // "string" or unknown
      if (isAirportCodeSemantic(semanticKey)) return "iata";
      if (NUMERIC_STRING_SEMANTICS.has(semanticKey)) return "number";
      return "text";
  }
}

const IATA_RE = /^[A-Za-z]{3}$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const SEAT_RE = /^\d+\s*[A-Za-z]+$/;

/**
 * HTML input affordances for a kind: what the UI puts on the `<input>` so a bad
 * value is hard to type in the first place. (`inputmode` aids soft keyboards.)
 * @param {FieldKind} kind
 * @returns {{maxLength?: number, pattern?: string, inputmode?: string}}
 */
export function kindAttrs(kind) {
  switch (kind) {
    case "iata":   return { maxLength: 3, pattern: "[A-Z]{3}" };
    case "number": return { pattern: "[0-9]+([.][0-9]+)?", inputmode: "numeric" };
    case "seat":   return { pattern: "[0-9]+\\s*[A-Za-z]+" };
    default:       return {};
  }
}

/**
 * Validate a single field/semantic value against its kind. Empty (after trim)
 * is fine unless the field is required — an empty optional field falls back to
 * the template default. Returns a user-facing message, or null when valid.
 * @param {{kind?: FieldKind, required?: boolean}} descriptor
 * @param {*} rawValue
 * @returns {string|null}
 */
export function validateFieldValue(descriptor, rawValue) {
  const kind = descriptor?.kind ?? "text";
  const v = typeof rawValue === "string" ? rawValue.trim() : (rawValue == null ? "" : rawValue);
  if (v === "") return descriptor?.required ? "Required" : null;
  switch (kind) {
    case "iata":   return IATA_RE.test(v)   ? null : "Airport code must be 3 letters (e.g. MNL)";
    case "number": return NUMBER_RE.test(v) ? null : "Must be a number";
    case "date":   return isStrictIsoDateTime(v) ? null : "Must be a valid ISO date and time with timezone";
    case "seat":   return SEAT_RE.test(v)   ? null : "Seat must be a row and letter (e.g. 17C)";
    default:       return null; // name / text — no format constraint
  }
}

/**
 * Canonicalise a value for storage: IATA codes uppercase, all strings trimmed.
 * Non-string values (object patches, arrays) pass through untouched.
 * @param {FieldKind} kind
 * @param {*} value
 * @returns {*}
 */
export function normalizeFieldValue(kind, value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return kind === "iata" ? trimmed.toUpperCase() : trimmed;
}

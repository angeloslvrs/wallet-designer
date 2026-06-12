// Discover semanticKey → fieldKey bindings for a .pkpasstemplate's pass.json.
//
// Field keys are the designer's vocabulary (arbitrary, editable per template
// in Pass Designer); semantic tags are Apple's. Code must never assume field
// key names — instead each template gets a proposed binding map, discovered
// here from the template's own sample values, persisted server-side, and
// editable in the Templates card. Unbound semantics are informational, never
// an error: iOS 26 renders the semanticBoardingPass scheme from semantics, so
// a status update still reaches modern devices with no bound visible field.

import { BOARDING_SEMANTICS } from "./semantics.js";
import { styleKey, FIELD_ZONES } from "./template.js";

// A template's sample schedule values and its date-typed fields were typed
// seconds apart in Pass Designer — same flight moment, not the same instant.
const DATE_PROXIMITY_MS = 120_000;

/**
 * One proposed binding. `confidence` lets the UI flag guesses:
 * "high" = declared (field-level semantics, or saved manually), "medium" =
 * inferred from sample-value coincidence.
 * @typedef {{fieldKey: string,
 *            source: "field-semantics"|"value-match"|"date-proximity"|"seat-composite"|"name-match"|"manual",
 *            confidence: "high"|"medium"}} Binding
 */

/**
 * Every field of the template's style dict, flattened across zones, with the
 * metadata discovery needs.
 * @param {object} passJson
 * @returns {{key: string, value: any, isDate: boolean, dateMs: number, semantics?: object}[]}
 */
export function collectFields(passJson) {
  const style = styleKey(passJson);
  if (!style) return [];
  const fields = [];
  for (const zone of FIELD_ZONES) {
    for (const f of passJson[style][zone] ?? []) {
      if (f?.key === undefined) continue;
      const dateMs = typeof f.value === "string" ? Date.parse(f.value) : NaN;
      const isDate = Boolean(f.dateStyle || f.timeStyle) && !Number.isNaN(dateMs);
      fields.push({ key: f.key, value: f.value, isDate, dateMs, semantics: f.semantics });
    }
  }
  return fields;
}

const nameTokens = (s) => (s ?? "").toUpperCase().split(/[/,\s]+/).filter(Boolean).sort();
const sameTokens = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);

/**
 * Propose semanticKey → fieldKey bindings for a template pass.json.
 * Heuristics, in authority order (first hit wins per semantic key; ambiguous
 * or no match → unbound):
 *  1. field-level `semantics` on a field — authoritative (the spec allows it;
 *     Pass Designer 1.0 doesn't emit it, but uploads may)
 *  2. exact value match: field.value === the string semantic's value
 *  3. date proximity: a date-typed field within ±120s of a `current*` date
 *     semantic (`original*` twins are derived at issue time, not bound)
 *  4. seat composite: field.value === seats[0].seatRow + seatNumber ("17C")
 *  5. name match: field value carries exactly the passengerName components
 *     ("DELA CRUZ/JUAN" ↔ {givenName: "Juan", familyName: "Dela Cruz"})
 * @param {object} passJson
 * @returns {Record<string, Binding>}
 */
export function discoverBindings(passJson) {
  const fields = collectFields(passJson);
  const sem = passJson?.semantics ?? {};
  /** @type {Record<string, Binding>} */
  const bindings = {};

  for (const f of fields) {
    for (const key of Object.keys(f.semantics ?? {})) {
      if (key in BOARDING_SEMANTICS && !bindings[key]) {
        bindings[key] = { fieldKey: f.key, source: "field-semantics", confidence: "high" };
      }
    }
  }

  for (const [key, type] of Object.entries(BOARDING_SEMANTICS)) {
    if (type !== "string" || bindings[key]) continue;
    const v = sem[key];
    if (typeof v !== "string" || !v) continue;
    const matches = fields.filter(f => !f.isDate && f.value === v);
    if (matches.length === 1) {
      bindings[key] = { fieldKey: matches[0].key, source: "value-match", confidence: "medium" };
    }
  }

  for (const [key, type] of Object.entries(BOARDING_SEMANTICS)) {
    if (type !== "date" || !key.startsWith("current") || bindings[key]) continue;
    const at = Date.parse(sem[key] ?? "");
    if (Number.isNaN(at)) continue;
    const matches = fields.filter(f => f.isDate && Math.abs(f.dateMs - at) <= DATE_PROXIMITY_MS);
    if (matches.length === 1) {
      bindings[key] = { fieldKey: matches[0].key, source: "date-proximity", confidence: "medium" };
    }
  }

  const seat = sem.seats?.[0];
  if (!bindings.seats && seat?.seatRow != null && seat?.seatNumber != null) {
    const composite = `${seat.seatRow}${seat.seatNumber}`;
    const matches = fields.filter(f => f.value === composite);
    if (matches.length === 1) {
      bindings.seats = { fieldKey: matches[0].key, source: "seat-composite", confidence: "medium" };
    }
  }

  if (!bindings.passengerName && sem.passengerName) {
    const want = nameTokens([sem.passengerName.givenName, sem.passengerName.familyName].filter(Boolean).join(" "));
    if (want.length) {
      const matches = fields.filter(f => typeof f.value === "string" && sameTokens(nameTokens(f.value), want));
      if (matches.length === 1) {
        bindings.passengerName = { fieldKey: matches[0].key, source: "name-match", confidence: "medium" };
      }
    }
  }

  return bindings;
}

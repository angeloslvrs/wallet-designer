// Status-update + issue-time semantics for template passes — map-driven.
//
// The status vocabulary IS Apple's semantic keys (departureGate,
// currentBoardingDate, transitStatus, …): semantics always update; the
// matching visible field updates only when the template's BINDING map
// (semanticKey → fieldKey, discovered at upload, editable in the Templates
// card) names a field for that semantic. Unbound-but-requested keys land in
// `skipped` so the caller can surface them — informational, never an error
// (iOS 26 renders the semanticBoardingPass scheme from semantics alone).
//
// Code never assumes template field-key names; that died with the
// dev-sample-convention mapping this replaces (see bindings.js).
//
// Body values may be plain ("B12") or the object form ({value, changeMessage})
// — visible fields keep the whole patch (so a push can carry a lock-screen
// banner), semantics always take the .value.

import { BOARDING_SEMANTICS, SEMANTIC_DATE_KEYS, assertStrictIsoDateTime, semanticKind, validateFieldValue } from "@wpd/pass-builder";

const isPatch = (raw) => raw !== null && typeof raw === "object" && !Array.isArray(raw);
const valueOf = (raw) => (isPatch(raw) ? raw.value : raw);

/** Back-compat: the pre-semantic status verbs, accepted at the route layer. */
export const STATUS_BODY_ALIASES = Object.freeze({
  gate: "departureGate",
  boarding: "currentBoardingDate",
  depart: "currentDepartureDate",
  arrive: "currentArrivalDate",
  transitInfo: "transitProvider"
});

/**
 * Rename legacy alias keys to their semantic names. A semantic name present
 * in the same body wins over its alias. Pure.
 * @param {object} [body]
 * @returns {object}
 */
export function normalizeStatusBody(body = {}) {
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (!(k in STATUS_BODY_ALIASES)) out[k] = v;
  }
  for (const [alias, semantic] of Object.entries(STATUS_BODY_ALIASES)) {
    if (alias in body && !(semantic in out)) out[semantic] = body[alias];
  }
  return out;
}

/**
 * Validate a status-update body before it is applied, so a malformed value is
 * a 400 (with a per-field message) instead of a 500 or a silently-broken pass.
 * Vocabulary is semantic keys (legacy aliases normalized first); each value's
 * kind comes from its semantic — the same table the issue path uses. Empty
 * values clear a semantic, so only non-empty values are checked.
 * @param {object} [body] status-update request body (semantic or legacy-verb keys)
 * @returns {string[]} "key: message" per invalid field; [] when clean
 */
export function validateStatusBody(body = {}) {
  const normalized = normalizeStatusBody(body);
  const errors = [];
  for (const [key, raw] of Object.entries(normalized)) {
    const msg = validateFieldValue({ kind: semanticKind(key), required: false }, valueOf(raw));
    if (msg) errors.push(`${key}: ${msg}`);
  }
  return errors;
}

/** "Delayed" + "crew availability" → "Delayed — crew availability". */
export function transitStatusDisplay(status, reason) {
  return [status, reason].filter(Boolean).join(" — ");
}

/**
 * Default lock-screen banner text per status semantic. iOS shows a notification
 * only when a RENDERED field whose `changeMessage` contains `%@` changes value
 * (a semantics-only change never notifies). The status paths attach one of these
 * to the visible field they update, unless the caller (or the field already)
 * carries its own `changeMessage`. `%@` is replaced by the field's NEW (formatted)
 * value on the device.
 * @type {Readonly<Record<string, string>>}
 */
export const STATUS_CHANGE_MESSAGES = Object.freeze({
  departureGate: "Gate changed to %@",
  destinationGate: "Arrival gate now %@",
  departureTerminal: "Departure terminal %@",
  destinationTerminal: "Arrival terminal %@",
  currentBoardingDate: "Boarding now %@",
  currentDepartureDate: "Departure now %@",
  currentArrivalDate: "Arrival now %@",
  transitProvider: "%@",
  securityScreening: "%@"
});

/** The bare placeholder; iOS substitutes the new value. */
export const DEFAULT_CHANGE_MESSAGE = "%@";

/** Banner text for a status semantic, falling back to the bare `%@`. */
export function changeMessageFor(semanticKey) {
  return STATUS_CHANGE_MESSAGES[semanticKey] ?? DEFAULT_CHANGE_MESSAGE;
}

/**
 * Pure: returns new data; never mutates the input. Body keys are semantic
 * keys (normalize aliases first via {@link normalizeStatusBody}) plus
 * `delayed` (visible DELAY info row; "" clears). Empty-string semantic values
 * clear the semantic.
 * @param {object} data      per-pass template data as stored
 * @param {object} body      status-update request body (semantic vocabulary)
 * @param {Record<string, {fieldKey: string}>} bindings the template's binding map
 * @returns {{data: object, skipped: string[]}}
 */
export function applyStatusToTemplateData(data, body = {}, bindings = {}) {
  const next = structuredClone(data ?? {});
  const semantics = { ...(next.semantics ?? {}) };
  const skipped = [];

  const setBoundField = (semKey, raw) => {
    const fieldKey = bindings[semKey]?.fieldKey;
    if (!fieldKey) { skipped.push(semKey); return; }
    const patch = isPatch(raw) ? { ...raw } : { value: raw };
    const existing = next[fieldKey];
    // A rendered field needs a changeMessage to raise a lock-screen banner.
    // Default one (per-semantic) unless the caller supplied a changeMessage or
    // the field already carries its own. Always object form so the message
    // ships alongside the value.
    const existingCM = isPatch(existing) ? existing.changeMessage : undefined;
    if (patch.changeMessage === undefined && existingCM === undefined) {
      patch.changeMessage = changeMessageFor(semKey);
    }
    next[fieldKey] = { ...(isPatch(existing) ? existing : {}), ...patch };
  };

  const upsertInfoRow = (key, row) => {
    const rest = (next.additionalInfoFields ?? []).filter(f => f.key !== key);
    next.additionalInfoFields = row ? [...rest, row] : rest;
  };

  for (const [key, raw] of Object.entries(body)) {
    if (key === "delayed") {
      const v = valueOf(raw);
      upsertInfoRow("delay", v ? { key: "delay", label: "DELAY", value: v, changeMessage: "%@" } : null);
      continue;
    }
    // transitStatus/Reason are handled together below (the status row composes both).
    if (key === "transitStatus" || key === "transitStatusReason") continue;
    const type = BOARDING_SEMANTICS[key];
    if (type !== "string" && type !== "date") continue;   // structured/unknown keys: not settable via status
    const v = valueOf(raw);
    if (type === "date") assertStrictIsoDateTime(key, v);
    if (v) semantics[key] = v; else delete semantics[key];
    setBoundField(key, raw);
  }

  // transitStatus/transitStatusReason: the semantic status line iOS 26 keys
  // off, mirrored as a visible "status" row whose changeMessage ("%@") makes
  // the push banner carry the new value ("Delayed — crew availability").
  // Empty strings clear both the semantics and the row.
  if (body.transitStatus !== undefined || body.transitStatusReason !== undefined) {
    if (body.transitStatus !== undefined) {
      const v = valueOf(body.transitStatus);
      if (v) semantics.transitStatus = v; else delete semantics.transitStatus;
    }
    if (body.transitStatusReason !== undefined) {
      const v = valueOf(body.transitStatusReason);
      if (v) semantics.transitStatusReason = v; else delete semantics.transitStatusReason;
    }
    const display = transitStatusDisplay(semantics.transitStatus, semantics.transitStatusReason);
    upsertInfoRow("status", display ? { key: "status", label: "STATUS", value: display, changeMessage: "%@" } : null);
  }

  if (Object.keys(semantics).length || next.semantics) next.semantics = semantics;
  return { data: next, skipped };
}

/**
 * Template placeholder semantics that must NEVER survive onto an issued pass:
 * Pass Designer pre-fills them with sample values (the sample flight's
 * timestamps, sample passenger, sample seat). At issue time they are cleared
 * (null deletes at merge time) unless re-derived from per-passenger data or
 * set explicitly under data.semantics.
 */
export const VOLATILE_ISSUE_SEMANTICS = Object.freeze([...SEMANTIC_DATE_KEYS, "passengerName", "seats"]);

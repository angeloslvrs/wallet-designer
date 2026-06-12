// Status-update vocabulary → template per-pass data.
//
// This is the template-pass twin of applyStatus in routes/admin.js: it accepts
// the same body ({gate, boarding, depart, arrive, transitInfo,
// securityScreening, delayed, transitStatus, transitStatusReason}) so the ops
// console drives both pass shapes with one API. Semantics always update;
// visible fields update only when the template declares the key, otherwise the
// key lands in `skipped` so the caller can surface it.
//
// Body values may be plain ("B12") or the object form ({value, changeMessage})
// — visible fields keep the whole patch (so a push can carry a lock-screen
// banner), semantics always take the .value.
//
// NOTE: the field-key names ("gate", "boarding", "depart-time") follow
// templates/dev-sample.pkpasstemplate, which mirrors form-to-pass.js. This is
// the ONLY place the server assumes template key conventions — when a real
// Pass Designer export lands, verify its pass.json against these keys.

import { seatSemantics, splitPersonName } from "@wpd/pass-builder";

const isPatch = (raw) => raw !== null && typeof raw === "object" && !Array.isArray(raw);
const valueOf = (raw) => (isPatch(raw) ? raw.value : raw);

/** "Delayed" + "crew availability" → "Delayed — crew availability". */
export function transitStatusDisplay(status, reason) {
  return [status, reason].filter(Boolean).join(" — ");
}

/**
 * Pure: returns new data; never mutates the input.
 * @param {object} data        per-pass template data as stored
 * @param {object} body        status-update request body
 * @param {string[]} fieldKeys keys the target template declares
 * @returns {{data: object, skipped: string[]}}
 */
export function applyStatusToTemplateData(data, body = {}, fieldKeys = []) {
  const next = structuredClone(data ?? {});
  const semantics = { ...(next.semantics ?? {}) };
  const skipped = [];

  const setField = (key, raw) => {
    if (!fieldKeys.includes(key)) { skipped.push(key); return; }
    const patch = isPatch(raw) ? { ...raw } : { value: raw };
    const existing = next[key];
    const keepObject = isPatch(existing) || Object.keys(patch).length > 1;
    next[key] = keepObject ? { ...(isPatch(existing) ? existing : {}), ...patch } : patch.value;
  };

  const upsertInfoRow = (key, row) => {
    const rest = (next.additionalInfoFields ?? []).filter(f => f.key !== key);
    next.additionalInfoFields = row ? [...rest, row] : rest;
  };

  const {
    gate, boarding, depart, arrive, transitInfo, securityScreening, delayed,
    transitStatus, transitStatusReason
  } = body;
  if (gate !== undefined)     { setField("gate", gate); semantics.departureGate = valueOf(gate); }
  if (boarding !== undefined) { setField("boarding", boarding); semantics.currentBoardingDate = valueOf(boarding); }
  if (depart !== undefined)   { setField("depart-time", depart); semantics.currentDepartureDate = valueOf(depart); }
  if (arrive !== undefined)   { semantics.currentArrivalDate = valueOf(arrive); }
  if (transitInfo !== undefined)       semantics.transitProvider = valueOf(transitInfo);
  if (securityScreening !== undefined) semantics.securityScreening = valueOf(securityScreening);
  if (delayed !== undefined) {
    const v = valueOf(delayed);
    upsertInfoRow("delay", v ? { key: "delay", label: "DELAY", value: v } : null);
  }

  // transitStatus/transitStatusReason: the semantic status line iOS 26 keys
  // off, mirrored as a visible "status" row whose changeMessage ("%@") makes
  // the push banner carry the new value ("Delayed — crew availability").
  // Empty strings clear both the semantics and the row.
  if (transitStatus !== undefined || transitStatusReason !== undefined) {
    if (transitStatus !== undefined) {
      const v = valueOf(transitStatus);
      if (v) semantics.transitStatus = v; else delete semantics.transitStatus;
    }
    if (transitStatusReason !== undefined) {
      const v = valueOf(transitStatusReason);
      if (v) semantics.transitStatusReason = v; else delete semantics.transitStatusReason;
    }
    const display = transitStatusDisplay(semantics.transitStatus, semantics.transitStatusReason);
    upsertInfoRow("status", display ? { key: "status", label: "STATUS", value: display, changeMessage: "%@" } : null);
  }

  if (Object.keys(semantics).length || next.semantics) next.semantics = semantics;
  return { data: next, skipped };
}

// Issue-time mapping: per-passenger field keys whose values are plain strings
// that map 1:1 onto a pass-level semantic.
const ISSUE_SEMANTICS_KEYS = {
  gate: "departureGate",
  confirmation: "confirmationNumber",
  "fare-class": "ticketFareClass",
  priority: "priorityStatus"
};

/**
 * Issue-time twin of the status mapping: derive pass semantics from
 * per-passenger field data so an issued pass never ships the template's
 * placeholder semantics (passengerName, seats, confirmationNumber, …).
 * Pure; the caller decides precedence (routes/admin.js lets explicit
 * data.semantics win over what is derived here).
 * @param {object} [data]              per-pass template data, by field key
 * @param {object} [templateSemantics] the template's own semantics block
 * @returns {object} derived semantics (empty when nothing is derivable)
 */
export function deriveIssueSemantics(data = {}, templateSemantics = {}) {
  const out = {};
  for (const [key, semantic] of Object.entries(ISSUE_SEMANTICS_KEYS)) {
    const v = valueOf(data?.[key]);
    if (v) out[semantic] = v;
  }
  const passenger = valueOf(data?.passenger);
  if (passenger) out.passengerName = splitPersonName(passenger);
  const seat = valueOf(data?.seat);
  if (seat) {
    const seatType = templateSemantics?.seats?.[0]?.seatType;
    out.seats = [seatSemantics(seat, seatType ? { seatType } : {})];
  }
  return out;
}

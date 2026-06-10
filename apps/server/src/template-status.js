// Status-update vocabulary → template per-pass data.
//
// This is the template-pass twin of applyStatus in routes/admin.js: it accepts
// the same body ({gate, boarding, depart, arrive, transitInfo,
// securityScreening, delayed}) so the ops console drives both pass shapes with
// one API. Semantics always update; visible fields update only when the
// template declares the key, otherwise the key lands in `skipped` so the
// caller can surface it.
//
// NOTE: the field-key names ("gate", "boarding", "depart-time") follow
// templates/dev-sample.pkpasstemplate, which mirrors form-to-pass.js. This is
// the ONLY place the server assumes template key conventions — when a real
// Pass Designer export lands, verify its pass.json against these keys.

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

  const setField = (key, value) => {
    if (!fieldKeys.includes(key)) { skipped.push(key); return; }
    const existing = next[key];
    next[key] = existing !== null && typeof existing === "object" && !Array.isArray(existing)
      ? { ...existing, value }
      : value;
  };

  const { gate, boarding, depart, arrive, transitInfo, securityScreening, delayed } = body;
  if (gate !== undefined)     { setField("gate", gate); semantics.departureGate = gate; }
  if (boarding !== undefined) { setField("boarding", boarding); semantics.currentBoardingDate = boarding; }
  if (depart !== undefined)   { setField("depart-time", depart); semantics.currentDepartureDate = depart; }
  if (arrive !== undefined)   { semantics.currentArrivalDate = arrive; }
  if (transitInfo !== undefined)       semantics.transitProvider = transitInfo;
  if (securityScreening !== undefined) semantics.securityScreening = securityScreening;
  if (delayed !== undefined) {
    const rest = (next.additionalInfoFields ?? []).filter(f => f.key !== "delay");
    next.additionalInfoFields = delayed
      ? [...rest, { key: "delay", label: "DELAY", value: delayed }]
      : rest;
  }

  if (Object.keys(semantics).length) next.semantics = semantics;
  return { data: next, skipped };
}

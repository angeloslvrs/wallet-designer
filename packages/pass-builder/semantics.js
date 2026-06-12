// Shared semantic-field derivation used by both pass shapes: the FormState
// emitter (form-to-pass.js) and the template issue/status conventions
// (apps/server/src/template-status.js).

const SEAT_RE = /^(\d+)\s*([A-Za-z]+)$/;

/**
 * PassSeat semantics from the canonical seat number ("38K" → row "38",
 * section "K"). Row/section are DERIVED from the number, never taken from
 * separate input, so they cannot disagree with it — a stale row that
 * disagreed with the number used to render as a doubled seat on iOS (e.g.
 * "3838"). Unparseable numbers stay seatNumber-only.
 * @param {string} number
 * @param {Record<string, any>} [extra] additional PassSeat fields (seatType, seatDescription, …)
 * @returns {Record<string, any>}
 */
export function seatSemantics(number, extra = {}) {
  const m = SEAT_RE.exec((number ?? "").trim());
  return {
    seatNumber: number,
    ...(m && { seatRow: m[1], seatSection: m[2].toUpperCase() }),
    ...extra
  };
}

/**
 * "ANGELO SOLIVERES" → {givenName: "ANGELO", familyName: "SOLIVERES"}.
 * Multi-word given names keep everything but the last word; single-word
 * names land in both (the historical form-to-pass behavior).
 * @param {string} full
 * @returns {{givenName: string, familyName: string}}
 */
export function splitPersonName(full) {
  const trimmed = (full ?? "").trim();
  const parts = trimmed.split(/\s+/);
  return { givenName: parts.slice(0, -1).join(" ") || trimmed, familyName: parts.at(-1) ?? "" };
}

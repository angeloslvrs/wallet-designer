// Pure derivation of a pass's relevantDate(s) + expirationDate from its flight
// semantics. A boarding pass with no expirationDate and a stale hand-entered
// relevantDate gets bucketed into Wallet's "Expired" once that date passes — so
// we ALWAYS re-derive the relevance from the flight: the singular relevantDate
// AND a fresh relevantDates interval (never trusting the incoming array), plus
// an expirationDate (custom, or arrival + 1 day).

// Re-derivation tolerates legacy stored dates that lack seconds/offset (the old
// designer let the offset field be blank). Fresh input is still validated
// strictly at the designer/issue/status boundaries — see iso-date.js.
import { isLooseIsoDateTime, parseLooseIsoDateTime } from "./iso-date.js";

const pad = (n) => String(n).padStart(2, "0");

/**
 * Add whole days to the DATE part of an ISO datetime, preserving time-of-day
 * and UTC offset (wall-clock arithmetic — no epoch/local round-trip).
 * @param {string} iso
 * @param {number} days
 * @returns {string|undefined}
 */
export function addDaysPreservingOffset(iso, days) {
  const parsed = parseLooseIsoDateTime(iso);
  if (!parsed) return undefined;
  const base = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  base.setUTCDate(base.getUTCDate() + days);
  const date = `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`;
  return `${date}T${parsed.time}${parsed.fraction}${parsed.offset}`;
}

/**
 * Return a NEW pass.json with relevantDate + relevantDates + expirationDate
 * derived from its flight semantics. Custom expiry wins; otherwise arrival + 1
 * day. The incoming `relevantDates` array is always discarded and re-derived
 * from the live schedule (boarding → arrival interval).
 * @param {object} passJson
 * @param {{expirationDate?: string}} [opts]
 * @returns {object}
 */
export function applyPassDates(passJson, opts = {}) {
  const sem = passJson?.semantics ?? {};
  const out = { ...passJson };

  const rel = sem.currentBoardingDate ?? sem.currentDepartureDate ?? sem.originalBoardingDate ?? sem.originalDepartureDate;
  // The incoming plural array is never trusted (stale hand-entered values bucket
  // the pass into "Expired"). Re-derive BOTH the singular relevantDate AND a
  // fresh relevantDates interval from the live flight schedule, so iOS 26's
  // relevance window / boarding-pass Live Activity gets the richer signal with
  // no staleness risk. Interval = boarding → arrival (falls back to a single
  // point when only one usable date exists).
  delete out.relevantDates;
  if (isLooseIsoDateTime(rel)) {
    const start = rel.trim();
    out.relevantDate = start;
    const endRaw = sem.currentArrivalDate ?? sem.currentDepartureDate ?? sem.originalArrivalDate ?? sem.originalDepartureDate;
    const end = isLooseIsoDateTime(endRaw) ? endRaw.trim() : undefined;
    out.relevantDates = end && end !== start ? [{ startDate: start, endDate: end }] : [{ date: start }];
  }

  const custom = opts.expirationDate;
  const arrival = sem.currentArrivalDate ?? sem.originalArrivalDate ?? sem.currentDepartureDate ?? sem.originalDepartureDate;
  const exp = isLooseIsoDateTime(custom) ? custom.trim() : addDaysPreservingOffset(arrival, 1);
  if (exp) out.expirationDate = exp;

  return out;
}

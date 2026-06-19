// Pure derivation of a pass's relevantDate + expirationDate from its flight
// semantics. A boarding pass with no expirationDate and a stale hand-entered
// relevantDate gets bucketed into Wallet's "Expired" once that date passes —
// so we ALWAYS derive relevantDate from the flight (dropping any stale
// relevantDates) and emit an expirationDate (custom, or arrival + 1 day).

const ISO_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)(\.\d+)?([+-]\d{2}:\d{2}|Z)?$/;
const pad = (n) => String(n).padStart(2, "0");

/**
 * Add whole days to the DATE part of an ISO datetime, preserving time-of-day
 * and UTC offset (wall-clock arithmetic — no epoch/local round-trip).
 * @param {string} iso
 * @param {number} days
 * @returns {string|undefined}
 */
export function addDaysPreservingOffset(iso, days) {
  const m = ISO_RE.exec(String(iso ?? "").trim());
  if (!m) return undefined;
  const [, y, mo, d, time, , frac, offset] = m;
  const base = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  base.setUTCDate(base.getUTCDate() + days);
  const date = `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`;
  const hms = time.length === 5 ? `${time}:00` : time;
  return `${date}T${hms}${frac ?? ""}${offset ?? ""}`;
}

const isIso = (v) => typeof v === "string" && ISO_RE.test(v.trim());

/**
 * Return a NEW pass.json with relevantDate + expirationDate derived from its
 * flight semantics. Custom expiry wins; otherwise arrival + 1 day. The stale
 * `relevantDates` array is dropped whenever a flight date is available.
 * @param {object} passJson
 * @param {{expirationDate?: string}} [opts]
 * @returns {object}
 */
export function applyPassDates(passJson, opts = {}) {
  const sem = passJson?.semantics ?? {};
  const out = { ...passJson };

  const rel = sem.currentBoardingDate ?? sem.currentDepartureDate ?? sem.originalBoardingDate ?? sem.originalDepartureDate;
  delete out.relevantDates; // legacy plural array is never trusted — relevantDate is derived from semantics
  if (isIso(rel)) out.relevantDate = rel.trim();

  const custom = opts.expirationDate;
  const arrival = sem.currentArrivalDate ?? sem.originalArrivalDate ?? sem.currentDepartureDate ?? sem.originalDepartureDate;
  const exp = isIso(custom) ? custom.trim() : addDaysPreservingOffset(arrival, 1);
  if (exp) out.expirationDate = exp;

  return out;
}

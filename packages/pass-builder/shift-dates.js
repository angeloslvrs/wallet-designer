// Shift a pass's schedule so it's relevant "now" — for live Live-Activity demos.
// Pure: returns a new FormState, never mutates the input.

/**
 * Re-anchor all schedule datetimes so departure falls `leadMinutes` from `now`,
 * preserving the original gaps between gate-open / boarding / depart / arrive and
 * the iOS 26 relevant + upcoming dates. Datetimes are re-emitted at a fixed UTC
 * offset (default +08:00, MNL/TPE) so the displayed local time still reads naturally.
 *
 * @param {object} state  FormState
 * @param {{leadMinutes?:number, offsetMinutes?:number, now?:number}} [opts]
 * @returns {object} new FormState
 */
export function shiftPassDates(state, { leadMinutes = 60, offsetMinutes = 480, now = Date.now() } = {}) {
  const anchor = Date.parse(state?.flight?.departure?.depart ?? "");
  if (Number.isNaN(anchor)) return state; // nothing to anchor on — leave untouched
  const delta = (now + leadMinutes * 60000) - anchor;

  const shift = (iso) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? iso : toOffsetISO(t + delta, offsetMinutes);
  };

  const next = structuredClone(state);
  const dep = next.flight.departure;
  const arr = next.flight.arrival;
  for (const k of ["gateOpen", "boarding", "depart"]) if (dep?.[k]) dep[k] = shift(dep[k]);
  if (arr?.arrive) arr.arrive = shift(arr.arrive);

  const ios = next.iOS26;
  if (Array.isArray(ios?.relevantDates)) ios.relevantDates = ios.relevantDates.map(shift);
  if (Array.isArray(ios?.upcomingPassInformation)) {
    ios.upcomingPassInformation = ios.upcomingPassInformation.map(e =>
      e?.date ? { ...e, date: shift(e.date) } : e
    );
  }
  return next;
}

/** Format an epoch-ms instant as an ISO string at a fixed UTC offset (minutes). */
function toOffsetISO(ms, offsetMinutes) {
  const d = new Date(ms + offsetMinutes * 60000);
  const p = (n) => String(n).padStart(2, "0");
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

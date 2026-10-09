// Routes — the reusable middle tier of Airline › Route › Flight. A route holds
// what every flight of e.g. "PR 2987 MNL → TAC" shares: flight identity,
// airports and times of day. Never a date, gate or passenger: issuing picks the
// date (the Flight) and passengers. Values are keyed by SEMANTIC (polarity
// rule); only template fields with no bound semantic are keyed by field key.
// Browser-safe: the Issue workspace and the server both use it.

import { SEMANTIC_CATALOG } from "./semantics.js";

/** A route id is a file stem, like a design name. */
export const ROUTE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// Gates are the Flight's (they change per day); schedule dates are composed at
// issue from `schedule`; everything passenger/status-shaped is per pass.
const FLIGHT_LEVEL = new Set(["departureGate", "destinationGate"]);
export const ROUTE_SEMANTICS = new Set([
  "airlineCode", "flightCode", "flightNumber", "duration",
  ...Object.entries(SEMANTIC_CATALOG).filter(([k, v]) => v.group === "route" && !FLIGHT_LEVEL.has(k)).map(([k]) => k)
]);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Problems with a route body (empty = valid).
 * @param {*} r
 * @returns {string[]}
 */
export function validateRoute(r) {
  if (!isObj(r)) return ["route must be an object"];
  const out = [];
  const t = r.template;
  if (!isObj(t) || !["studio", "designer"].includes(t.kind) || typeof t.id !== "string" || !ROUTE_ID_RE.test(t.id)) {
    out.push('template must be {kind: "studio"|"designer", id}');
  }
  if (r.values !== undefined) {
    if (!isObj(r.values)) out.push("values must be an object of semanticKey → value");
    else for (const k of Object.keys(r.values)) if (!ROUTE_SEMANTICS.has(k)) out.push(`values.${k} is not a route value (gates, dates and passenger data belong to the flight or pass)`);
  }
  if (r.schedule !== undefined) {
    if (!isObj(r.schedule)) out.push("schedule must be an object");
    else {
      for (const k of ["boarding", "departure", "arrival"]) {
        const v = r.schedule[k];
        if (v !== undefined && v !== "" && !(typeof v === "string" && TIME_RE.test(v))) out.push(`schedule.${k} must be HH:MM`);
      }
      const d = r.schedule.arrivalDayOffset;
      if (d !== undefined && !(Number.isInteger(d) && d >= 0 && d <= 3)) out.push("schedule.arrivalDayOffset must be 0–3");
      for (const k of Object.keys(r.schedule)) if (!["boarding", "departure", "arrival", "arrivalDayOffset"].includes(k)) out.push(`schedule.${k} is unknown`);
    }
  }
  if (r.fields !== undefined) {
    if (!isObj(r.fields)) out.push("fields must be an object of fieldKey → text");
    else for (const [k, v] of Object.entries(r.fields)) if (typeof v !== "string") out.push(`fields.${k} must be text`);
  }
  return out;
}

/** "2026-10-31" + n days, as a date string. */
function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The flight's schedule semantics for one date: each time of day in its
 * airport's zone (arrival in the destination's, falling back to the departure
 * zone), arrival shifted by `arrivalDayOffset`.
 * @param {{values?: object, schedule?: object}} route
 * @param {string} date YYYY-MM-DD
 * @param {(localIso: string, zone: string) => string|null} offsetFor e.g. inputs.js zoneOffset
 * @returns {{currentBoardingDate?: string, currentDepartureDate?: string, currentArrivalDate?: string}}
 */
export function routeSchedule(route, date, offsetFor) {
  if (typeof date !== "string" || !DATE_RE.test(date)) return {};
  const v = route?.values ?? {}, s = route?.schedule ?? {};
  const depZone = v.departureAirportTimeZone ?? v.departureLocationTimeZone;
  const arrZone = v.destinationAirportTimeZone ?? v.destinationLocationTimeZone ?? depZone;
  const at = (day, time, zone) => {
    if (!time || !TIME_RE.test(time)) return undefined;
    const local = `${day}T${time}`;
    const off = zone ? offsetFor(local, zone) : null;
    return `${local}:00${off ?? ""}`;
  };
  const out = {
    currentBoardingDate: at(date, s.boarding, depZone),
    currentDepartureDate: at(date, s.departure, depZone),
    currentArrivalDate: at(addDays(date, s.arrivalDayOffset ?? 0), s.arrival, arrZone)
  };
  return Object.fromEntries(Object.entries(out).filter(([, x]) => x !== undefined));
}

/** "PR2987-MNL-TAC" from a route's values (best effort; "route" when empty). */
export function suggestRouteId(values = {}) {
  const flight = values.flightCode || (values.airlineCode && values.flightNumber !== undefined ? `${values.airlineCode}${values.flightNumber}` : "");
  const parts = [flight, values.departureAirportCode, values.destinationAirportCode].filter(Boolean).map(p => String(p).replace(/[^A-Za-z0-9]/g, ""));
  const id = parts.filter(Boolean).join("-");
  return ROUTE_ID_RE.test(id) ? id : "route";
}

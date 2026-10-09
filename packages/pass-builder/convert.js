// "Make airline from this design" — split a flat Studio design (look + route +
// a sample flight + a sample passenger, all in one FormState) into the
// Airline › Route tiers: a value-less airline design, its bindings, and a route.
// planConversion proposes a tier for every value (with flags for things a
// human should look at); applyConversion applies the operator's decisions.
// Pure and browser-safe: the Templates review screen runs both.
//
// Tiers per item: "airline" = keep it in the airline design · "route" = move it
// into the route (or, for a label / time text, convert it so the route drives
// it) · "drop" = clear it (flight-day and passenger values: issuing sets them).

import { SEMANTIC_CATALOG, SEMANTIC_DATE_KEYS } from "./semantics.js";
import { ROUTE_SEMANTICS, suggestRouteId } from "./route.js";

const ZONES = ["header", "primary", "secondary", "auxiliary", "back"];
const SCHEDULE = [["boarding", "currentBoardingDate", "originalBoardingDate"], ["departure", "currentDepartureDate", "originalDepartureDate"], ["arrival", "currentArrivalDate", "originalArrivalDate"]];
const AIRPORT_LABELS = {
  departureAirportCode: ["departureCityName", "departureAirportName"],
  destinationAirportCode: ["destinationCityName", "destinationAirportName"]
};
const GENERIC_ORG_WORDS = new Set(["airline", "airlines", "airways", "air", "the"]);
// Event-guide links about one airport (parking, directions, transit): kept on
// the airline they'd show for every route, so they're suggested for dropping.
const AIRPORT_GUIDE_KEYS = new Set(["parkingInformationURL", "directionsInformationURL", "transitInformationURL"]);
const TIME_NAME = { currentBoardingDate: "boarding time", currentDepartureDate: "departure time", currentArrivalDate: "arrival time" };

const isEmpty = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) ||
  (typeof v === "object" && !Array.isArray(v) && !Object.values(v).some(x => x !== undefined && x !== null && x !== ""));
const show = (v) => (typeof v === "object" ? JSON.stringify(v) : String(v));
const hhmm = (iso) => (typeof iso === "string" ? /T(\d{2}:\d{2})/.exec(iso)?.[1] : undefined);
const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "airline";

/** Every field of the design with where it lives. */
function allFields(state) {
  const out = [];
  for (const zone of ZONES) (state.displayFields?.[zone] ?? []).forEach((f, i) => out.push({ f, zone, i, extra: false }));
  (state.iOS26?.additionalInfoFields ?? []).forEach((f, i) => out.push({ f, zone: "additionalInfo", i, extra: true }));
  return out;
}

/** "16:05" / "4:05 PM" → "16:05" (null when it isn't a time). */
function textTime(v) {
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/.exec(String(v ?? "").trim());
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]) { const pm = /p/i.test(m[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  return h > 23 ? null : `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** Words that identify this airline in a URL host or wifi name. */
function airlineWords(state) {
  const code = String(state.semantics?.airlineCode ?? "").toLowerCase();
  const org = String(state.meta?.organizationName ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !GENERIC_ORG_WORDS.has(w));
  return { code, org };
}
function looksForeign(text, words) {
  const tokens = String(text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.code && !words.org.length) return false;
  return !tokens.some(t => t === words.code || words.org.some(w => t.includes(w)));
}
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return String(url ?? ""); } };

/**
 * Propose a tier for every value in the design.
 * @param {object} state  the design's FormState (new shape)
 * @param {Record<string, string>} bindings semanticKey → fieldKey (discovered or confirmed)
 * @returns {{items: object[], airlineCode: string, suggestedName: string, suggestedRouteId: string}}
 */
export function planConversion(state, bindings = {}) {
  const sem = state.semantics ?? {};
  const items = [];
  const boundSem = Object.fromEntries(Object.entries(bindings).map(([s, k]) => [k, s]));
  const words = airlineWords(state);

  // Semantics (schedule dates collapse into one "schedule" item).
  const dateKeys = new Set(SEMANTIC_DATE_KEYS);
  for (const [k, v] of Object.entries(sem)) {
    if (isEmpty(v) || dateKeys.has(k)) continue;
    const label = SEMANTIC_CATALOG[k]?.label ?? k;
    if (k === "airlineCode") items.push({ id: `sem:${k}`, group: "Flight data", what: label, value: show(v), tier: "airline", options: ["airline"] });
    else if (ROUTE_SEMANTICS.has(k)) items.push({ id: `sem:${k}`, group: "Flight data", what: label, value: show(v), tier: "route", options: ["route", "airline", "drop"] });
    else items.push({ id: `sem:${k}`, group: "Flight data", what: label, value: show(v), tier: "drop", options: ["drop", "airline"], note: SEMANTIC_CATALOG[k] ? "Set per flight or passenger when issuing" : "Not an Apple boarding tag" });
  }
  const times = Object.fromEntries(SCHEDULE.map(([name, cur, orig]) => [name, hhmm(sem[cur] ?? sem[orig])]).filter(([, t]) => t));
  if (Object.keys(times).length) {
    items.push({ id: "schedule", group: "Flight data", what: "Schedule", value: Object.entries(times).map(([n, t]) => `${n} ${t}`).join(" · "), tier: "route", options: ["route", "drop"], note: "The route keeps the times; issuing picks the date" });
  }

  // Fields: airport labels that name the place, typed time text, unbound values.
  for (const { f, extra } of allFields(state)) {
    const bound = boundSem[f.key];
    const label = String(f.label ?? "");
    if (AIRPORT_LABELS[bound] && label.trim()) {
      const [cityKey, nameKey] = AIRPORT_LABELS[bound];
      const city = String(sem[cityKey] ?? "").trim();
      if (city && label.toUpperCase().startsWith(city.toUpperCase())) {
        const rest = label.slice(city.length).trim();
        const tokens = rest ? `{${cityKey}:upper} {${nameKey}:upper}` : `{${cityKey}:upper}`;
        const name = String(sem[nameKey] ?? "").trim() || rest;
        const reads = [city, rest ? name : ""].filter(Boolean).join(" ").toUpperCase();
        items.push({ id: `label:${f.key}`, group: "Labels", what: `${f.key} label`, value: label, tier: "route", options: ["route", "airline"], label: tokens, liftName: rest && !String(sem[nameKey] ?? "").trim() ? { key: nameKey, value: rest } : undefined, note: `Fills from each route — this one reads “${reads}”` });
      } else if ([sem[cityKey], sem[nameKey], sem[bound]].some(x => x && label.toUpperCase().includes(String(x).toUpperCase()))) {
        items.push({ id: `label:${f.key}`, group: "Labels", what: `${f.key} label`, value: label, tier: "airline", options: ["airline"], flag: "Names a place — every route will show it. Edit the label in Design after converting." });
      }
    }
    if (bound) continue;
    const t = textTime(f.value);
    if (t) {
      const hits = SCHEDULE.filter(([name]) => times[name] === t);
      if (hits.length === 1) {
        const [, cur] = hits[0];
        const format = /[ap]m/i.test(String(f.value)) ? "phone" : "24h";
        items.push({ id: `time:${f.key}`, group: "Fields", what: `${f.key} (${label || "no label"})`, value: String(f.value), tier: "route", options: ["route", "airline"], semantic: cur, format, note: `Becomes the ${TIME_NAME[cur]}, shown ${format === "24h" ? "24-hour" : "in the phone’s format"}` });
        continue;
      }
    }
    if (isEmpty(f.value)) continue;
    items.push(extra
      ? { id: `field:${f.key}`, group: "iOS 26 extras", what: `${f.key} (${label || "no label"})`, value: String(f.value), tier: "drop", options: ["drop", "route", "airline"], note: "Usually per passenger — set when issuing" }
      : { id: `field:${f.key}`, group: "Fields", what: `${f.key} (${label || "no label"})`, value: String(f.value), tier: "route", options: ["route", "airline", "drop"] });
  }

  // iOS 26 extras: links and wifi stay with the airline unless they look like another airline's.
  for (const [k, url] of Object.entries(state.iOS26?.eventGuide ?? {})) {
    if (isEmpty(url)) continue;
    if (AIRPORT_GUIDE_KEYS.has(k)) {
      items.push({ id: `eventGuide:${k}`, group: "iOS 26 extras", what: k, value: String(url), tier: "drop", options: ["airline", "drop"], flag: "About one airport — on the airline it would show for every route" });
      continue;
    }
    const foreign = looksForeign(hostOf(url), words);
    items.push({ id: `eventGuide:${k}`, group: "iOS 26 extras", what: k, value: String(url), tier: foreign ? "drop" : "airline", options: ["airline", "drop"], ...(foreign && { flag: "Not this airline’s site — another airline’s link?" }) });
  }
  // Services page links are the airline's; flag ones that point at another airline.
  for (const [k, v] of Object.entries(state.services ?? {})) {
    if (isEmpty(v)) continue;
    const where = /Email$/.test(k) ? String(v).split("@")[1] : /PhoneNumber$/.test(k) ? null : hostOf(v);
    const foreign = where !== null && looksForeign(where, words);
    items.push({ id: `services:${k}`, group: "Services page", what: k, value: String(v), tier: foreign ? "drop" : "airline", options: ["airline", "drop"], ...(foreign && { flag: "Not this airline’s site — another airline’s link?" }) });
  }
  (state.iOS26?.wifi ?? []).forEach((w, i) => {
    const foreign = looksForeign(w?.ssid, words);
    items.push({ id: `wifi:${i}`, group: "iOS 26 extras", what: "Wi-Fi", value: String(w?.ssid ?? ""), tier: foreign ? "drop" : "airline", options: ["airline", "drop"], ...(foreign && { flag: "Looks like another airline’s network" }) });
  });
  if (state.iOS26?.upcomingPassInformation?.length) items.push({ id: "upcomingPassInformation", group: "iOS 26 extras", what: "Upcoming events", value: state.iOS26.upcomingPassInformation.map(e => e.name).join(", "), tier: "drop", options: ["drop"], note: "Dated — belongs to one flight" });
  if (state.iOS26?.relevantDates?.length) items.push({ id: "relevantDates", group: "iOS 26 extras", what: "Relevant dates", value: state.iOS26.relevantDates.join(", "), tier: "drop", options: ["drop"], note: "Re-derived from each flight’s schedule" });
  if (!isEmpty(state.barcode?.message)) items.push({ id: "barcode", group: "Barcode", what: "Barcode message", value: String(state.barcode.message), tier: "drop", options: ["drop"], note: "Each pass carries its own" });

  const routeValues = Object.fromEntries(Object.entries(sem).filter(([k, v]) => ROUTE_SEMANTICS.has(k) && k !== "airlineCode" && !isEmpty(v)));
  return {
    items,
    airlineCode: String(sem.airlineCode ?? ""),
    suggestedName: slug(state.meta?.organizationName),
    suggestedRouteId: suggestRouteId({ ...routeValues, airlineCode: sem.airlineCode })
  };
}

/**
 * Apply the operator's decisions (item id → tier; missing = the suggestion).
 * @returns {{airline: object, bindings: Record<string, string>, route: {values: object, schedule: object, fields: object}}}
 */
export function applyConversion(state, bindings, plan, decisions = {}) {
  const tier = (it) => (it.options.includes(decisions[it.id]) ? decisions[it.id] : it.tier);
  const decided = Object.fromEntries(plan.items.map(it => [it.id, { ...it, chosen: tier(it) }]));
  const sem = state.semantics ?? {};
  const airline = structuredClone(state);
  const route = { values: {}, schedule: {}, fields: {} };
  const outBindings = { ...bindings };

  // Semantics: the airline keeps what was decided "airline"; the route takes route values.
  airline.semantics = {};
  for (const [k, v] of Object.entries(sem)) {
    const it = decided[`sem:${k}`];
    if (!it) continue;
    if (it.chosen === "airline") airline.semantics[k] = v;
    else if (it.chosen === "route" && ROUTE_SEMANTICS.has(k)) route.values[k] = v;
  }
  if (decided.schedule?.chosen === "route") {
    for (const [name, cur, orig] of SCHEDULE) { const t = hhmm(sem[cur] ?? sem[orig]); if (t) route.schedule[name] = t; }
    const dep = sem.currentDepartureDate ?? sem.originalDepartureDate, arr = sem.currentArrivalDate ?? sem.originalArrivalDate;
    if (route.schedule.departure && route.schedule.arrival && dep && arr) {
      const days = Math.round((Date.parse(`${arr.slice(0, 10)}T12:00:00Z`) - Date.parse(`${dep.slice(0, 10)}T12:00:00Z`)) / 864e5);
      route.schedule.arrivalDayOffset = Math.min(3, Math.max(0, days));
    }
  }

  // Fields.
  const boundSem = Object.fromEntries(Object.entries(bindings).map(([s, k]) => [k, s]));
  const rewrite = (f) => {
    const next = { ...f };
    const lab = decided[`label:${f.key}`];
    if (lab?.chosen === "route" && lab.label) {
      next.label = lab.label;
      if (lab.liftName && decided[`sem:${lab.liftName.key}`]?.chosen !== "drop") route.values[lab.liftName.key] ??= lab.liftName.value;
    }
    const bound = boundSem[f.key];
    if (bound) {
      // A bound field shows its semantic: blank unless the semantic stays on the airline.
      if (decided[`sem:${bound}`]?.chosen !== "airline") next.value = "";
      return next;
    }
    const tm = decided[`time:${f.key}`];
    if (tm) {
      if (tm.chosen !== "route") return next;
      next.value = "";
      delete next.dateStyle; delete next.timeStyle; delete next.timeFormat;
      if (tm.format === "24h") next.timeFormat = "24h"; else next.timeStyle = "PKDateStyleShort";
      outBindings[tm.semantic] = f.key;
      return next;
    }
    const fi = decided[`field:${f.key}`];
    if (fi) {
      if (fi.chosen === "route") { route.fields[f.key] = String(f.value); next.value = ""; }
      else if (fi.chosen === "drop") next.value = "";
    }
    return next;
  };
  for (const zone of ZONES) if (airline.displayFields?.[zone]) airline.displayFields[zone] = airline.displayFields[zone].map(rewrite);

  // iOS 26 extras.
  const ios = airline.iOS26 ?? {};
  if (ios.additionalInfoFields) ios.additionalInfoFields = ios.additionalInfoFields.map(rewrite);
  if (ios.eventGuide) {
    const kept = Object.fromEntries(Object.entries(ios.eventGuide).filter(([k]) => decided[`eventGuide:${k}`]?.chosen !== "drop"));
    if (Object.keys(kept).length) ios.eventGuide = kept; else delete ios.eventGuide;
  }
  if (ios.wifi) {
    const kept = ios.wifi.filter((_, i) => decided[`wifi:${i}`]?.chosen !== "drop");
    if (kept.length) ios.wifi = kept; else delete ios.wifi;
  }
  if (airline.services) {
    airline.services = Object.fromEntries(Object.entries(airline.services).filter(([k]) => decided[`services:${k}`]?.chosen !== "drop"));
  }
  delete ios.upcomingPassInformation;
  delete ios.relevantDates;
  if (airline.iOS26) airline.iOS26 = ios;

  // Per-pass identity never belongs to a template.
  airline.barcode = { ...airline.barcode, message: "", altText: "" };
  for (const k of ["authenticationToken", "expirationDate", "groupId"]) delete airline.meta?.[k];

  return { airline, bindings: outBindings, route };
}

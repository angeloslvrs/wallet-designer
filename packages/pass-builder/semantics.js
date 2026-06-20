// Shared semantic-field derivation used by both pass shapes — the FormState
// emitter (form-to-pass.js) and the template issue/status paths
// (apps/server/src/template-status.js) — plus the hardcoded boarding-pass
// semantic vocabulary.
//
// Polarity rule: semantic tags are APPLE'S vocabulary (the fixed SemanticTags
// keys, cross-checked against the published docs list and PassSemantics.proto
// at the pinned apple/pass-builder SHA). Field keys are the DESIGNER'S
// vocabulary — arbitrary and editable per template — so code hardcodes
// semantics and discovers field bindings per template (see bindings.js),
// never the other way around.

/**
 * Airline-boarding-pass-relevant subset of Apple's semantic keys, tagged with
 * the value shape the status/issue paths must enforce:
 *  - "string": plain string
 *  - "date":   ISO 8601 string
 *  - "number", "personName", "seats": structured — derived, never set raw
 * @type {Readonly<Record<string, "string"|"date"|"number"|"personName"|"seats">>}
 */
export const BOARDING_SEMANTICS = Object.freeze({
  // flight identity
  airlineCode: "string",
  flightCode: "string",
  flightNumber: "number",
  // route
  departureAirportCode: "string",
  departureAirportName: "string",
  departureCityName: "string",
  departureLocationDescription: "string",
  departureTerminal: "string",
  departureGate: "string",
  departureLocationTimeZone: "string",
  departureAirportTimeZone: "string",
  destinationAirportCode: "string",
  destinationAirportName: "string",
  destinationCityName: "string",
  destinationLocationDescription: "string",
  destinationTerminal: "string",
  destinationGate: "string",
  destinationLocationTimeZone: "string",
  destinationAirportTimeZone: "string",
  // schedule
  originalDepartureDate: "date",
  currentDepartureDate: "date",
  originalBoardingDate: "date",
  currentBoardingDate: "date",
  originalArrivalDate: "date",
  currentArrivalDate: "date",
  // boarding
  boardingGroup: "string",
  boardingZone: "string",
  boardingSequenceNumber: "string",
  // passenger / ticket
  passengerName: "personName",
  seats: "seats",
  confirmationNumber: "string",
  ticketFareClass: "string",
  priorityStatus: "string",
  membershipProgramName: "string",
  membershipProgramNumber: "string",
  // status line / day-of-travel extras
  transitStatus: "string",
  transitStatusReason: "string",
  transitProvider: "string",
  securityScreening: "string"
});

// Richer typed catalog for the semantics-first editor. Built from
// BOARDING_SEMANTICS (its "string" maps to the "text" widget) plus the
// remaining boarding-relevant keys with their richer widget types. Rail- and
// event-only keys are intentionally excluded (see spec non-goals).
const CATALOG_TYPE = { string: "text", date: "date", number: "number", personName: "personName", seats: "seats" };

const EXTRA_SEMANTICS = {
  eventType:                 { type: "enum",        group: "flight",    label: "Event type",
                               enumOptions: ["PKEventTypeGeneric", "PKEventTypeBoarding"] },
  departureLocation:         { type: "location",    group: "route",     label: "Departure location" },
  destinationLocation:       { type: "location",    group: "route",     label: "Destination location" },
  duration:                  { type: "number",      group: "schedule",  label: "Duration (seconds)" },
  silenceRequested:          { type: "boolean",     group: "status",    label: "Silence requested" },
  internationalDocumentsAreVerified: { type: "boolean", group: "passenger", label: "Intl. documents verified" },
  internationalDocumentsVerifiedDeclarationName: { type: "text", group: "passenger", label: "Docs declaration name" },
  passengerCapabilities:     { type: "stringArray", group: "passenger", label: "Passenger capabilities" },
  passengerEligibleSecurityPrograms:   { type: "stringArray", group: "passenger", label: "Eligible security programs" },
  departureAirportSecurityPrograms:    { type: "stringArray", group: "route",     label: "Departure security programs" },
  destinationAirportSecurityPrograms:  { type: "stringArray", group: "route",     label: "Destination security programs" },
  totalPrice:                { type: "currency",    group: "pricing",   label: "Total price" },
  balance:                   { type: "currency",    group: "pricing",   label: "Balance" }
};

const SEMANTIC_GROUP = {
  airlineCode: "flight", flightCode: "flight", flightNumber: "flight",
  originalDepartureDate: "schedule", currentDepartureDate: "schedule",
  originalBoardingDate: "schedule", currentBoardingDate: "schedule",
  originalArrivalDate: "schedule", currentArrivalDate: "schedule",
  boardingGroup: "passenger", boardingZone: "passenger", boardingSequenceNumber: "passenger",
  passengerName: "passenger", seats: "passenger", confirmationNumber: "passenger",
  ticketFareClass: "passenger", priorityStatus: "passenger",
  membershipProgramName: "passenger", membershipProgramNumber: "passenger",
  transitStatus: "status", transitStatusReason: "status", transitProvider: "status", securityScreening: "status"
  // everything else (departure*/destination*) falls through to "route"
};

const humanize = (k) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();

// The required + recommended boarding sets, pinned to apple/pass-builder
// Validation/Validators/BoardingPassValidator.swift + SeatValidator.swift @ SHA
// 170f2a11 (the CI PASS_BUILDER_SHA in .github/workflows/apple-validate.yml):
// validator ERRORS -> required, validator WARNINGS -> recommended. Bump these
// together with that SHA (see tests/boarding-compliance.test.js).
export const REQUIRED_SEMANTICS = Object.freeze([
  "airlineCode", "flightNumber",
  "originalDepartureDate", "originalBoardingDate", "originalArrivalDate",
  "departureAirportCode", "departureAirportTimeZone",
  "destinationAirportCode",
  "passengerName"
]);
const REQUIRED_SET = new Set(REQUIRED_SEMANTICS);

// Validator-warning boarding fields: strongly recommended for a complete pass,
// but not hard-required (a pass without them still validates).
export const RECOMMENDED_SEMANTICS = Object.freeze([
  "departureCityName", "destinationCityName", "destinationAirportTimeZone", "seats"
]);
const RECOMMENDED_SET = new Set(RECOMMENDED_SEMANTICS);

export const SEMANTIC_CATALOG = Object.freeze({
  ...Object.fromEntries(Object.entries(BOARDING_SEMANTICS).map(([k, t]) => [k, {
    type: CATALOG_TYPE[t] ?? "text",
    group: SEMANTIC_GROUP[k] ?? "route",
    label: humanize(k),
    required: REQUIRED_SET.has(k),
    recommended: RECOMMENDED_SET.has(k)
  }])),
  ...Object.fromEntries(Object.entries(EXTRA_SEMANTICS).map(([k, e]) => [k, { ...e, required: REQUIRED_SET.has(k), recommended: RECOMMENDED_SET.has(k) }]))
});

/** The schedule-date semantic keys, derived from the catalog (single source of truth). */
export const SEMANTIC_DATE_KEYS = Object.freeze(
  Object.keys(SEMANTIC_CATALOG).filter(k => SEMANTIC_CATALOG[k].type === "date")
);

/**
 * Apple disagrees with Apple on the time-zone key names: the published
 * SemanticTags docs list ONLY departure/destinationLocationTimeZone, while
 * Pass Designer 1.0 and PassSemantics.proto emit
 * departure/destinationAirportTimeZone. Policy: emit BOTH with the same IANA
 * value, rename nothing (see docs/field-coverage.md).
 */
export const TIMEZONE_KEY_ALIASES = Object.freeze({
  departureLocationTimeZone: "departureAirportTimeZone",
  destinationLocationTimeZone: "destinationAirportTimeZone"
});

const SEAT_RE = /^(\d+)\s*([A-Za-z]+)$/;

/**
 * PassSeat semantics from a composite seat string, decomposed the way Pass
 * Designer 1.0 models it: "17C" → {seatRow: "17", seatNumber: "C"} (row is
 * the digits, number is the letter(s) only). Row/number are DERIVED from the
 * composite, never taken from separate input, so they cannot disagree with it
 * — a stale row that disagreed used to render as a doubled seat on iOS (e.g.
 * "3838"). Composites that don't split stay whole in seatNumber.
 * @param {string} composite seat as entered/displayed ("17C", "38 K", "UPPER DECK")
 * @param {Record<string, any>} [extra] additional PassSeat fields (seatType, seatDescription, …)
 * @returns {Record<string, any>}
 */
export function seatSemantics(composite, extra = {}) {
  const m = SEAT_RE.exec((composite ?? "").trim());
  return m
    ? { seatRow: m[1], seatNumber: m[2].toUpperCase(), ...extra }
    : { seatNumber: composite, ...extra };
}

/**
 * "ANGELO SOLIVERES" → {givenName: "ANGELO", familyName: "SOLIVERES"}.
 * Airline "SURNAME/GIVEN" convention is recognized: "DELA CRUZ/JUAN" →
 * {givenName: "JUAN", familyName: "DELA CRUZ"}. Multi-word given names keep
 * everything but the last word; single-word names land in both (the
 * historical form-to-pass behavior).
 * @param {string} full
 * @returns {{givenName: string, familyName: string}}
 */
export function splitPersonName(full) {
  const trimmed = (full ?? "").trim();
  if (trimmed.includes("/")) {
    const [family, given] = trimmed.split("/").map(s => s.trim());
    return { givenName: given ?? "", familyName: family };
  }
  const parts = trimmed.split(/\s+/);
  return { givenName: parts.slice(0, -1).join(" ") || trimmed, familyName: parts.at(-1) ?? "" };
}

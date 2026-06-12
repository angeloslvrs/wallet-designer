import { seatSemantics, splitPersonName } from "./semantics.js";

/**
 * Pure: FormState → Apple pass.json with full iOS 26 opt-in.
 *
 * Emits:
 *  - preferredStyleSchemes: ["semanticBoardingPass"]
 *  - semantics block (correct Apple field names)
 *  - boardingPass.additionalInfoFields
 *  - relevantDates[] (paired date+relevantDate for iOS 18+26 compat)
 *  - event-guide URLs (bagPolicyURL, orderFoodURL, transferURL, …)
 *  - upcomingPassInformation[] (lock-screen pre-boarding content)
 *  - webServiceURL + authenticationToken (passes web service / Live Activities)
 *
 * @param {import("@wpd/pass-schema").FormState} s
 */
export function formStateToPassJson(s) {
  const { meta, branding, flight, passenger, barcode } = s;
  const dep = flight.departure;
  const arr = flight.arrival;
  const ios = s.iOS26 ?? {};

  /** @type any */
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: meta.passTypeId,
    teamIdentifier: meta.teamId,
    organizationName: meta.organizationName,
    serialNumber: meta.serialNumber,
    description: meta.description,
    logoText: branding.logoText,
    foregroundColor: branding.foregroundColor,
    backgroundColor: branding.backgroundColor,
    labelColor: branding.labelColor,
    preferredStyleSchemes: ["semanticBoardingPass"],
    barcodes: [{
      format: barcode.format,
      message: barcode.message,
      messageEncoding: "iso-8859-1",
      altText: barcode.altText
    }],
    boardingPass: {
      transitType: "PKTransitTypeAir",
      headerFields: [
        { key: "gate", label: "GATE", value: dep.gate ?? "—" },
        { key: "seat", label: "SEAT", value: passenger.seats.map(x => x.number).join(",") }
      ],
      primaryFields: [
        { key: "depart", label: dep.city, value: dep.iata },
        { key: "arrive", label: arr.city, value: arr.iata }
      ],
      secondaryFields: [
        { key: "passenger", label: "PASSENGER", value: passenger.name },
        { key: "flight", label: "FLIGHT", value: `${flight.airlineCode}${flight.flightNumber}` }
      ],
      auxiliaryFields: [
        ...(dep.boarding ? [{ key: "boarding", label: "BOARDING", value: dep.boarding, dateStyle: "PKDateStyleNone", timeStyle: "PKDateStyleShort" }] : []),
        ...(dep.depart ? [{ key: "depart-time", label: "DEPART", value: dep.depart, dateStyle: "PKDateStyleNone", timeStyle: "PKDateStyleShort" }] : []),
        { key: "group", label: "GROUP", value: passenger.boardingGroup },
        { key: "seq", label: "SEQ", value: passenger.seqNumber }
      ],
      backFields: [
        { key: "ff", label: "FREQUENT FLYER", value: passenger.frequentFlyerNumber ?? "—" },
        { key: "terminal-dep", label: "DEPARTURE TERMINAL", value: dep.terminal ?? "—" },
        { key: "terminal-arr", label: "ARRIVAL TERMINAL", value: arr.terminal ?? "—" }
      ],
      ...(ios.additionalInfoFields?.length && { additionalInfoFields: ios.additionalInfoFields })
    },
    semantics: {
      airlineCode: flight.airlineCode,
      flightCode: `${flight.airlineCode}${flight.flightNumber}`,
      flightNumber: Number(flight.flightNumber),
      departureAirportCode: dep.iata,
      departureAirportName: dep.name,
      departureCityName: dep.city,
      departureLocationDescription: dep.city,
      destinationAirportCode: arr.iata,
      destinationAirportName: arr.name,
      destinationCityName: arr.city,
      destinationLocationDescription: arr.city,
      ...(dep.terminal && { departureTerminal: dep.terminal }),
      ...(dep.gate && { departureGate: dep.gate }),
      ...(arr.terminal && { destinationTerminal: arr.terminal }),
      ...(arr.gate && { destinationGate: arr.gate }),
      // Both time-zone key spellings, same IANA value: Apple's docs list only
      // *LocationTimeZone; Pass Designer + the protos emit *AirportTimeZone.
      // Emit both, rename nothing — see docs/field-coverage.md.
      ...(dep.timeZone && { departureLocationTimeZone: dep.timeZone, departureAirportTimeZone: dep.timeZone }),
      ...(arr.timeZone && { destinationLocationTimeZone: arr.timeZone, destinationAirportTimeZone: arr.timeZone }),
      ...(hasGeo(dep) && { departureLocation: { latitude: dep.latitude, longitude: dep.longitude } }),
      ...(hasGeo(arr) && { destinationLocation: { latitude: arr.latitude, longitude: arr.longitude } }),
      ...(dep.depart && { originalDepartureDate: dep.depart, currentDepartureDate: dep.depart }),
      ...(arr.arrive && { originalArrivalDate: arr.arrive, currentArrivalDate: arr.arrive }),
      ...(dep.boarding && { originalBoardingDate: dep.boarding, currentBoardingDate: dep.boarding }),
      passengerName: splitPersonName(passenger.name),
      boardingGroup: passenger.boardingGroup,
      boardingSequenceNumber: passenger.seqNumber,
      ...(passenger.boardingZone && { boardingZone: passenger.boardingZone }),
      ...(passenger.confirmationNumber && { confirmationNumber: passenger.confirmationNumber }),
      ...(passenger.ticketFareClass && { ticketFareClass: passenger.ticketFareClass }),
      ...(passenger.priorityStatus && { priorityStatus: passenger.priorityStatus }),
      ...(passenger.membershipProgramName && { membershipProgramName: passenger.membershipProgramName }),
      ...(passenger.frequentFlyerNumber && { membershipProgramNumber: passenger.frequentFlyerNumber }),
      ...(typeof passenger.documentsVerified === "boolean" && { internationalDocumentsAreVerified: passenger.documentsVerified }),
      // seatRow/seatSection are derived from the seat number inside
      // seatSemantics — never taken from FormState's row/letter, which can go
      // stale and used to render as a doubled seat on iOS (e.g. "3838").
      seats: passenger.seats.map(x => seatSemantics(x.number, {
        seatType: x.cabin,
        ...(x.description && { seatDescription: x.description })
      })),
      ...(ios.duration && { duration: ios.duration }),
      ...(ios.securityScreening && { securityScreening: ios.securityScreening }),
      ...(ios.transitInfo && { transitProvider: ios.transitInfo }),
      ...(ios.transitStatus && { transitStatus: ios.transitStatus }),
      ...(ios.transitStatusReason && { transitStatusReason: ios.transitStatusReason }),
      ...(typeof ios.silenceRequested === "boolean" && { silenceRequested: ios.silenceRequested }),
      ...(ios.wifi?.length && { wifiAccess: ios.wifi.map(w => ({ ssid: w.ssid, ...(w.password && { password: w.password }) })) })
    },
    ...(ios.relevantDates?.length && {
      relevantDates: ios.relevantDates.map(d => ({ date: d, relevantDate: d }))
    }),
    ...(ios.eventGuide && stripUndef(ios.eventGuide)),
    ...(ios.upcomingPassInformation?.length && {
      upcomingPassInformation: ios.upcomingPassInformation.map(e => ({
        identifier: e.identifier,
        name: e.name,
        type: "event",
        dateInformation: { date: e.date }
      }))
    }),
    ...(meta.webServiceURL && { webServiceURL: meta.webServiceURL }),
    ...(meta.authenticationToken && { authenticationToken: meta.authenticationToken })
  };

  return pass;
}

function hasGeo(p) { return typeof p.latitude === "number" && typeof p.longitude === "number"; }
function stripUndef(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") out[k] = v;
  return out;
}

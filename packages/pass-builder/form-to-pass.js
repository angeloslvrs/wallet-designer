/**
 * Pure: FormState → Apple pass.json (incl. iOS 26 `semantics` block).
 * @param {import("@wpd/pass-schema").FormState} s
 */
export function formStateToPassJson(s) {
  const { meta, branding, flight, passenger, barcode } = s;
  const dep = flight.departure;
  const arr = flight.arrival;

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
      ]
    },
    semantics: {
      airlineCode: flight.airlineCode,
      flightCode: `${flight.airlineCode}${flight.flightNumber}`,
      flightNumber: Number(flight.flightNumber),
      departureAirportCode: dep.iata,
      departureAirportName: dep.name,
      departureLocationDescription: dep.city,
      destinationAirportCode: arr.iata,
      destinationAirportName: arr.name,
      destinationLocationDescription: arr.city,
      ...(dep.terminal && { departureTerminal: dep.terminal }),
      ...(dep.gate && { departureGate: dep.gate }),
      ...(arr.terminal && { destinationTerminal: arr.terminal }),
      ...(arr.gate && { destinationGate: arr.gate }),
      ...(dep.depart && { originalDepartureDate: dep.depart, currentDepartureDate: dep.depart }),
      ...(arr.arrive && { originalArrivalDate: arr.arrive, currentArrivalDate: arr.arrive }),
      ...(dep.boarding && { originalBoardingDate: dep.boarding, currentBoardingDate: dep.boarding }),
      passengerName: { givenName: firstName(passenger.name), familyName: lastName(passenger.name) },
      boardingGroup: passenger.boardingGroup,
      seats: passenger.seats.map(x => ({
        seatNumber: x.number,
        seatType: x.cabin,
        ...(x.row && { seatRow: x.row }),
        ...(x.letter && { seatSection: x.letter })
      })),
      ...(s.iOS26?.duration && { duration: s.iOS26.duration }),
      ...(s.iOS26?.securityScreening && { securityScreening: s.iOS26.securityScreening }),
      ...(s.iOS26?.transitInfo && { transitProvider: s.iOS26.transitInfo }),
      ...(s.iOS26?.wifi?.length && { wifiAccess: s.iOS26.wifi.map(w => ({ ssid: w.ssid, ...(w.password && { password: w.password }) })) })
    }
  };

  return pass;
}

function firstName(full) { return (full ?? "").trim().split(/\s+/).slice(0, -1).join(" ") || full; }
function lastName(full)  { return (full ?? "").trim().split(/\s+/).slice(-1)[0] ?? ""; }


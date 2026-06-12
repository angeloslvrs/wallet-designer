import { describe, it, expect } from "vitest";
import { formStateToPassJson } from "../packages/pass-builder/form-to-pass.js";

const baseState = {
  meta: { passTypeId: "pass.dev.local", teamId: "DEV0000000", organizationName: "Rocket Partners Airlines", serialNumber: "RP-001", description: "Boarding pass" },
  branding: { logoText: "Rocket Partners", foregroundColor: "rgb(255,255,255)", backgroundColor: "rgb(20,30,80)", labelColor: "rgb(180,200,255)" },
  flight: {
    airlineCode: "RP",
    flightNumber: "247",
    departure: { iata: "SFO", name: "San Francisco Intl", city: "San Francisco", terminal: "2", gate: "B12", gateOpen: "2026-06-01T07:00:00-07:00", boarding: "2026-06-01T07:30:00-07:00", depart: "2026-06-01T08:15:00-07:00" },
    arrival:   { iata: "JFK", name: "John F. Kennedy Intl", city: "New York", terminal: "4", arrive: "2026-06-01T16:45:00-04:00" }
  },
  passenger: { name: "ANGELO SOLIVERES", seats: [{ number: "14A", cabin: "economy", row: "14", letter: "A" }], boardingGroup: "3", seqNumber: "0042" },
  barcode: { format: "PKBarcodeFormatQR", message: "RP247-SFOJFK-14A-0042", altText: "RP247 14A" },
  iOS26: { duration: 19800, securityScreening: "TSA PreCheck", wifi: [{ ssid: "GoGoInflight", password: "RP247" }] }
};

const richState = {
  ...{
    meta: { passTypeId: "pass.dev.local", teamId: "DEV0000000", organizationName: "Rocket Partners Airlines", serialNumber: "RP-002", description: "Boarding pass", webServiceURL: "http://localhost:4317/api/wallet", authenticationToken: "0123456789abcdef0123456789abcdef" },
    branding: { logoText: "Rocket Partners", foregroundColor: "rgb(255,255,255)", backgroundColor: "rgb(20,30,80)", labelColor: "rgb(180,200,255)" },
    flight: {
      airlineCode: "RP",
      flightNumber: "247",
      departure: { iata: "SFO", name: "San Francisco Intl", city: "San Francisco", terminal: "2", gate: "B12", boarding: "2026-06-01T07:30:00-07:00", depart: "2026-06-01T08:15:00-07:00", timeZone: "America/Los_Angeles", latitude: 37.6213, longitude: -122.3790 },
      arrival:   { iata: "JFK", name: "John F. Kennedy Intl", city: "New York", terminal: "4", arrive: "2026-06-01T16:45:00-04:00", timeZone: "America/New_York", latitude: 40.6413, longitude: -73.7781 }
    },
    passenger: { name: "ANGELO SOLIVERES", seats: [{ number: "14A", cabin: "economy", row: "14", letter: "A" }], boardingGroup: "3", seqNumber: "0042" },
    barcode: { format: "PKBarcodeFormatQR", message: "RP247-SFOJFK-14A-0042", altText: "RP247 14A" },
    iOS26: {
      duration: 19800,
      securityScreening: "TSA PreCheck",
      wifi: [{ ssid: "GoGoInflight", password: "RP247" }],
      additionalInfoFields: [
        { key: "loyalty", label: "STATUS", value: "Gold" },
        { key: "checkin", label: "CHECK-IN", value: "Closed at gate" }
      ],
      relevantDates: ["2026-06-01T07:00:00-07:00"],
      eventGuide: { bagPolicyURL: "https://rocketpartners.example.com/bags", orderFoodURL: "https://rocketpartners.example.com/food" },
      upcomingPassInformation: [
        { identifier: "boarding-open", name: "Boarding opens", date: "2026-06-01T07:30:00-07:00" }
      ]
    }
  }
};

describe("formStateToPassJson", () => {
  it("produces a boardingPass with airline transitType", () => {
    const p = formStateToPassJson(baseState);
    expect(p.boardingPass.transitType).toBe("PKTransitTypeAir");
  });

  it("populates required top-level fields", () => {
    const p = formStateToPassJson(baseState);
    expect(p.formatVersion).toBe(1);
    expect(p.passTypeIdentifier).toBe("pass.dev.local");
    expect(p.teamIdentifier).toBe("DEV0000000");
    expect(p.serialNumber).toBe("RP-001");
    expect(p.organizationName).toBe("Rocket Partners Airlines");
    expect(p.description).toBe("Boarding pass");
  });

  it("includes IATA codes as primaryFields", () => {
    const p = formStateToPassJson(baseState);
    const labels = p.boardingPass.primaryFields.map(f => f.key);
    expect(labels).toContain("depart");
    expect(labels).toContain("arrive");
  });

  it("emits iOS 26 semantics block", () => {
    const p = formStateToPassJson(baseState);
    expect(p.semantics.airlineCode).toBe("RP");
    expect(p.semantics.flightNumber).toBe(247);
    expect(p.semantics.departureAirportCode).toBe("SFO");
    expect(p.semantics.destinationAirportCode).toBe("JFK");
    expect(p.semantics.passengerName.familyName).toBe("SOLIVERES");
    expect(p.semantics.passengerName.givenName).toBe("ANGELO");
    expect(p.semantics.seats).toHaveLength(1);
    expect(p.semantics.seats[0]).toMatchObject({ seatRow: "14", seatNumber: "A" });
    expect(p.semantics.boardingGroup).toBe("3");
    expect(p.semantics.wifiAccess[0].ssid).toBe("GoGoInflight");
  });

  it("uses ISO-8601 dates verbatim from state", () => {
    const p = formStateToPassJson(baseState);
    expect(p.semantics.originalDepartureDate).toBe("2026-06-01T08:15:00-07:00");
    expect(p.semantics.originalArrivalDate).toBe("2026-06-01T16:45:00-04:00");
  });

  it("opts into the iOS 26 semanticBoardingPass style", () => {
    const p = formStateToPassJson(baseState);
    expect(p.preferredStyleSchemes).toEqual(["semanticBoardingPass"]);
  });
});

describe("formStateToPassJson — iOS 26 extras", () => {
  it("emits timezones (both key spellings — docs vs Designer/protos) + geo coordinates", () => {
    const p = formStateToPassJson(richState);
    expect(p.semantics.departureLocationTimeZone).toBe("America/Los_Angeles");
    expect(p.semantics.destinationLocationTimeZone).toBe("America/New_York");
    expect(p.semantics.departureAirportTimeZone).toBe("America/Los_Angeles");
    expect(p.semantics.destinationAirportTimeZone).toBe("America/New_York");
    expect(p.semantics.departureLocation).toEqual({ latitude: 37.6213, longitude: -122.3790 });
    expect(p.semantics.destinationLocation).toEqual({ latitude: 40.6413, longitude: -73.7781 });
  });

  it("emits additionalInfoFields on boardingPass", () => {
    const p = formStateToPassJson(richState);
    expect(p.boardingPass.additionalInfoFields).toHaveLength(2);
    expect(p.boardingPass.additionalInfoFields[0].key).toBe("loyalty");
  });

  it("emits relevantDates with iOS 18+26 compat pairing", () => {
    const p = formStateToPassJson(richState);
    expect(p.relevantDates).toEqual([{ date: "2026-06-01T07:00:00-07:00", relevantDate: "2026-06-01T07:00:00-07:00" }]);
  });

  it("emits event-guide URLs at top level", () => {
    const p = formStateToPassJson(richState);
    expect(p.bagPolicyURL).toBe("https://rocketpartners.example.com/bags");
    expect(p.orderFoodURL).toBe("https://rocketpartners.example.com/food");
  });

  it("emits upcomingPassInformation entries", () => {
    const p = formStateToPassJson(richState);
    expect(p.upcomingPassInformation).toHaveLength(1);
    expect(p.upcomingPassInformation[0]).toEqual({
      identifier: "boarding-open",
      name: "Boarding opens",
      type: "event",
      dateInformation: { date: "2026-06-01T07:30:00-07:00" }
    });
  });

  it("emits webServiceURL + authenticationToken for the passes web service", () => {
    const p = formStateToPassJson(richState);
    expect(p.webServiceURL).toBe("http://localhost:4317/api/wallet");
    expect(p.authenticationToken).toMatch(/^[a-f0-9]{32}$/);
  });

  it("omits all iOS 26 extras when iOS26 fields are absent", () => {
    const p = formStateToPassJson(baseState);
    expect(p.boardingPass.additionalInfoFields).toBeUndefined();
    expect(p.relevantDates).toBeUndefined();
    expect(p.upcomingPassInformation).toBeUndefined();
    expect(p.bagPolicyURL).toBeUndefined();
    expect(p.webServiceURL).toBeUndefined();
  });
});

describe("formStateToPassJson — semantics coverage extensions", () => {
  const coverageState = {
    ...baseState,
    passenger: {
      ...baseState.passenger,
      frequentFlyerNumber: "RP-GOLD-1234567",
      membershipProgramName: "Rocket Rewards",
      confirmationNumber: "GHK2X9",
      ticketFareClass: "Y",
      priorityStatus: "Gold",
      boardingZone: "3",
      documentsVerified: true,
      seats: [{ number: "14A", cabin: "economy", description: "Window seat" }]
    },
    iOS26: {
      ...baseState.iOS26,
      transitStatus: "Delayed",
      transitStatusReason: "Crew availability",
      silenceRequested: false
    }
  };

  it("always emits the dedicated city-name semantics alongside the location descriptions", () => {
    const p = formStateToPassJson(baseState);
    expect(p.semantics.departureCityName).toBe("San Francisco");
    expect(p.semantics.destinationCityName).toBe("New York");
    expect(p.semantics.departureLocationDescription).toBe("San Francisco");
  });

  it("emits per-passenger detail semantics when present", () => {
    const p = formStateToPassJson(coverageState);
    expect(p.semantics.confirmationNumber).toBe("GHK2X9");
    expect(p.semantics.ticketFareClass).toBe("Y");
    expect(p.semantics.priorityStatus).toBe("Gold");
    expect(p.semantics.membershipProgramName).toBe("Rocket Rewards");
    expect(p.semantics.membershipProgramNumber).toBe("RP-GOLD-1234567");
    expect(p.semantics.boardingZone).toBe("3");
    expect(p.semantics.internationalDocumentsAreVerified).toBe(true);
  });

  it("emits transit status + reason and silenceRequested from iOS26", () => {
    const p = formStateToPassJson(coverageState);
    expect(p.semantics.transitStatus).toBe("Delayed");
    expect(p.semantics.transitStatusReason).toBe("Crew availability");
    expect(p.semantics.silenceRequested).toBe(false);
  });

  it("omits the optional semantics when their fields are absent", () => {
    const p = formStateToPassJson(baseState);
    for (const key of ["confirmationNumber", "ticketFareClass", "priorityStatus", "membershipProgramName",
                       "membershipProgramNumber", "boardingZone", "internationalDocumentsAreVerified",
                       "transitStatus", "transitStatusReason", "silenceRequested"]) {
      expect(p.semantics[key], key).toBeUndefined();
    }
  });

  it("decomposes the composite seat into seatRow + seatNumber (Designer convention) and carries seatDescription", () => {
    const p = formStateToPassJson(coverageState);
    expect(p.semantics.seats[0]).toEqual({
      seatRow: "14", seatNumber: "A",
      seatType: "economy", seatDescription: "Window seat"
    });
  });

  it("keeps unparseable seat numbers seatNumber-only (row never disagrees with the number)", () => {
    const state = {
      ...baseState,
      passenger: { ...baseState.passenger, seats: [{ number: "UPPER DECK", cabin: "business" }] }
    };
    expect(formStateToPassJson(state).semantics.seats[0]).toEqual({
      seatNumber: "UPPER DECK", seatType: "business"
    });
  });
});

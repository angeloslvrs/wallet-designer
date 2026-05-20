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
    expect(p.semantics.seats[0].seatNumber).toBe("14A");
    expect(p.semantics.boardingGroup).toBe("3");
    expect(p.semantics.wifiAccess[0].ssid).toBe("GoGoInflight");
  });

  it("uses ISO-8601 dates verbatim from state", () => {
    const p = formStateToPassJson(baseState);
    expect(p.semantics.originalDepartureDate).toBe("2026-06-01T08:15:00-07:00");
    expect(p.semantics.originalArrivalDate).toBe("2026-06-01T16:45:00-04:00");
  });
});

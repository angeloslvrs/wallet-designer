import { describe, it, expect } from "vitest";
import { migrateFormState, legacyFormStateToPassJson } from "../packages/pass-builder/migrate.js";
import { formStateToPassJson } from "../packages/pass-builder/form-to-pass.js";

const oldBase = {
  meta: { passTypeId: "pass.dev.local", teamId: "DEV0000000", organizationName: "Rocket Partners Airlines", serialNumber: "RP-001", description: "Boarding pass" },
  branding: { logoText: "Rocket Partners", foregroundColor: "rgb(255,255,255)", backgroundColor: "rgb(20,30,80)", labelColor: "rgb(180,200,255)" },
  flight: {
    airlineCode: "RP", flightNumber: "247",
    departure: { iata: "SFO", name: "San Francisco Intl", city: "San Francisco", terminal: "2", gate: "B12", boarding: "2026-06-01T07:30:00-07:00", depart: "2026-06-01T08:15:00-07:00" },
    arrival:   { iata: "JFK", name: "John F. Kennedy Intl", city: "New York", terminal: "4", arrive: "2026-06-01T16:45:00-04:00" }
  },
  passenger: { name: "ANGELO SOLIVERES", seats: [{ number: "14A", cabin: "economy", row: "14", letter: "A" }], boardingGroup: "3", seqNumber: "0042" },
  barcode: { format: "PKBarcodeFormatQR", message: "RP247-SFOJFK-14A-0042", altText: "RP247 14A" },
  iOS26: { duration: 19800, securityScreening: "TSA PreCheck", wifi: [{ ssid: "GoGoInflight", password: "RP247" }] }
};

describe("migrateFormState", () => {
  it("lifts semantics + display fields into the new shape, dropping flight/passenger", () => {
    const m = migrateFormState(oldBase);
    expect(m.flight).toBeUndefined();
    expect(m.passenger).toBeUndefined();
    expect(m.meta).toEqual(oldBase.meta);
    expect(m.barcode).toEqual(oldBase.barcode);
    expect(m.semantics.airlineCode).toBe("RP");
    expect(m.semantics.flightNumber).toBe(247);
    expect(m.semantics.passengerName).toEqual({ givenName: "ANGELO", familyName: "SOLIVERES" });
    expect(m.semantics.seats[0]).toMatchObject({ seatRow: "14", seatNumber: "A" });
    expect(m.displayFields.primary.map(f => f.key)).toEqual(["depart", "arrive"]);
    expect(m.displayFields.header.map(f => f.key)).toEqual(["gate", "seat"]);
  });

  it("routes wifi into the iOS26 bucket, never into semantics", () => {
    const m = migrateFormState(oldBase);
    expect(m.semantics.wifiAccess).toBeUndefined();
    expect(m.iOS26.wifi).toEqual([{ ssid: "GoGoInflight", password: "RP247" }]);
  });

  it("is idempotent: a new-shape state passes through unchanged", () => {
    const m = migrateFormState(oldBase);
    expect(migrateFormState(m)).toEqual(m);
  });

  it("leaves non-FormState / partial-stub inputs untouched (no crash)", () => {
    expect(migrateFormState(null)).toBe(null);
    const stub = { meta: { serialNumber: "X" }, flight: {} };
    expect(migrateFormState(stub)).toBe(stub);   // missing departure/arrival -> passthrough
  });
});

describe("legacyFormStateToPassJson (frozen snapshot of the pre-Phase-3 emitter)", () => {
  it("still emits the old pass.json the migration depends on", () => {
    const p = legacyFormStateToPassJson(oldBase);
    expect(p.semantics.airlineCode).toBe("RP");
    expect(p.boardingPass.primaryFields.map(f => f.key)).toEqual(["depart", "arrive"]);
    expect(p.semantics.wifiAccess[0].ssid).toBe("GoGoInflight");
  });
});

const oldRich = {
  meta: { passTypeId: "pass.dev.local", teamId: "DEV0000000", organizationName: "Rocket Partners Airlines", serialNumber: "RP-002", description: "Boarding pass", webServiceURL: "http://localhost:4317/api/wallet", authenticationToken: "0123456789abcdef0123456789abcdef" },
  branding: { logoText: "Rocket Partners", foregroundColor: "rgb(255,255,255)", backgroundColor: "rgb(20,30,80)", labelColor: "rgb(180,200,255)" },
  flight: {
    airlineCode: "RP", flightNumber: "247",
    departure: { iata: "SFO", name: "San Francisco Intl", city: "San Francisco", terminal: "2", gate: "B12", boarding: "2026-06-01T07:30:00-07:00", depart: "2026-06-01T08:15:00-07:00", timeZone: "America/Los_Angeles", latitude: 37.6213, longitude: -122.3790 },
    arrival:   { iata: "JFK", name: "John F. Kennedy Intl", city: "New York", terminal: "4", gate: "B7", arrive: "2026-06-01T16:45:00-04:00", timeZone: "America/New_York", latitude: 40.6413, longitude: -73.7781 }
  },
  passenger: { name: "ANGELO SOLIVERES", confirmationNumber: "GHK2X9", ticketFareClass: "Y", priorityStatus: "Gold", boardingZone: "3", documentsVerified: true, membershipProgramName: "Rocket Rewards", frequentFlyerNumber: "RP-GOLD-1", seats: [{ number: "14A", cabin: "economy", description: "Window seat" }], boardingGroup: "3", seqNumber: "0042" },
  barcode: { format: "PKBarcodeFormatQR", message: "RP247-SFOJFK-14A-0042", altText: "RP247 14A" },
  iOS26: {
    duration: 19800, securityScreening: "TSA PreCheck", transitInfo: "Train", transitStatus: "On Time", transitStatusReason: "", silenceRequested: false,
    wifi: [{ ssid: "GoGoInflight", password: "RP247" }],
    additionalInfoFields: [{ key: "loyalty", label: "STATUS", value: "Gold" }],
    relevantDates: ["2026-06-01T07:00:00-07:00"],
    eventGuide: { bagPolicyURL: "https://x/bags", orderFoodURL: "https://x/food" },
    upcomingPassInformation: [{ identifier: "b", name: "Boarding", date: "2026-06-01T07:30:00-07:00" }]
  }
};

describe("round-trip: new emitter on migrated state == frozen legacy emitter", () => {
  // The new emitter deliberately derives expirationDate + a single relevantDate
  // from the flight semantics (and drops the legacy relevantDates array) for
  // ALL passes — see expiry.js / tests/expiry.test.js. Those derived date fields
  // are intentionally different from the frozen legacy output and orthogonal to
  // migration, so they're excluded here; migration faithfulness is still
  // asserted byte-for-byte for everything else.
  const stripDerivedDates = ({ expirationDate, relevantDate, relevantDates, ...rest }) => rest;
  it("reproduces legacy pass.json byte-for-byte (excluding derived expiry/relevance)", () => {
    for (const old of [oldBase, oldRich]) {
      expect(stripDerivedDates(formStateToPassJson(migrateFormState(old)))).toEqual(stripDerivedDates(legacyFormStateToPassJson(old)));
    }
  });
});

import { describe, it, expect } from "vitest";
import { migrateFormState, legacyFormStateToPassJson } from "../packages/pass-builder/migrate.js";

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

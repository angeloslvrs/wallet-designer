import { describe, it, expect } from "vitest";
import { formStateToPassJson } from "../packages/pass-builder/form-to-pass.js";

const base = {
  meta: { passTypeId: "pass.dev.local", teamId: "DEV0000000", organizationName: "Rocket Partners Airlines", serialNumber: "RP-001", description: "Boarding pass" },
  branding: { logoText: "Rocket Partners", foregroundColor: "rgb(255,255,255)", backgroundColor: "rgb(20,30,80)", labelColor: "rgb(180,200,255)" },
  barcode: { format: "PKBarcodeFormatQR", message: "RP247-SFOJFK-14A-0042", altText: "RP247 14A" },
  semantics: {
    airlineCode: "RP", flightCode: "RP247", flightNumber: 247,
    departureAirportCode: "SFO", destinationAirportCode: "JFK",
    originalBoardingDate: "2026-06-01T07:30:00-07:00", currentBoardingDate: "2026-06-01T07:30:00-07:00",
    passengerName: { givenName: "ANGELO", familyName: "SOLIVERES" },
    seats: [{ seatRow: "14", seatNumber: "A", seatType: "economy" }],
    boardingGroup: "3", boardingSequenceNumber: "0042",
    departureGate: "",                              // empty -> dropped (emit-only-filled)
    departureLocationTimeZone: "America/Los_Angeles" // tz mirror -> AirportTimeZone too
  },
  displayFields: {
    header: [{ key: "gate", label: "GATE", value: "B12" }],
    primary: [{ key: "depart", label: "San Francisco", value: "SFO" }, { key: "arrive", label: "New York", value: "JFK" }],
    secondary: [], auxiliary: [], back: []
  },
  iOS26: { wifi: [{ ssid: "GoGoInflight", password: "RP247" }] }
};

describe("formStateToPassJson (new shape)", () => {
  it("emits required top-level + the iOS 26 style opt-in", () => {
    const p = formStateToPassJson(base);
    expect(p.formatVersion).toBe(1);
    expect(p.passTypeIdentifier).toBe("pass.dev.local");
    expect(p.teamIdentifier).toBe("DEV0000000");
    expect(p.serialNumber).toBe("RP-001");
    expect(p.preferredStyleSchemes).toEqual(["semanticBoardingPass"]);
    expect(p.barcodes[0]).toEqual({ format: "PKBarcodeFormatQR", message: "RP247-SFOJFK-14A-0042", messageEncoding: "iso-8859-1", altText: "RP247 14A" });
  });

  it("builds boardingPass.*Fields straight from displayFields (verbatim, incl. extra props)", () => {
    const p = formStateToPassJson({ ...base, displayFields: { ...base.displayFields,
      auxiliary: [{ key: "boarding", label: "BOARDING", value: "2026-06-01T07:30:00-07:00", dateStyle: "PKDateStyleNone", timeStyle: "PKDateStyleShort" }] } });
    expect(p.boardingPass.transitType).toBe("PKTransitTypeAir");
    expect(p.boardingPass.headerFields).toEqual([{ key: "gate", label: "GATE", value: "B12" }]);
    expect(p.boardingPass.primaryFields.map(f => f.key)).toEqual(["depart", "arrive"]);
    expect(p.boardingPass.auxiliaryFields[0]).toEqual({ key: "boarding", label: "BOARDING", value: "2026-06-01T07:30:00-07:00", dateStyle: "PKDateStyleNone", timeStyle: "PKDateStyleShort" });
  });

  it("spreads filled semantics, drops empties, mirrors both time-zone spellings", () => {
    const p = formStateToPassJson(base);
    expect(p.semantics.airlineCode).toBe("RP");
    expect(p.semantics.flightNumber).toBe(247);
    expect(p.semantics.passengerName).toEqual({ givenName: "ANGELO", familyName: "SOLIVERES" });
    expect(p.semantics.departureGate).toBeUndefined();               // empty dropped
    expect(p.semantics.departureLocationTimeZone).toBe("America/Los_Angeles");
    expect(p.semantics.departureAirportTimeZone).toBe("America/Los_Angeles"); // mirrored
  });

  it("derives wifiAccess from the iOS26.wifi bucket", () => {
    const p = formStateToPassJson(base);
    expect(p.semantics.wifiAccess).toEqual([{ ssid: "GoGoInflight", password: "RP247" }]);
  });

  it("emits the iOS 26 extras and passes meta web-service fields through", () => {
    const p = formStateToPassJson({ ...base,
      meta: { ...base.meta, webServiceURL: "http://localhost:4317/api/wallet", authenticationToken: "0123456789abcdef0123456789abcdef" },
      iOS26: { ...base.iOS26,
        additionalInfoFields: [{ key: "loyalty", label: "STATUS", value: "Gold" }],
        relevantDates: ["2026-06-01T07:00:00-07:00"],
        eventGuide: { bagPolicyURL: "https://x/bags" },
        upcomingPassInformation: [{ identifier: "b", name: "Boarding", date: "2026-06-01T07:30:00-07:00" }] } });
    expect(p.boardingPass.additionalInfoFields[0].key).toBe("loyalty");
    expect(p.relevantDates).toEqual([{ date: "2026-06-01T07:00:00-07:00", relevantDate: "2026-06-01T07:00:00-07:00" }]);
    expect(p.bagPolicyURL).toBe("https://x/bags");
    expect(p.upcomingPassInformation[0]).toEqual({ identifier: "b", name: "Boarding", type: "event", dateInformation: { date: "2026-06-01T07:30:00-07:00" } });
    expect(p.webServiceURL).toBe("http://localhost:4317/api/wallet");
    expect(p.authenticationToken).toMatch(/^[a-f0-9]{32}$/);
  });

  it("omits all iOS 26 extras when the bucket is absent", () => {
    const p = formStateToPassJson(base);
    expect(p.boardingPass.additionalInfoFields).toBeUndefined();
    expect(p.relevantDates).toBeUndefined();
    expect(p.upcomingPassInformation).toBeUndefined();
    expect(p.bagPolicyURL).toBeUndefined();
    expect(p.webServiceURL).toBeUndefined();
  });
});

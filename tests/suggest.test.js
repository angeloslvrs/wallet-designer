import { describe, it, expect } from "vitest";
import { suggestDisplayValues, formatSemanticValue } from "../packages/pass-builder/suggest.js";

describe("formatSemanticValue", () => {
  it("formats by catalog type", () => {
    expect(formatSemanticValue("originalBoardingDate", "2026-06-13T07:30:00-07:00")).toBe("7:30 AM");
    expect(formatSemanticValue("passengerName", { givenName: "Juan", familyName: "Dela Cruz" })).toBe("JUAN DELA CRUZ");
    expect(formatSemanticValue("seats", [{ seatRow: "14", seatNumber: "A" }])).toBe("14A");
    expect(formatSemanticValue("seats", [{ seatRow: "14", seatNumber: "A" }, { seatRow: "14", seatNumber: "B" }])).toBe("14A, 14B");
    expect(formatSemanticValue("internationalDocumentsAreVerified", true)).toBe("Yes");
    expect(formatSemanticValue("internationalDocumentsAreVerified", false)).toBe("No");
    expect(formatSemanticValue("passengerCapabilities", ["A", "B"])).toBe("A, B");
    expect(formatSemanticValue("flightNumber", 5057)).toBe("5057");
    expect(formatSemanticValue("departureAirportCode", "MNL")).toBe("MNL");
  });
});

describe("suggestDisplayValues", () => {
  it("fills mapped fields from semantics, formatted", () => {
    const semantics = { departureAirportCode: "MNL", originalBoardingDate: "2026-06-13T07:30:00-07:00" };
    const mapping = { departureAirportCode: "from", originalBoardingDate: "boardingTime" };
    expect(suggestDisplayValues(semantics, mapping)).toEqual({ from: "MNL", boardingTime: "7:30 AM" });
  });
  it("skips semantics that are absent or unmapped", () => {
    expect(suggestDisplayValues({ departureGate: "B7" }, { departureAirportCode: "from" })).toEqual({});
    expect(suggestDisplayValues({ departureAirportCode: "" }, { departureAirportCode: "from" })).toEqual({});
  });
});

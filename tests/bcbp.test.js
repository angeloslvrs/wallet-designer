import { describe, it, expect } from "vitest";
import { parseBCBP } from "../packages/pass-builder/bcbp.js";

// Build a single-leg BCBP "M" string from fixed-width fields so positions are
// guaranteed correct (no hand-counting). Layout: header(23) + leg1 mandatory(37).
function sampleBCBP() {
  return [
    "M",                          // format code
    "1",                          // number of legs
    "DESMARAIS/LUC".padEnd(20),   // passenger name (20)
    "E",                          // electronic ticket indicator
    "ABC123".padEnd(7),           // operating carrier PNR (7)
    "YUL",                        // from airport (3)
    "FRA",                        // to airport (3)
    "AC".padEnd(3),               // operating carrier (3)
    "0834".padEnd(5),             // flight number (5)
    "226",                        // Julian date of flight (3)
    "F",                          // compartment code (1)
    "001A",                       // seat number (4)
    "0025".padEnd(5),             // check-in sequence (5)
    "1",                          // passenger status (1)
    "00"                          // conditional size hex (2)
  ].join("");
}

const REF = new Date(Date.UTC(2026, 5, 1)); // 2026-06-01, deterministic year inference

describe("parseBCBP", () => {
  it("decodes the mandatory header + first leg", () => {
    const p = parseBCBP(sampleBCBP(), { referenceDate: REF });
    expect(p.format).toBe("M");
    expect(p.legs).toBe(1);
    expect(p.passengerName).toEqual({ givenName: "LUC", familyName: "DESMARAIS" });
    expect(p.confirmationNumber).toBe("ABC123");
    expect(p.departureAirportCode).toBe("YUL");
    expect(p.destinationAirportCode).toBe("FRA");
    expect(p.airlineCode).toBe("AC");
    expect(p.flightNumber).toBe(834);
    expect(p.flightCode).toBe("AC834");
    expect(p.seats).toEqual([{ seatRow: "1", seatNumber: "A" }]);
    expect(p.boardingSequenceNumber).toBe("25");
    expect(p.flightDayOfYear).toBe(226);
    expect(p.flightDate).toBe("2026-08-14"); // day 226 of 2026
  });

  it("infers the nearest year across the Jan/Dec boundary", () => {
    // day 5 (early Jan) scanned on Dec 28 2025 → should resolve to 2026, not 2025
    const dec = new Date(Date.UTC(2025, 11, 28));
    const s = sampleBCBP().slice(0, 44) + "005" + sampleBCBP().slice(47);
    expect(parseBCBP(s, { referenceDate: dec }).flightDate).toBe("2026-01-05");
  });

  it("ignores leading/trailing whitespace around the record", () => {
    expect(parseBCBP("  " + sampleBCBP() + "\n", { referenceDate: REF }).format).toBe("M");
  });

  it("throws on a non-BCBP string", () => {
    expect(() => parseBCBP("https://example.com/ticket")).toThrow(/BCBP/i);
    expect(() => parseBCBP("M1tooshort")).toThrow(/BCBP/i);
  });
});

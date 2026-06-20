import { describe, it, expect } from "vitest";
import { SEMANTIC_CATALOG, REQUIRED_SEMANTICS, BOARDING_SEMANTICS, SEMANTIC_DATE_KEYS } from "../packages/pass-builder/semantics.js";

const VALID_TYPES = new Set(["text", "date", "number", "boolean", "personName", "seats", "stringArray", "enum", "location", "currency"]);

describe("SEMANTIC_CATALOG", () => {
  it("covers every BOARDING_SEMANTICS key", () => {
    for (const k of Object.keys(BOARDING_SEMANTICS)) expect(SEMANTIC_CATALOG[k], k).toBeDefined();
  });
  it("gives every entry a valid type, a group, and a label", () => {
    for (const [k, e] of Object.entries(SEMANTIC_CATALOG)) {
      expect(VALID_TYPES.has(e.type), `${k}:${e.type}`).toBe(true);
      expect(typeof e.group).toBe("string");
      expect(typeof e.label).toBe("string");
    }
  });
  it("maps the legacy string/date/number/personName/seats types consistently", () => {
    for (const [k, t] of Object.entries(BOARDING_SEMANTICS)) {
      const expected = t === "string" ? "text" : t;
      expect(SEMANTIC_CATALOG[k].type, k).toBe(expected);
    }
  });
});

describe("REQUIRED_SEMANTICS", () => {
  it("is a subset of the catalog and matches the entries' required flag", () => {
    for (const k of REQUIRED_SEMANTICS) expect(SEMANTIC_CATALOG[k], k).toBeDefined();
    const flagged = Object.entries(SEMANTIC_CATALOG).filter(([, e]) => e.required).map(([k]) => k).sort();
    expect(flagged).toEqual([...REQUIRED_SEMANTICS].sort());
  });
  it("includes the core boarding fields the validator errors on", () => {
    for (const k of ["airlineCode", "flightNumber", "departureAirportCode", "departureAirportTimeZone", "destinationAirportCode", "originalDepartureDate", "originalBoardingDate", "originalArrivalDate", "passengerName"]) {
      expect(REQUIRED_SEMANTICS).toContain(k);
    }
  });
});

describe("SEMANTIC_DATE_KEYS", () => {
  it("equals the catalog keys whose type is date", () => {
    const fromCatalog = Object.entries(SEMANTIC_CATALOG).filter(([, e]) => e.type === "date").map(([k]) => k).sort();
    expect([...SEMANTIC_DATE_KEYS].sort()).toEqual(fromCatalog);
  });
});

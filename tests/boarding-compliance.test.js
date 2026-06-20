import { describe, it, expect } from "vitest";
import {
  REQUIRED_SEMANTICS, RECOMMENDED_SEMANTICS, SEMANTIC_CATALOG
} from "../packages/pass-builder/semantics.js";

// Pinned against apple/pass-builder Validation/Validators/BoardingPassValidator.swift
// + SeatValidator.swift @ SHA 170f2a11 (the CI PASS_BUILDER_SHA in
// .github/workflows/apple-validate.yml). Validator ERRORS -> required;
// validator WARNINGS -> recommended. Bump these lists together with that SHA.
const VALIDATOR_ERRORS = [
  "airlineCode", "flightNumber",
  "originalDepartureDate", "originalBoardingDate", "originalArrivalDate",
  "departureAirportCode", "departureAirportTimeZone",
  "destinationAirportCode",
  "passengerName"
];
const VALIDATOR_WARNINGS = [
  "departureCityName", "destinationCityName", "destinationAirportTimeZone", "seats"
];

describe("boarding-pass compliance (validator-pinned)", () => {
  it("REQUIRED_SEMANTICS equals the validator's error set", () => {
    expect([...REQUIRED_SEMANTICS].sort()).toEqual([...VALIDATOR_ERRORS].sort());
  });

  it("RECOMMENDED_SEMANTICS equals the validator's warning set", () => {
    expect([...RECOMMENDED_SEMANTICS].sort()).toEqual([...VALIDATOR_WARNINGS].sort());
  });

  it("every required/recommended key exists in the catalog", () => {
    for (const k of [...VALIDATOR_ERRORS, ...VALIDATOR_WARNINGS]) {
      expect(SEMANTIC_CATALOG[k], k).toBeDefined();
    }
  });

  it("required and recommended sets are disjoint", () => {
    const rec = new Set(RECOMMENDED_SEMANTICS);
    for (const k of REQUIRED_SEMANTICS) expect(rec.has(k), k).toBe(false);
  });

  it("catalog required/recommended flags agree with the lists", () => {
    const flaggedRequired = Object.entries(SEMANTIC_CATALOG)
      .filter(([, e]) => e.required).map(([k]) => k).sort();
    const flaggedRecommended = Object.entries(SEMANTIC_CATALOG)
      .filter(([, e]) => e.recommended).map(([k]) => k).sort();
    expect(flaggedRequired).toEqual([...REQUIRED_SEMANTICS].sort());
    expect(flaggedRecommended).toEqual([...RECOMMENDED_SEMANTICS].sort());
  });
});

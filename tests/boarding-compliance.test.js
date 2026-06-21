import { describe, it, expect } from "vitest";
import {
  REQUIRED_SEMANTICS, RECOMMENDED_SEMANTICS, DOC_REQUIRED_SEMANTICS, SEMANTIC_CATALOG
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

// Apple's PUBLISHED "Add the required semantic tags" table lists 12 tags
// (https://developer.apple.com/documentation/walletpasses/creating-an-airline-boarding-pass-using-semantic-tags),
// expressed here in the *AirportTimeZone spelling the editor manages.
const APPLE_DOC_REQUIRED = [
  "airlineCode", "flightNumber",
  "departureAirportCode", "departureCityName", "departureAirportTimeZone",
  "destinationAirportCode", "destinationCityName", "destinationAirportTimeZone",
  "originalDepartureDate", "originalBoardingDate", "originalArrivalDate",
  "passengerName"
];

describe("boarding-pass compliance (Apple published doc)", () => {
  it("DOC_REQUIRED_SEMANTICS equals Apple's published required list", () => {
    expect([...DOC_REQUIRED_SEMANTICS].sort()).toEqual([...APPLE_DOC_REQUIRED].sort());
  });

  it("is a strict superset of the validator's required set", () => {
    const doc = new Set(DOC_REQUIRED_SEMANTICS);
    for (const k of REQUIRED_SEMANTICS) expect(doc.has(k), k).toBe(true);
    expect(DOC_REQUIRED_SEMANTICS.length).toBeGreaterThan(REQUIRED_SEMANTICS.length);
  });

  it("the doc-only extras are the three the validator merely warns on", () => {
    const validatorRequired = new Set(REQUIRED_SEMANTICS);
    const docOnly = DOC_REQUIRED_SEMANTICS.filter(k => !validatorRequired.has(k)).sort();
    expect(docOnly).toEqual(["departureCityName", "destinationAirportTimeZone", "destinationCityName"]);
  });

  it("every doc-required key exists in the catalog", () => {
    for (const k of DOC_REQUIRED_SEMANTICS) expect(SEMANTIC_CATALOG[k], k).toBeDefined();
  });
});

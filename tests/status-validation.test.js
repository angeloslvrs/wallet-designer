import { describe, it, expect } from "vitest";
import { validateStatusBody } from "../apps/server/src/template-status.js";

// The status-update routes validate the body before applying it, so a bad
// value is a 400 (per-field message) rather than a 500 or a silently-broken
// pass. Vocabulary is semantic keys (aliases normalized first); the kind comes
// from the semantic, same table the issue path uses.

describe("validateStatusBody", () => {
  it("returns no errors for a well-formed body", () => {
    expect(validateStatusBody({
      departureGate: "B12",
      currentBoardingDate: "2026-08-01T09:10:00+08:00",
      delayed: "ATC hold"
    })).toEqual([]);
  });

  it("flags a non-ISO date semantic", () => {
    const errs = validateStatusBody({ currentBoardingDate: "half past seven" });
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/currentBoardingDate.*date/i);
  });

  it("validates through legacy aliases (boarding → currentBoardingDate)", () => {
    expect(validateStatusBody({ boarding: "not a date" })[0]).toMatch(/currentBoardingDate.*date/i);
  });

  it("allows empty strings (they clear a semantic, not set a bad value)", () => {
    expect(validateStatusBody({ currentBoardingDate: "", departureGate: "" })).toEqual([]);
  });

  it("accepts the {value, changeMessage} object form, validating the value", () => {
    expect(validateStatusBody({ currentDepartureDate: { value: "2026-08-01T10:00:00+08:00", changeMessage: "Now %@" } })).toEqual([]);
    expect(validateStatusBody({ currentDepartureDate: { value: "nope" } })[0]).toMatch(/date/i);
  });

  it("leaves free-text status fields unconstrained", () => {
    expect(validateStatusBody({ transitStatus: "Delayed", transitStatusReason: "crew", transitProvider: "Train" })).toEqual([]);
  });
});

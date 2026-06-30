import { describe, it, expect } from "vitest";
import { semanticKind, validateFieldValue, normalizeFieldValue, kindAttrs } from "../packages/pass-builder/field-kinds.js";

// Validation rules attach to Apple's SEMANTICS (not to template field-key names):
// the input "kind" a field validates against is resolved from the semantic it is
// bound to. semanticKind() is that mapping; everything else hangs off the kind.

describe("semanticKind — value type per Apple semantic", () => {
  it("maps airport-code semantics to iata", () => {
    expect(semanticKind("departureAirportCode")).toBe("iata");
    expect(semanticKind("destinationAirportCode")).toBe("iata");
  });
  it("maps numeric semantics to number (incl. the localizable boardingSequenceNumber the issuer enters as digits)", () => {
    expect(semanticKind("flightNumber")).toBe("number");
    expect(semanticKind("boardingSequenceNumber")).toBe("number");
  });
  it("maps the structured semantics", () => {
    expect(semanticKind("passengerName")).toBe("name");
    expect(semanticKind("seats")).toBe("seat");
    expect(semanticKind("currentBoardingDate")).toBe("date");
    expect(semanticKind("currentDepartureDate")).toBe("date");
  });
  it("maps plain localizable strings (and unknown keys) to text", () => {
    expect(semanticKind("departureGate")).toBe("text");
    expect(semanticKind("departureTerminal")).toBe("text");
    expect(semanticKind("airlineCode")).toBe("text");
    expect(semanticKind("totallyUnknownKey")).toBe("text");
  });
});

describe("validateFieldValue — null when valid, a message when not", () => {
  it("iata: exactly three letters, case-insensitive", () => {
    expect(validateFieldValue({ kind: "iata" }, "MNL")).toBeNull();
    expect(validateFieldValue({ kind: "iata" }, "mnl")).toBeNull();
    expect(validateFieldValue({ kind: "iata" }, "  NRT ")).toBeNull();
    expect(validateFieldValue({ kind: "iata" }, "Manila")).toMatch(/3 letters/i);
    expect(validateFieldValue({ kind: "iata" }, "MN")).toMatch(/3 letters/i);
    expect(validateFieldValue({ kind: "iata" }, "M1L")).toMatch(/3 letters/i);
  });
  it("number: integer or decimal only", () => {
    expect(validateFieldValue({ kind: "number" }, "78")).toBeNull();
    expect(validateFieldValue({ kind: "number" }, "1.5")).toBeNull();
    expect(validateFieldValue({ kind: "number" }, "x")).toMatch(/number/i);
    expect(validateFieldValue({ kind: "number" }, "12B")).toMatch(/number/i);
  });
  it("date: must be a complete ISO date/time with an offset", () => {
    expect(validateFieldValue({ kind: "date" }, "2026-08-01T10:00:00+08:00")).toBeNull();
    expect(validateFieldValue({ kind: "date" }, "2026-08-01T02:00:00Z")).toBeNull();
    expect(validateFieldValue({ kind: "date" }, "2026-08-01T10:00")).toMatch(/date/i);
    expect(validateFieldValue({ kind: "date" }, "2026-08-01")).toMatch(/date/i);
    expect(validateFieldValue({ kind: "date" }, "2026-02-30T10:00:00Z")).toMatch(/date/i);
    expect(validateFieldValue({ kind: "date" }, "2026-08-01T10:00:00+8")).toMatch(/date/i);
    expect(validateFieldValue({ kind: "date" }, "half past seven")).toMatch(/date/i);
  });
  it("seat: row digits then a seat letter", () => {
    expect(validateFieldValue({ kind: "seat" }, "17C")).toBeNull();
    expect(validateFieldValue({ kind: "seat" }, "23 F")).toBeNull();
    expect(validateFieldValue({ kind: "seat" }, "C")).toMatch(/seat/i);
    expect(validateFieldValue({ kind: "seat" }, "17")).toMatch(/seat/i);
  });
  it("name/text: no format constraint", () => {
    expect(validateFieldValue({ kind: "name" }, "DELA CRUZ/JUAN")).toBeNull();
    expect(validateFieldValue({ kind: "text" }, "anything goes")).toBeNull();
  });
  it("empty: only an error when required (a default applies otherwise)", () => {
    expect(validateFieldValue({ kind: "iata", required: false }, "")).toBeNull();
    expect(validateFieldValue({ kind: "iata", required: false }, "   ")).toBeNull();
    expect(validateFieldValue({ kind: "text", required: true }, "")).toMatch(/required/i);
    expect(validateFieldValue({ kind: "iata", required: true }, "")).toMatch(/required/i);
  });
});

describe("normalizeFieldValue", () => {
  it("uppercases and trims an iata code; trims other strings", () => {
    expect(normalizeFieldValue("iata", "  mnl ")).toBe("MNL");
    expect(normalizeFieldValue("text", "  hi ")).toBe("hi");
    expect(normalizeFieldValue("number", "78")).toBe("78");
  });
  it("passes non-string values through untouched", () => {
    expect(normalizeFieldValue("iata", { value: "x" })).toEqual({ value: "x" });
  });
});

describe("kindAttrs — input affordances per kind", () => {
  it("iata caps at 3 chars with an uppercase pattern", () => {
    expect(kindAttrs("iata")).toMatchObject({ maxLength: 3, pattern: "[A-Z]{3}" });
  });
  it("number advertises a numeric pattern", () => {
    expect(kindAttrs("number").pattern).toMatch(/0-9/);
  });
  it("text has no constraints", () => {
    expect(kindAttrs("text")).toEqual({});
  });
});

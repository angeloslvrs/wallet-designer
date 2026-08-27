import { describe, it, expect } from "vitest";
import { currentFieldsOf } from "../apps/server/src/routes/admin.js";

// currentFieldsOf feeds the Manage "Update" editor's placeholders/hints, so an
// operator sees what's already live instead of a generic example — for both
// record shapes, and the delay note's shape-specific additionalInfoFields location.
describe("currentFieldsOf — current live values for the Manage editor", () => {
  it("reads semantics from a template record's data.semantics", () => {
    const rec = { data: { semantics: { departureGate: "B9", currentBoardingDate: "2026-06-14T07:30:00-07:00" } } };
    expect(currentFieldsOf(rec).departureGate).toBe("B9");
    expect(currentFieldsOf(rec).currentBoardingDate).toBe("2026-06-14T07:30:00-07:00");
  });

  it("unwraps a {value} patch form", () => {
    const rec = { data: { semantics: { departureGate: { value: "C12" } } } };
    expect(currentFieldsOf(rec).departureGate).toBe("C12");
  });

  it("reads semantics from a FormState record's state (migrated)", () => {
    const rec = { state: { semantics: { departureGate: "A3" } } };
    expect(currentFieldsOf(rec).departureGate).toBe("A3");
  });

  it("reads the delay note from additionalInfoFields — top-level for template, iOS26 for FormState", () => {
    const tpl = { data: { additionalInfoFields: [{ key: "delay", value: "45 min" }] } };
    expect(currentFieldsOf(tpl).delayed).toBe("45 min");
    const fs = { state: { iOS26: { additionalInfoFields: [{ key: "delay", value: "20 min" }] } } };
    expect(currentFieldsOf(fs).delayed).toBe("20 min");
  });

  it("returns undefined fields when there is no data", () => {
    expect(currentFieldsOf({ data: {} }).departureGate).toBeUndefined();
    expect(currentFieldsOf({ state: {} }).departureGate).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validate } from "../packages/pass-builder/validate.js";
import { migrateFormState } from "../packages/pass-builder/migrate.js";

const base = () => migrateFormState(JSON.parse(readFileSync("fixtures/fully-loaded.json", "utf8")));

describe("branding image fields", () => {
  it("accepts iconDataUrl / footerDataUrl / primaryLogoDataUrl", () => {
    const state = base();
    state.branding = {
      ...state.branding,
      iconDataUrl: "data:image/png;base64,iVB",
      footerDataUrl: "data:image/png;base64,iVB",
      primaryLogoDataUrl: "data:image/png;base64,iVB"
    };
    const v = validate(state);
    expect(v.ok).toBe(true);
  });

  it("still rejects an unknown branding property", () => {
    const state = base();
    state.branding = { ...state.branding, bogusDataUrl: "x" };
    expect(validate(state).ok).toBe(false);
  });
});

describe("nested field/item strictness (additionalProperties: false)", () => {
  it("rejects a typo'd property on a displayFields (fieldList) item", () => {
    const state = base();
    // "labl" instead of "label" — used to sail through to Apple verbatim.
    state.displayFields.header = [{ key: "gate", labl: "GATE", value: "B12" }];
    expect(validate(state).ok).toBe(false);
  });

  it("rejects an unknown property on an additionalInfoFields item", () => {
    const state = base();
    state.iOS26 = { ...state.iOS26, additionalInfoFields: [{ key: "x", label: "X", value: "y", bogus: "z" }] };
    expect(validate(state).ok).toBe(false);
  });

  it("rejects an unknown property on an upcomingPassInformation item", () => {
    const state = base();
    state.iOS26 = {
      ...state.iOS26,
      upcomingPassInformation: [{ identifier: "a", name: "b", date: "2026-06-01T08:15:00-07:00", bogus: 1 }]
    };
    expect(validate(state).ok).toBe(false);
  });

  it("rejects an unknown property on a wifi item", () => {
    const state = base();
    state.iOS26 = { ...state.iOS26, wifi: [{ ssid: "net", passwrd: "typo" }] };
    expect(validate(state).ok).toBe(false);
  });
});

describe("semantics unknown-key warning (non-fatal escape hatch)", () => {
  it("produces no warnings for a fixture using only known semantic keys", () => {
    const v = validate(base());
    expect(v.ok).toBe(true);
    expect(v.warnings).toBeUndefined();
  });

  it("warns — but does NOT fail — on an unknown semantic key", () => {
    const state = base();
    state.semantics = { ...state.semantics, deparchureAirportCode: "SFO" };
    const v = validate(state);
    expect(v.ok).toBe(true);                                   // escape hatch preserved
    expect(v.warnings?.map(w => w.key)).toContain("deparchureAirportCode");
  });
});

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

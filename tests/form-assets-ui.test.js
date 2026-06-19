// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { BRANDING_IMAGE_SLOTS } from "../packages/pass-builder/form-assets.js";

describe("Designer asset slots", () => {
  it("exposes a form path for every builder image slot", () => {
    // form.js builds Assets inputs from BRANDING_IMAGE_SLOTS, so the contract
    // is: every slot the builder can emit has a matching branding.<key> path.
    const paths = BRANDING_IMAGE_SLOTS.map(s => `branding.${s.key}`);
    expect(paths).toContain("branding.logoDataUrl");
    expect(paths).toContain("branding.iconDataUrl");
    expect(paths).toContain("branding.footerDataUrl");
    expect(paths).toContain("branding.primaryLogoDataUrl");
  });
});

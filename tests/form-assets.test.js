import { describe, it, expect } from "vitest";
import { imageAssetsFromBranding, BRANDING_IMAGE_SLOTS } from "../packages/pass-builder/form-assets.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG signature
const dataUrl = `data:image/png;base64,${PNG.toString("base64")}`;

describe("BRANDING_IMAGE_SLOTS", () => {
  it("covers exactly the boarding-pass image slots (no strip/thumbnail/background)", () => {
    expect(BRANDING_IMAGE_SLOTS.map(s => s.slot).sort())
      .toEqual(["footer", "icon", "logo", "primaryLogo"]);
    for (const s of BRANDING_IMAGE_SLOTS) {
      expect(s.key).toMatch(/DataUrl$/);
      expect(typeof s.label).toBe("string");
    }
  });
});

describe("imageAssetsFromBranding", () => {
  it("decodes one upload into base + @2x + @3x png entries", () => {
    const out = imageAssetsFromBranding({ logoDataUrl: dataUrl });
    expect(out["logo.png"]).toEqual(PNG);
    expect(out["logo@2x.png"]).toEqual(PNG);
    expect(out["logo@3x.png"]).toEqual(PNG);
    expect(Object.keys(out)).toHaveLength(3);
  });

  it("maps each slot independently and ignores empty / non-image values", () => {
    const out = imageAssetsFromBranding({ iconDataUrl: dataUrl, footerDataUrl: "", logoText: "RP" });
    expect(Object.keys(out).sort()).toEqual(["icon.png", "icon@2x.png", "icon@3x.png"]);
  });

  it("ignores a non-data-URL value", () => {
    expect(imageAssetsFromBranding({ logoDataUrl: "https://x/y.png" })).toEqual({});
  });

  it("ignores a non-PNG image data URL (Apple passes require PNG)", () => {
    const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff]).toString("base64")}`;
    expect(imageAssetsFromBranding({ logoDataUrl: jpeg })).toEqual({});
  });

  it("returns {} for missing / non-object branding", () => {
    expect(imageAssetsFromBranding(undefined)).toEqual({});
    expect(imageAssetsFromBranding({})).toEqual({});
  });
});

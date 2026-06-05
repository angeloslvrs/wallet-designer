import { describe, it, expect } from "vitest";
import { toPassView } from "../apps/designer/src/preview/wallet/model.js";

const samplePass = {
  logoText: "EVA Air",
  backgroundColor: "rgb(0,104,71)",
  foregroundColor: "rgb(255,255,255)",
  labelColor: "rgb(244,168,32)",
  barcodes: [{ format: "PKBarcodeFormatPDF417", message: "BR262MNLTPE38K0073", altText: "BR262 38K" }],
  boardingPass: {
    headerFields: [{ key: "gate", label: "GATE", value: "5" }],
    primaryFields: [
      { key: "depart", label: "Manila", value: "MNL" },
      { key: "arrive", label: "Taipei", value: "TPE" }
    ],
    secondaryFields: [{ key: "passenger", label: "PASSENGER", value: "ANGELO SOLIVERES" }],
    auxiliaryFields: [
      { key: "boarding", label: "BOARDING", value: "2026-06-20T13:30:00+08:00", timeStyle: "PKDateStyleShort", dateStyle: "PKDateStyleNone" }
    ],
    backFields: [{ key: "ff", label: "FREQUENT FLYER", value: "BR-INFINITY-7788990" }],
    additionalInfoFields: [{ key: "meal", label: "MEAL", value: "Hot meal" }]
  }
};

describe("toPassView", () => {
  it("maps colors from the pass with sensible fallbacks", () => {
    const v = toPassView(samplePass);
    expect(v.colors).toEqual({
      bg: "rgb(0,104,71)",
      fg: "rgb(255,255,255)",
      label: "rgb(244,168,32)"
    });
  });

  it("maps each zone to {key,label,value}", () => {
    const v = toPassView(samplePass);
    expect(v.primary).toHaveLength(2);
    expect(v.primary[0]).toEqual({ key: "depart", label: "Manila", value: "MNL" });
    expect(v.header[0]).toEqual({ key: "gate", label: "GATE", value: "5" });
    expect(v.back[0].value).toBe("BR-INFINITY-7788990");
    expect(v.additional[0].label).toBe("MEAL");
  });

  it("formats dated auxiliary fields through format.js", () => {
    const v = toPassView(samplePass);
    expect(v.auxiliary[0].value).toMatch(/\d{1,2}:\d{2}/);
  });

  it("exposes the first barcode", () => {
    const v = toPassView(samplePass);
    expect(v.barcode).toEqual({
      format: "PKBarcodeFormatPDF417",
      message: "BR262MNLTPE38K0073",
      altText: "BR262 38K"
    });
  });

  it("returns null barcode and empty zones for a bare pass", () => {
    const v = toPassView({});
    expect(v.barcode).toBeNull();
    expect(v.primary).toEqual([]);
    expect(v.colors.bg).toBe("rgb(0,0,0)");
  });
});

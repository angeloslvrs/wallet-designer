// Note: renderBarcode (DOM/canvas) is intentionally not unit-tested here and is verified
// by eye per the plan. Only the pure passKitToBwipType format map is covered below.
import { describe, it, expect } from "vitest";
import { passKitToBwipType } from "../apps/designer/src/preview/wallet/barcode.js";

describe("passKitToBwipType", () => {
  it("maps every supported PassKit format", () => {
    expect(passKitToBwipType("PKBarcodeFormatPDF417")).toBe("pdf417");
    expect(passKitToBwipType("PKBarcodeFormatQR")).toBe("qrcode");
    expect(passKitToBwipType("PKBarcodeFormatAztec")).toBe("azteccode");
    expect(passKitToBwipType("PKBarcodeFormatCode128")).toBe("code128");
  });

  it("returns null for an unknown format", () => {
    expect(passKitToBwipType("PKBarcodeFormatBogus")).toBeNull();
    expect(passKitToBwipType(undefined)).toBeNull();
  });
});

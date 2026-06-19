// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { showBcbpPreview } from "../apps/designer/src/bcbp-preview.js";

const parsed = {
  passengerName: { givenName: "LUC", familyName: "DESMARAIS" },
  departureAirportCode: "YUL", destinationAirportCode: "FRA",
  flightCode: "AC834", seats: [{ seatRow: "1", seatNumber: "A" }],
  boardingSequenceNumber: "25", flightDate: "2026-08-14"
};

describe("showBcbpPreview", () => {
  it("renders detected fields and resolves true on Confirm", async () => {
    const p = showBcbpPreview(parsed);
    const overlay = document.querySelector(".bcbp-preview");
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain("AC834");
    expect(overlay.textContent).toContain("YUL");
    expect(overlay.textContent).toContain("FRA");
    overlay.querySelector("[data-bcbp-confirm]").click();
    await expect(p).resolves.toBe(true);
    expect(document.querySelector(".bcbp-preview")).toBeNull(); // removed after choice
  });

  it("resolves false on Cancel", async () => {
    const p = showBcbpPreview(parsed);
    document.querySelector("[data-bcbp-cancel]").click();
    await expect(p).resolves.toBe(false);
  });

  it("escapes scanned values to prevent HTML injection", () => {
    showBcbpPreview({ passengerName: { givenName: "<img src=x onerror=alert(1)>", familyName: "X" } });
    const overlay = document.querySelector(".bcbp-preview");
    expect(overlay.querySelector("img")).toBeNull();      // not parsed as real markup
    expect(overlay.textContent).toContain("<img");        // shown as literal text
    overlay.querySelector("[data-bcbp-cancel]").click();
  });
});

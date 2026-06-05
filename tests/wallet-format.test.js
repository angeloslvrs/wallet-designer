import { describe, it, expect } from "vitest";
import { formatFieldValue } from "../apps/designer/src/preview/wallet/format.js";

describe("formatFieldValue", () => {
  it("returns an em-dash for empty values", () => {
    expect(formatFieldValue({ value: "" })).toBe("—");
    expect(formatFieldValue({ value: null })).toBe("—");
    expect(formatFieldValue({ value: undefined })).toBe("—");
  });

  it("returns the raw string when no style is set", () => {
    expect(formatFieldValue({ value: "38K" })).toBe("38K");
  });

  it("formats an ISO datetime to a time string when timeStyle is short", () => {
    const out = formatFieldValue({
      value: "2026-06-20T13:30:00+08:00",
      dateStyle: "PKDateStyleNone",
      timeStyle: "PKDateStyleShort"
    });
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });

  it("falls back to the raw value for an unparseable date", () => {
    expect(formatFieldValue({ value: "not-a-date", timeStyle: "PKDateStyleShort" })).toBe("not-a-date");
  });

  it("formats a percent number when numberStyle is percent", () => {
    expect(formatFieldValue({ value: 0.5, numberStyle: "PKNumberStylePercent" })).toBe("50%");
  });

  it("formats 0.75 as 75% for PKNumberStylePercent (decimal 0–1 range)", () => {
    expect(formatFieldValue({ value: 0.75, numberStyle: "PKNumberStylePercent" })).toMatch(/75\s*%/);
  });
});

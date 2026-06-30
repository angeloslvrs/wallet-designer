import { describe, it, expect } from "vitest";
import { splitIso, joinIso, localUtcOffset, isEmptyTyped } from "../apps/designer/src/inputs.js";

describe("splitIso / joinIso", () => {
  it("splits an offset ISO into wall-clock + offset and rejoins it", () => {
    expect(splitIso("2026-06-01T07:30:00-07:00")).toEqual({ local: "2026-06-01T07:30", offset: "-07:00" });
    expect(joinIso("2026-06-01T07:30", "-07:00")).toBe("2026-06-01T07:30:00-07:00");
  });
  it("handles Z, naive, fractional seconds, and garbage", () => {
    expect(splitIso("2026-06-01T07:30:00Z")).toEqual({ local: "2026-06-01T07:30", offset: "Z" });
    expect(splitIso("2026-06-01T07:30")).toEqual({ local: "2026-06-01T07:30", offset: "" });
    expect(splitIso("2026-06-01T07:30:00.000+09:30")).toEqual({ local: "2026-06-01T07:30", offset: "+09:30" });
    expect(splitIso("not-a-date")).toEqual({ local: "", offset: "" });
    expect(joinIso("", "-07:00")).toBe("");
    expect(joinIso("2026-06-01T07:30", "-07:00")).toBe("2026-06-01T07:30:00-07:00");
  });

  it("defaults a blank offset to the edited date's own local offset, not the current season's", () => {
    const jan = "2026-01-15T09:00";
    const jul = "2026-07-15T09:00";
    expect(joinIso(jan, "")).toBe(`${jan}:00${localUtcOffset(new Date(jan))}`);
    expect(joinIso(jul, "")).toBe(`${jul}:00${localUtcOffset(new Date(jul))}`);
  });
});

describe("isEmptyTyped", () => {
  it("treats blank string / null / undefined as empty for every type", () => {
    for (const t of ["text", "date", "number", "boolean", "personName", "seats", "stringArray", "enum", "location", "currency"]) {
      expect(isEmptyTyped(t, undefined)).toBe(true);
      expect(isEmptyTyped(t, null)).toBe(true);
    }
    expect(isEmptyTyped("text", "")).toBe(true);
    expect(isEmptyTyped("text", "x")).toBe(false);
  });
  it("applies type-specific emptiness", () => {
    expect(isEmptyTyped("boolean", false)).toBe(false);
    expect(isEmptyTyped("number", 0)).toBe(false);
    expect(isEmptyTyped("personName", { givenName: "", familyName: "" })).toBe(true);
    expect(isEmptyTyped("personName", { givenName: "A", familyName: "" })).toBe(false);
    expect(isEmptyTyped("seats", [])).toBe(true);
    expect(isEmptyTyped("seats", [{ seatNumber: "C" }])).toBe(false);
    expect(isEmptyTyped("stringArray", [])).toBe(true);
    expect(isEmptyTyped("stringArray", ["X"])).toBe(false);
    expect(isEmptyTyped("location", { latitude: 0, longitude: 0 })).toBe(false);
    expect(isEmptyTyped("location", {})).toBe(true);
  });
});

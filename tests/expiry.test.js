import { describe, it, expect } from "vitest";
import { addDaysPreservingOffset, applyPassDates } from "../packages/pass-builder/expiry.js";

describe("addDaysPreservingOffset", () => {
  it("adds a day keeping wall-clock time + offset", () => {
    expect(addDaysPreservingOffset("2026-08-28T17:55:00+08:00", 1)).toBe("2026-08-29T17:55:00+08:00");
  });
  it("handles month/year rollover and Z", () => {
    expect(addDaysPreservingOffset("2026-12-31T23:00:00Z", 1)).toBe("2027-01-01T23:00:00Z");
  });
  it("handles naive (offset-less) ISO and HH:MM-only time", () => {
    expect(addDaysPreservingOffset("2026-08-28T15:45", 1)).toBe("2026-08-29T15:45:00");
  });
  it("returns undefined for junk", () => {
    expect(addDaysPreservingOffset("nope", 1)).toBeUndefined();
  });
  it("rolls over month boundaries", () => {
    expect(addDaysPreservingOffset("2026-01-31T08:00:00+08:00", 1)).toBe("2026-02-01T08:00:00+08:00");
  });
  it("preserves fractional seconds", () => {
    expect(addDaysPreservingOffset("2026-08-28T17:55:00.500+08:00", 1)).toBe("2026-08-29T17:55:00.500+08:00");
  });
  it("rejects calendar-invalid datetimes", () => {
    expect(addDaysPreservingOffset("2026-13-01T25:99:00Z", 1)).toBeUndefined();
  });
});

describe("applyPassDates", () => {
  const base = () => ({
    serialNumber: "PAL",
    semantics: {
      currentBoardingDate: "2026-08-28T15:50:00+08:00",
      currentDepartureDate: "2026-08-28T16:35:00+08:00",
      currentArrivalDate: "2026-08-28T17:55:00+08:00"
    },
    relevantDates: [{ date: "2026-06-15T05:00:00+08:00", relevantDate: "2026-06-15T05:00:00+08:00" }] // the stale bug value
  });

  it("derives relevantDate from boarding and DROPS the stale relevantDates", () => {
    const out = applyPassDates(base());
    expect(out.relevantDate).toBe("2026-08-28T15:50:00+08:00");
    expect(out.relevantDates).toBeUndefined();
  });

  it("defaults expirationDate to arrival + 1 day", () => {
    expect(applyPassDates(base()).expirationDate).toBe("2026-08-29T17:55:00+08:00");
  });

  it("honors a custom expirationDate over the derived default", () => {
    const out = applyPassDates(base(), { expirationDate: "2026-09-01T00:00:00+08:00" });
    expect(out.expirationDate).toBe("2026-09-01T00:00:00+08:00");
  });

  it("ignores a blank/invalid custom value and falls back to arrival + 1", () => {
    expect(applyPassDates(base(), { expirationDate: "  " }).expirationDate).toBe("2026-08-29T17:55:00+08:00");
  });

  it("does not mutate the input and leaves a dateless pass alone", () => {
    const input = { semantics: {} };
    const out = applyPassDates(input);
    expect(out.expirationDate).toBeUndefined();
    expect(out.relevantDate).toBeUndefined();
    expect(input).toEqual({ semantics: {} });
  });
  it("drops a stale relevantDates even when there are no flight semantics", () => {
    const out = applyPassDates({ semantics: {}, relevantDates: [{ date: "2026-06-15T05:00:00+08:00", relevantDate: "2026-06-15T05:00:00+08:00" }] });
    expect(out.relevantDates).toBeUndefined();
    expect(out.relevantDate).toBeUndefined();
    expect(out.expirationDate).toBeUndefined();
  });
  it("falls back to arrival+1 when custom expiry is calendar-invalid", () => {
    expect(applyPassDates(base(), { expirationDate: "2026-13-40T99:99:00Z" }).expirationDate).toBe("2026-08-29T17:55:00+08:00");
  });
  it("derives expiry from departure when no arrival date is present", () => {
    const p = { semantics: { currentDepartureDate: "2026-08-28T16:35:00+08:00" } };
    expect(applyPassDates(p).expirationDate).toBe("2026-08-29T16:35:00+08:00");
  });
});

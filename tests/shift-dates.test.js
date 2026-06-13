import { describe, it, expect } from "vitest";
import { shiftPassDates } from "../packages/pass-builder/shift-dates.js";

const base = () => ({
  semantics: {
    originalBoardingDate: "2026-06-20T05:05:00+08:00",
    currentBoardingDate:  "2026-06-20T05:05:00+08:00",
    originalDepartureDate: "2026-06-20T05:45:00+08:00",
    currentDepartureDate:  "2026-06-20T05:45:00+08:00",
    originalArrivalDate: "2026-06-20T08:05:00+08:00",
    currentArrivalDate:  "2026-06-20T08:05:00+08:00"
  },
  displayFields: { auxiliary: [{ key: "boarding", label: "BOARDING", value: "2026-06-20T05:05:00+08:00", dateStyle: "PKDateStyleNone", timeStyle: "PKDateStyleShort" }] },
  iOS26: {
    relevantDates: ["2026-06-20T04:45:00+08:00"],
    upcomingPassInformation: [{ identifier: "x", name: "X", date: "2026-06-18T05:45:00+08:00" }]
  }
});
const NOW = Date.parse("2026-01-01T00:00:00Z");

describe("shiftPassDates", () => {
  it("anchors current departure to now + leadMinutes", () => {
    const out = shiftPassDates(base(), { leadMinutes: 60, now: NOW });
    expect(Date.parse(out.semantics.currentDepartureDate) - NOW).toBe(60 * 60000);
  });

  it("preserves the gaps between schedule events", () => {
    const out = shiftPassDates(base(), { leadMinutes: 60, now: NOW });
    const dep = Date.parse(out.semantics.currentDepartureDate);
    expect(dep - Date.parse(out.semantics.currentBoardingDate)).toBe(40 * 60000); // 05:45 - 05:05
    expect(Date.parse(out.semantics.currentArrivalDate) - dep).toBe(140 * 60000); // 08:05 - 05:45
  });

  it("shifts a display field whose value is an ISO datetime", () => {
    const out = shiftPassDates(base(), { leadMinutes: 60, now: NOW });
    const dep = Date.parse(out.semantics.currentDepartureDate);
    expect(dep - Date.parse(out.displayFields.auxiliary[0].value)).toBe(40 * 60000);
  });

  it("shifts relevantDates and upcomingPassInformation", () => {
    const out = shiftPassDates(base(), { leadMinutes: 60, now: NOW });
    const dep = Date.parse(out.semantics.currentDepartureDate);
    expect(dep - Date.parse(out.iOS26.relevantDates[0])).toBe(60 * 60000);
    expect(Date.parse(out.iOS26.upcomingPassInformation[0].date)).toBeLessThan(dep);
  });

  it("emits +08:00 offset strings", () => {
    const out = shiftPassDates(base(), { leadMinutes: 60, now: NOW });
    expect(out.semantics.currentDepartureDate).toMatch(/\+08:00$/);
  });

  it("does not mutate the input", () => {
    const input = base();
    shiftPassDates(input, { leadMinutes: 60, now: NOW });
    expect(input.semantics.currentDepartureDate).toBe("2026-06-20T05:45:00+08:00");
  });

  it("returns the state untouched when there is no departure date", () => {
    const out = shiftPassDates({ semantics: {} }, { now: NOW });
    expect(out.semantics.currentDepartureDate).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { shiftPassDates } from "../packages/pass-builder/shift-dates.js";

const base = () => ({
  flight: {
    departure: {
      gateOpen: "2026-06-20T04:45:00+08:00",
      boarding: "2026-06-20T05:05:00+08:00",
      depart:   "2026-06-20T05:45:00+08:00"
    },
    arrival: { arrive: "2026-06-20T08:05:00+08:00" }
  },
  iOS26: {
    relevantDates: ["2026-06-20T04:45:00+08:00"],
    upcomingPassInformation: [{ identifier: "x", name: "X", date: "2026-06-18T05:45:00+08:00" }]
  }
});

// Fixed "now": 2026-01-01T00:00:00Z
const NOW = Date.parse("2026-01-01T00:00:00Z");

describe("shiftPassDates", () => {
  it("anchors departure to now + leadMinutes", () => {
    const out = shiftPassDates(base(), { leadMinutes: 60, now: NOW });
    expect(Date.parse(out.flight.departure.depart) - NOW).toBe(60 * 60000);
  });

  it("preserves the gaps between events", () => {
    const out = shiftPassDates(base(), { leadMinutes: 60, now: NOW });
    const dep = Date.parse(out.flight.departure.depart);
    expect(dep - Date.parse(out.flight.departure.boarding)).toBe(40 * 60000); // 05:45 - 05:05
    expect(dep - Date.parse(out.flight.departure.gateOpen)).toBe(60 * 60000);  // 05:45 - 04:45
    expect(Date.parse(out.flight.arrival.arrive) - dep).toBe(140 * 60000);     // 08:05 - 05:45
  });

  it("shifts relevantDates and upcomingPassInformation dates", () => {
    const out = shiftPassDates(base(), { leadMinutes: 60, now: NOW });
    const dep = Date.parse(out.flight.departure.depart);
    expect(dep - Date.parse(out.iOS26.relevantDates[0])).toBe(60 * 60000);
    expect(Date.parse(out.iOS26.upcomingPassInformation[0].date)).toBeLessThan(dep);
  });

  it("emits +08:00 offset strings", () => {
    const out = shiftPassDates(base(), { leadMinutes: 60, now: NOW });
    expect(out.flight.departure.depart).toMatch(/\+08:00$/);
  });

  it("does not mutate the input", () => {
    const input = base();
    shiftPassDates(input, { leadMinutes: 60, now: NOW });
    expect(input.flight.departure.depart).toBe("2026-06-20T05:45:00+08:00");
  });

  it("returns the state untouched when there is no departure time", () => {
    const out = shiftPassDates({ flight: { departure: {}, arrival: {} } }, { now: NOW });
    expect(out.flight.departure.depart).toBeUndefined();
  });
});

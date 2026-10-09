import { describe, it, expect } from "vitest";
import { ROUTE_ID_RE, ROUTE_SEMANTICS, validateRoute, routeSchedule, suggestRouteId } from "../packages/pass-builder/route.js";

// A route = the reusable part of a flight: identity, airports and times of day
// (no date, gate or passenger). Issue composes a date + the airports' zones.

const ok = () => ({
  template: { kind: "studio", id: "philippine-airlines" },
  values: { flightCode: "PR2987", flightNumber: 2987, departureAirportCode: "MNL", destinationAirportCode: "TAC", departureAirportTimeZone: "Asia/Manila", duration: 4800 },
  schedule: { boarding: "16:05", departure: "16:35", arrival: "17:55", arrivalDayOffset: 0 },
  fields: { "terminal-arr": "" }
});

describe("validateRoute", () => {
  it("accepts a well-formed route", () => {
    expect(validateRoute(ok())).toEqual([]);
  });
  it("rejects flight-level, passenger and unknown semantics", () => {
    for (const k of ["departureGate", "passengerName", "currentBoardingDate", "nope"]) {
      const r = ok(); r.values[k] = "x";
      expect(validateRoute(r).join()).toContain(k);
    }
  });
  it("checks template ref, schedule shape and day offset", () => {
    expect(validateRoute({ ...ok(), template: { kind: "x", id: "a" } }).length).toBeGreaterThan(0);
    expect(validateRoute({ ...ok(), template: { kind: "studio", id: "../x" } }).length).toBeGreaterThan(0);
    expect(validateRoute({ ...ok(), schedule: { boarding: "4pm" } }).length).toBeGreaterThan(0);
    expect(validateRoute({ ...ok(), schedule: { arrivalDayOffset: 5 } }).length).toBeGreaterThan(0);
    expect(validateRoute({ ...ok(), fields: { a: 1 } }).length).toBeGreaterThan(0);
    expect(validateRoute(null).length).toBeGreaterThan(0);
  });
  it("route vocabulary keeps gates out and duration in", () => {
    expect(ROUTE_SEMANTICS.has("departureGate")).toBe(false);
    expect(ROUTE_SEMANTICS.has("duration")).toBe(true);
    expect(ROUTE_SEMANTICS.has("departureTerminal")).toBe(true);
  });
});

describe("routeSchedule", () => {
  const offsetFor = (local, zone) => ({ "Asia/Manila": "+08:00", "Asia/Tokyo": "+09:00" }[zone] ?? null);
  it("composes ISO dates from times of day in each airport's zone", () => {
    const r = ok();
    r.values.destinationAirportTimeZone = "Asia/Tokyo";
    expect(routeSchedule(r, "2026-10-12", offsetFor)).toEqual({
      currentBoardingDate: "2026-10-12T16:05:00+08:00",
      currentDepartureDate: "2026-10-12T16:35:00+08:00",
      currentArrivalDate: "2026-10-12T17:55:00+09:00"
    });
  });
  it("applies the arrival day offset across a month end and falls back to the departure zone", () => {
    const r = ok();
    r.schedule = { departure: "23:30", arrival: "01:10", arrivalDayOffset: 1 };
    expect(routeSchedule(r, "2026-10-31", offsetFor)).toEqual({
      currentDepartureDate: "2026-10-31T23:30:00+08:00",
      currentArrivalDate: "2026-11-01T01:10:00+08:00"
    });
  });
  it("returns nothing for a bad date", () => {
    expect(routeSchedule(ok(), "soon", offsetFor)).toEqual({});
  });
});

describe("ids", () => {
  it("suggests PR2987-MNL-TAC and accepts it", () => {
    const id = suggestRouteId(ok().values);
    expect(id).toBe("PR2987-MNL-TAC");
    expect(ROUTE_ID_RE.test(id)).toBe(true);
    expect(suggestRouteId({ airlineCode: "5J", flightNumber: 5056 })).toBe("5J5056");
    expect(suggestRouteId({})).toBe("route");
  });
});

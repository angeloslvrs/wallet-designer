import { describe, it, expect } from "vitest";
import { currentFieldsOf, routeOf } from "../apps/server/src/routes/admin.js";

// currentFieldsOf feeds the Manage "Update" editor's placeholders/hints, so an
// operator sees what's already live instead of a generic example — for both
// record shapes, and the delay note's shape-specific additionalInfoFields location.
describe("currentFieldsOf — current live values for the Manage editor", () => {
  it("reads semantics from a template record's data.semantics", () => {
    const rec = { data: { semantics: { departureGate: "B9", currentBoardingDate: "2026-06-14T07:30:00-07:00" } } };
    expect(currentFieldsOf(rec).departureGate).toBe("B9");
    expect(currentFieldsOf(rec).currentBoardingDate).toBe("2026-06-14T07:30:00-07:00");
  });

  it("unwraps a {value} patch form", () => {
    const rec = { data: { semantics: { departureGate: { value: "C12" } } } };
    expect(currentFieldsOf(rec).departureGate).toBe("C12");
  });

  it("reads semantics from a FormState record's state (migrated)", () => {
    const rec = { state: { semantics: { departureGate: "A3" } } };
    expect(currentFieldsOf(rec).departureGate).toBe("A3");
  });

  it("reads the delay note from additionalInfoFields — top-level for template, iOS26 for FormState", () => {
    const tpl = { data: { additionalInfoFields: [{ key: "delay", value: "45 min" }] } };
    expect(currentFieldsOf(tpl).delayed).toBe("45 min");
    const fs = { state: { iOS26: { additionalInfoFields: [{ key: "delay", value: "20 min" }] } } };
    expect(currentFieldsOf(fs).delayed).toBe("20 min");
  });

  it("returns undefined fields when there is no data", () => {
    expect(currentFieldsOf({ data: {} }).departureGate).toBeUndefined();
    expect(currentFieldsOf({ state: {} }).departureGate).toBeUndefined();
  });
});

// routeOf feeds the Flights board's destination / flight-number columns.
describe("routeOf — route + flight identity for the Flights board", () => {
  it("reads codes, cities and composes the flight label from a template record", () => {
    const rec = { data: { semantics: { airlineCode: "5J", flightNumber: 5056, departureAirportCode: "MNL", destinationAirportCode: "NRT", destinationCityName: "Tokyo" } } };
    expect(routeOf(rec)).toEqual({ from: "MNL", to: "NRT", fromCity: undefined, toCity: "Tokyo", flight: "5J 5056" });
  });
  it("falls back to flightCode and unwraps {value} patches on a FormState record", () => {
    const rec = { state: { semantics: { flightCode: "RP247", departureAirportCode: { value: "SFO" }, destinationAirportCode: "JFK" } } };
    expect(routeOf(rec).flight).toBe("RP247");
    expect(routeOf(rec).from).toBe("SFO");
  });
  it("overlays a template pass's stored semantics on the bundle's baked ones; a stored null deletes", () => {
    const base = { airlineCode: "XX", flightNumber: "1", departureAirportCode: "AAA", destinationAirportCode: "BBB", destinationCityName: "Sample" };
    const rec = { data: { semantics: { airlineCode: "5J", flightNumber: 5056, destinationCityName: null } } };
    expect(routeOf(rec, base)).toEqual({ from: "AAA", to: "BBB", fromCity: undefined, toCity: undefined, flight: "5J 5056" });
    // FormState passes have no bundle: base is ignored.
    expect(routeOf({ state: { semantics: { airlineCode: "RP", flightNumber: "247" } } }, base).flight).toBe("RP 247");
  });
  it("returns undefineds when there is no data", () => {
    expect(routeOf({ data: {} }).from).toBeUndefined();
    expect(routeOf({ state: {} }).flight).toBeUndefined();
  });
});

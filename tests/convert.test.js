import { describe, it, expect } from "vitest";
import { planConversion, applyConversion } from "../packages/pass-builder/convert.js";
import { formStateToPassJson } from "../packages/pass-builder/form-to-pass.js";
import { discoverBindings } from "../packages/pass-builder/bindings.js";
import { validateRoute } from "../packages/pass-builder/route.js";
import { validate } from "../packages/pass-builder/validate.js";

// "Make airline from this design": split a flat Studio design (look + route +
// a sample flight + a sample passenger) into an airline design, its bindings
// and a route. Modelled on the deploy box's PR2987MNL-TAC (passenger data
// here is made up), including its Cebu Pacific leftovers.

const design = () => ({
  meta: { passTypeId: "pass.dev.local", teamId: "DEV0000000", organizationName: "Philippine Airlines", serialNumber: "PAL", description: "Philippine Airlines Boarding Pass", authenticationToken: "5J5056-token-0123456789abcdef", webServiceURL: "http://localhost:4317/api/wallet" },
  branding: { logoText: "", foregroundColor: "rgb(255,255,255)", backgroundColor: "rgb(0,29,95)", labelColor: "rgb(191,202,242)" },
  barcode: { format: "PKBarcodeFormatQR", message: "M1DOE/JANE            EABC123 MNLTACPR 2987 240Y042A0036 100", altText: "" },
  displayFields: {
    header: [{ key: "gate", label: "GATE", value: "" }, { key: "seat", label: "SEAT", value: "42A" }],
    primary: [{ key: "depart", label: "MANILA NINOY AQUINO INTL", value: "MNL" }, { key: "arrive", label: "TACLOBAN D Z ROMUALDEZ", value: "TAC" }],
    secondary: [{ key: "passenger", label: "PASSENGER", value: "JANE DOE" }, { key: "flight", label: "FLIGHT", value: "PR2987" }],
    auxiliary: [{ key: "boarding", label: "BOARDING", value: "16:05" }, { key: "depart-time", label: "DEPART", value: "16:35" }, { key: "seq", label: "SEQ", value: "36" }],
    back: [{ key: "ff", label: "FREQUENT FLYER", value: "—" }, { key: "terminal-dep", label: "DEPARTURE TERMINAL", value: "2" }, { key: "terminal-arr", label: "ARRIVAL TERMINAL", value: "" }]
  },
  semantics: {
    airlineCode: "PR", flightCode: "PR2987", flightNumber: 2987,
    departureAirportCode: "MNL", departureAirportName: "Ninoy Aquino International", departureCityName: "Manila",
    destinationAirportCode: "TAC", destinationAirportName: "Daniel Z. Romualdez", destinationCityName: "Tacloban",
    departureTerminal: "2", departureGate: "",
    departureLocationTimeZone: "Asia/Manila", departureAirportTimeZone: "Asia/Manila",
    destinationLocationTimeZone: "Asia/Manila", destinationAirportTimeZone: "Asia/Manila",
    departureLocation: { latitude: 14.5086, longitude: 121.0194 },
    originalDepartureDate: "2026-08-28T16:35:00+08:00", currentDepartureDate: "2026-08-28T16:35:00+08:00",
    originalArrivalDate: "2026-08-28T17:55:00+08:00", currentArrivalDate: "2026-08-28T17:55:00+08:00",
    originalBoardingDate: "2026-08-28T16:05:00+08:00", currentBoardingDate: "2026-08-28T16:05:00+08:00",
    passengerName: { givenName: "JANE", familyName: "DOE" }, boardingSequenceNumber: "36",
    seats: [{ seatRow: "42", seatNumber: "A" }], duration: 4800, confirmationNumber: "ABC123"
  },
  iOS26: {
    additionalInfoFields: [{ key: "fare-class", label: "FARE", value: "GoLite" }],
    relevantDates: ["2026-06-15T05:00:00+08:00"],
    eventGuide: { bagPolicyURL: "https://www.cebupacificair.com/baggage", orderFoodURL: "https://www.philippineairlines.com/food", parkingInformationURL: "https://www.miaa.gov.ph/parking" },
    upcomingPassInformation: [{ identifier: "checkin-open", name: "Web check-in opens", date: "2026-06-14T06:00:00+08:00" }],
    wifi: [{ ssid: "CebPac-WiFi", password: "5J5056" }]
  }
});

const bindingsOf = (s) => Object.fromEntries(Object.entries(discoverBindings(formStateToPassJson(s, { resolveFields: false }))).map(([k, b]) => [k, b.fieldKey]));
const byId = (plan) => Object.fromEntries(plan.items.map(i => [i.id, i]));

describe("planConversion", () => {
  const s = design(), plan = planConversion(s, bindingsOf(s)), items = byId(plan);

  it("suggests names and keeps the airline code on the airline", () => {
    expect(plan).toMatchObject({ airlineCode: "PR", suggestedName: "philippine-airlines", suggestedRouteId: "PR2987-MNL-TAC" });
    expect(items["sem:airlineCode"]).toMatchObject({ tier: "airline", options: ["airline"] });
  });

  it("route semantics go to the route; passenger/flight-day values are dropped", () => {
    expect(items["sem:departureAirportCode"].tier).toBe("route");
    expect(items["sem:duration"].tier).toBe("route");
    expect(items["sem:passengerName"].tier).toBe("drop");
    expect(items["sem:confirmationNumber"].tier).toBe("drop");
    expect(items.schedule).toMatchObject({ tier: "route", value: "boarding 16:05 · departure 16:35 · arrival 17:55" });
    expect(Object.keys(items).some(id => /Date$/.test(id))).toBe(false);
  });

  it("typed time text matching the schedule becomes a bound time field (24h by its shape)", () => {
    expect(items["time:boarding"]).toMatchObject({ tier: "route", semantic: "currentBoardingDate", format: "24h" });
    expect(items["time:depart-time"]).toMatchObject({ semantic: "currentDepartureDate" });
  });

  it("place names in airport labels become tokens, previewed as they'll read", () => {
    expect(items["label:depart"]).toMatchObject({ tier: "route", label: "{departureCityName:upper} {departureAirportName:upper}" });
    expect(items["label:depart"].note).toContain("MANILA NINOY AQUINO INTERNATIONAL");
    expect(items["label:arrive"].label).toBe("{destinationCityName:upper} {destinationAirportName:upper}");
  });

  it("flags another airline's links and wifi; lists every extra and back field", () => {
    expect(items["eventGuide:bagPolicyURL"]).toMatchObject({ tier: "drop", flag: expect.stringMatching(/another airline/i) });
    expect(items["eventGuide:orderFoodURL"]).toMatchObject({ tier: "airline" });
    expect(items["eventGuide:orderFoodURL"].flag).toBeUndefined();
    expect(items["eventGuide:parkingInformationURL"]).toMatchObject({ tier: "drop", flag: expect.stringMatching(/one airport/) });
    expect(items["wifi:0"]).toMatchObject({ tier: "drop", flag: expect.any(String) });
    expect(items["field:ff"]).toBeTruthy();
    expect(items["field:fare-class"]).toMatchObject({ tier: "drop" });
    expect(items.upcomingPassInformation).toMatchObject({ tier: "drop", options: ["drop"] });
  });
});

describe("applyConversion", () => {
  const s = design(), bindings = bindingsOf(s), plan = planConversion(s, bindings);
  const out = applyConversion(s, bindings, plan, {});

  it("writes a value-less airline design that still validates", () => {
    const a = out.airline;
    expect(validate(a).ok).toBe(true);
    expect(a.semantics).toEqual({ airlineCode: "PR" });
    expect(a.displayFields.header).toEqual([{ key: "gate", label: "GATE", value: "" }, { key: "seat", label: "SEAT", value: "" }]);
    expect(a.displayFields.secondary[0].value).toBe("");
    expect(a.displayFields.auxiliary[0]).toEqual({ key: "boarding", label: "BOARDING", value: "", timeFormat: "24h" });
    expect(a.displayFields.primary[0]).toEqual({ key: "depart", label: "{departureCityName:upper} {departureAirportName:upper}", value: "" });
    expect(a.barcode).toMatchObject({ format: "PKBarcodeFormatQR", message: "", altText: "" });
    expect(a.meta.authenticationToken).toBeUndefined();
    expect(a.iOS26.eventGuide).toEqual({ orderFoodURL: "https://www.philippineairlines.com/food" });
    expect(a.iOS26.wifi).toBeUndefined();
    expect(a.iOS26.relevantDates).toBeUndefined();
    expect(a.iOS26.upcomingPassInformation).toBeUndefined();
    expect(a.iOS26.additionalInfoFields[0].value).toBe("");
  });

  it("keeps passenger bindings and adds the time bindings", () => {
    expect(out.bindings).toMatchObject({ passengerName: "passenger", seats: "seat", departureAirportCode: "depart", currentBoardingDate: "boarding", currentDepartureDate: "depart-time" });
  });

  it("produces a valid route with times of day and the unbound values", () => {
    expect(validateRoute({ template: { kind: "studio", id: "x" }, ...out.route })).toEqual([]);
    expect(out.route.values).toMatchObject({ flightCode: "PR2987", departureAirportCode: "MNL", departureCityName: "Manila", departureTerminal: "2", duration: 4800 });
    expect(out.route.values.departureGate).toBeUndefined();
    expect(out.route.values.airlineCode).toBeUndefined();
    expect(out.route.schedule).toEqual({ boarding: "16:05", departure: "16:35", arrival: "17:55", arrivalDayOffset: 0 });
    expect(out.route.fields).toEqual({ ff: "—" });
  });

  it("the airline + route rebuilds the original look: labels resolve, times render", () => {
    const merged = { ...out.airline, semantics: { ...out.airline.semantics, ...out.route.values, currentBoardingDate: "2026-10-12T16:05:00+08:00" } };
    merged.displayFields.auxiliary[0].value = "2026-10-12T16:05:00+08:00";
    const p = formStateToPassJson(merged).boardingPass;
    expect(p.primaryFields[0].label).toBe("MANILA NINOY AQUINO INTERNATIONAL");
    expect(p.auxiliaryFields[0].value).toBe("16:05");
  });

  it("decisions override suggestions; never mutates the source", () => {
    const src = design(), snap = structuredClone(src);
    const b = bindingsOf(src), p = planConversion(src, b);
    const o = applyConversion(src, b, p, { "label:depart": "airline", "time:boarding": "airline", "wifi:0": "airline", "field:ff": "drop" });
    expect(o.airline.displayFields.primary[0].label).toBe("MANILA NINOY AQUINO INTL");
    expect(o.airline.displayFields.auxiliary[0]).toEqual({ key: "boarding", label: "BOARDING", value: "16:05" });
    expect(o.airline.iOS26.wifi).toEqual([{ ssid: "CebPac-WiFi", password: "5J5056" }]);
    expect(o.route.fields).toEqual({});
    expect(o.bindings.currentBoardingDate).toBeUndefined();
    expect(src).toEqual(snap);
  });
});

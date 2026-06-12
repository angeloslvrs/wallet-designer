import { describe, it, expect } from "vitest";
import { applyStatus } from "../apps/server/src/routes/admin.js";
import { normalizeStatusBody } from "../apps/server/src/template-status.js";

const baseState = () => ({
  flight: { departure: { gate: "A1" }, arrival: {} },
  passenger: { name: "ADA LOVELACE" }
});

describe("applyStatus (FormState twin of the template status mapping)", () => {
  it("maps transitStatus + reason onto iOS26 and a visible status row with a change banner", () => {
    const next = applyStatus(baseState(), { transitStatus: "Delayed", transitStatusReason: "crew availability" });
    expect(next.iOS26.transitStatus).toBe("Delayed");
    expect(next.iOS26.transitStatusReason).toBe("crew availability");
    expect(next.iOS26.additionalInfoFields).toEqual([
      { key: "status", label: "STATUS", value: "Delayed — crew availability", changeMessage: "%@" }
    ]);
  });

  it("clears the status row and both iOS26 values with empty strings", () => {
    const set = applyStatus(baseState(), { transitStatus: "Cancelled", transitStatusReason: "aircraft fault" });
    const next = applyStatus(set, { transitStatus: "", transitStatusReason: "" });
    expect(next.iOS26.transitStatus).toBeUndefined();
    expect(next.iOS26.transitStatusReason).toBeUndefined();
    expect(next.iOS26.additionalInfoFields).toEqual([]);
  });

  it("keeps the delay row independent of the status row", () => {
    const next = applyStatus(baseState(), { delayed: "45 min", transitStatus: "Delayed" });
    expect(next.iOS26.additionalInfoFields.map(f => f.key).sort()).toEqual(["delay", "status"]);
  });

  it("normalizes the {value, changeMessage} object form to the plain value (FormState fields are scalars)", () => {
    const next = applyStatus(baseState(), { departureGate: { value: "B12", changeMessage: "Gate changed to %@" } });
    expect(next.flight.departure.gate).toBe("B12");
  });

  it("does not mutate the input state", () => {
    const input = baseState();
    applyStatus(input, { departureGate: "B12", transitStatus: "Delayed" });
    expect(input.flight.departure.gate).toBe("A1");
    expect(input.iOS26).toBeUndefined();
  });

  it("maps the semantic schedule keys onto the FormState schedule paths", () => {
    const next = applyStatus(baseState(), {
      departureGate: "C3",
      currentBoardingDate: "2026-06-20T07:30:00-07:00",
      currentDepartureDate: "2026-06-20T08:00:00-07:00",
      currentArrivalDate: "2026-06-20T16:45:00-04:00",
      transitProvider: "Train to Concourse B"
    });
    expect(next.flight.departure.gate).toBe("C3");
    expect(next.flight.departure.boarding).toBe("2026-06-20T07:30:00-07:00");
    expect(next.flight.departure.depart).toBe("2026-06-20T08:00:00-07:00");
    expect(next.flight.arrival.arrive).toBe("2026-06-20T16:45:00-04:00");
    expect(next.iOS26.transitInfo).toBe("Train to Concourse B");
  });
});

describe("normalizeStatusBody (route-layer back-compat aliases)", () => {
  it("renames the legacy verbs to semantic keys", () => {
    expect(normalizeStatusBody({
      gate: "B12", boarding: "b", depart: "d", arrive: "a", transitInfo: "t", delayed: "45 min"
    })).toEqual({
      departureGate: "B12", currentBoardingDate: "b", currentDepartureDate: "d",
      currentArrivalDate: "a", transitProvider: "t", delayed: "45 min"
    });
  });

  it("lets a semantic key win over its alias in the same body", () => {
    expect(normalizeStatusBody({ gate: "OLD", departureGate: "NEW" })).toEqual({ departureGate: "NEW" });
  });

  it("passes semantic-only bodies through untouched", () => {
    const body = { departureGate: "B12", transitStatus: "Delayed" };
    expect(normalizeStatusBody(body)).toEqual(body);
  });
});

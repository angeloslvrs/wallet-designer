import { describe, it, expect } from "vitest";
import { applyStatus } from "../apps/server/src/routes/admin.js";
import { normalizeStatusBody } from "../apps/server/src/template-status.js";

const baseState = () => ({ semantics: { departureGate: "A1" }, displayFields: {} });

describe("applyStatus (FormState, semantics-first)", () => {
  it("maps transitStatus + reason onto semantics and a visible status row with a change banner", () => {
    const next = applyStatus(baseState(), { transitStatus: "Delayed", transitStatusReason: "crew availability" });
    expect(next.semantics.transitStatus).toBe("Delayed");
    expect(next.semantics.transitStatusReason).toBe("crew availability");
    expect(next.iOS26.additionalInfoFields).toEqual([
      { key: "status", label: "STATUS", value: "Delayed — crew availability", changeMessage: "%@" }
    ]);
  });

  it("clears the status row and both semantics with empty strings", () => {
    const set = applyStatus(baseState(), { transitStatus: "Cancelled", transitStatusReason: "aircraft fault" });
    const next = applyStatus(set, { transitStatus: "", transitStatusReason: "" });
    expect(next.semantics.transitStatus).toBeUndefined();
    expect(next.semantics.transitStatusReason).toBeUndefined();
    expect(next.iOS26.additionalInfoFields).toEqual([]);
  });

  it("keeps the delay row independent of the status row", () => {
    const next = applyStatus(baseState(), { delayed: "45 min", transitStatus: "Delayed" });
    expect(next.iOS26.additionalInfoFields.map(f => f.key).sort()).toEqual(["delay", "status"]);
  });

  it("normalizes the {value, changeMessage} object form to the plain value", () => {
    const next = applyStatus(baseState(), { departureGate: { value: "B12", changeMessage: "Gate changed to %@" } });
    expect(next.semantics.departureGate).toBe("B12");
  });

  it("does not mutate the input state", () => {
    const input = baseState();
    applyStatus(input, { departureGate: "B12", transitStatus: "Delayed" });
    expect(input.semantics.departureGate).toBe("A1");
    expect(input.iOS26).toBeUndefined();
  });

  it("maps the semantic schedule keys onto semantics", () => {
    const next = applyStatus(baseState(), {
      departureGate: "C3",
      currentBoardingDate: "2026-06-20T07:30:00-07:00",
      currentDepartureDate: "2026-06-20T08:00:00-07:00",
      currentArrivalDate: "2026-06-20T16:45:00-04:00",
      transitProvider: "Train to Concourse B"
    });
    expect(next.semantics.departureGate).toBe("C3");
    expect(next.semantics.currentBoardingDate).toBe("2026-06-20T07:30:00-07:00");
    expect(next.semantics.currentDepartureDate).toBe("2026-06-20T08:00:00-07:00");
    expect(next.semantics.currentArrivalDate).toBe("2026-06-20T16:45:00-04:00");
    expect(next.semantics.transitProvider).toBe("Train to Concourse B");
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

import { describe, it, expect } from "vitest";
import { applyStatus } from "../apps/server/src/routes/admin.js";

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
    const next = applyStatus(baseState(), { gate: { value: "B12", changeMessage: "Gate changed to %@" } });
    expect(next.flight.departure.gate).toBe("B12");
  });

  it("does not mutate the input state", () => {
    const input = baseState();
    applyStatus(input, { gate: "B12", transitStatus: "Delayed" });
    expect(input.flight.departure.gate).toBe("A1");
    expect(input.iOS26).toBeUndefined();
  });
});

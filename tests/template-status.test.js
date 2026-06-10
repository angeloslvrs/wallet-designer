import { describe, it, expect } from "vitest";
import { applyStatusToTemplateData } from "../apps/server/src/template-status.js";

const KEYS = ["gate", "seat", "passenger", "flight", "boarding", "depart-time"];

describe("applyStatusToTemplateData", () => {
  it("maps gate onto the gate field and semantics.departureGate", () => {
    const { data, skipped } = applyStatusToTemplateData({}, { gate: "B12" }, KEYS);
    expect(data.gate).toBe("B12");
    expect(data.semantics.departureGate).toBe("B12");
    expect(skipped).toEqual([]);
  });

  it("still updates semantics when the template lacks the field key, and reports the skip", () => {
    const { data, skipped } = applyStatusToTemplateData({}, { gate: "B12" }, ["seat"]);
    expect(data.gate).toBeUndefined();
    expect(data.semantics.departureGate).toBe("B12");
    expect(skipped).toEqual(["gate"]);
  });

  it("maps the schedule fields onto fields + current* semantics", () => {
    const { data } = applyStatusToTemplateData({}, {
      boarding: "2026-06-01T07:30:00-07:00",
      depart: "2026-06-01T08:15:00-07:00",
      arrive: "2026-06-01T16:45:00-04:00"
    }, KEYS);
    expect(data.boarding).toBe("2026-06-01T07:30:00-07:00");
    expect(data["depart-time"]).toBe("2026-06-01T08:15:00-07:00");
    expect(data.semantics.currentBoardingDate).toBe("2026-06-01T07:30:00-07:00");
    expect(data.semantics.currentDepartureDate).toBe("2026-06-01T08:15:00-07:00");
    expect(data.semantics.currentArrivalDate).toBe("2026-06-01T16:45:00-04:00");
  });

  it("maps transitInfo and securityScreening onto semantics only", () => {
    const { data, skipped } = applyStatusToTemplateData({}, {
      transitInfo: "Train to Concourse B", securityScreening: "TSA PreCheck"
    }, KEYS);
    expect(data.semantics.transitProvider).toBe("Train to Concourse B");
    expect(data.semantics.securityScreening).toBe("TSA PreCheck");
    expect(skipped).toEqual([]);
  });

  it("adds a delay additionalInfoField and clears it again with an empty string", () => {
    const delayed = applyStatusToTemplateData({}, { delayed: "45 min" }, KEYS);
    expect(delayed.data.additionalInfoFields).toEqual([{ key: "delay", label: "DELAY", value: "45 min" }]);
    const cleared = applyStatusToTemplateData(delayed.data, { delayed: "" }, KEYS);
    expect(cleared.data.additionalInfoFields).toEqual([]);
  });

  it("preserves the object form of existing field data (changeMessage survives a gate update)", () => {
    const existing = { gate: { value: "A1", changeMessage: "Gate changed to %@" } };
    const { data } = applyStatusToTemplateData(existing, { gate: "B12" }, KEYS);
    expect(data.gate).toEqual({ value: "B12", changeMessage: "Gate changed to %@" });
  });

  it("does not mutate the input data", () => {
    const input = { gate: "A1", semantics: { departureGate: "A1" } };
    applyStatusToTemplateData(input, { gate: "B12" }, KEYS);
    expect(input.gate).toBe("A1");
    expect(input.semantics.departureGate).toBe("A1");
  });

  it("returns the data unchanged for an empty body", () => {
    const input = { gate: "A1" };
    const { data, skipped } = applyStatusToTemplateData(input, {}, KEYS);
    expect(data).toEqual(input);
    expect(skipped).toEqual([]);
  });
});

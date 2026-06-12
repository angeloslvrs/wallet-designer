import { describe, it, expect } from "vitest";
import { applyStatusToTemplateData, deriveIssueSemantics } from "../apps/server/src/template-status.js";

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

describe("applyStatusToTemplateData — transit status", () => {
  it("maps transitStatus + reason onto semantics and a visible status row with a change banner", () => {
    const { data, skipped } = applyStatusToTemplateData({}, {
      transitStatus: "Delayed", transitStatusReason: "crew availability"
    }, KEYS);
    expect(data.semantics.transitStatus).toBe("Delayed");
    expect(data.semantics.transitStatusReason).toBe("crew availability");
    expect(data.additionalInfoFields).toEqual([
      { key: "status", label: "STATUS", value: "Delayed — crew availability", changeMessage: "%@" }
    ]);
    expect(skipped).toEqual([]);
  });

  it("composes a reason-only update with the stored transitStatus", () => {
    const first = applyStatusToTemplateData({}, { transitStatus: "Delayed" }, KEYS);
    const { data } = applyStatusToTemplateData(first.data, { transitStatusReason: "weather at JFK" }, KEYS);
    expect(data.semantics.transitStatus).toBe("Delayed");
    expect(data.additionalInfoFields).toEqual([
      { key: "status", label: "STATUS", value: "Delayed — weather at JFK", changeMessage: "%@" }
    ]);
  });

  it("clears the status row and both semantics with empty strings", () => {
    const set = applyStatusToTemplateData({}, { transitStatus: "Cancelled", transitStatusReason: "aircraft fault" }, KEYS);
    const { data } = applyStatusToTemplateData(set.data, { transitStatus: "", transitStatusReason: "" }, KEYS);
    expect(data.semantics.transitStatus).toBeUndefined();
    expect(data.semantics.transitStatusReason).toBeUndefined();
    expect(data.additionalInfoFields).toEqual([]);
  });

  it("keeps the delay row independent of the status row", () => {
    const { data } = applyStatusToTemplateData({}, { delayed: "45 min", transitStatus: "Delayed" }, KEYS);
    expect(data.additionalInfoFields.map(f => f.key).sort()).toEqual(["delay", "status"]);
  });
});

describe("applyStatusToTemplateData — per-field changeMessage", () => {
  it("accepts {value, changeMessage} for a visible field and uses the value for semantics", () => {
    const { data } = applyStatusToTemplateData({}, {
      gate: { value: "B12", changeMessage: "Gate changed to %@" }
    }, KEYS);
    expect(data.gate).toEqual({ value: "B12", changeMessage: "Gate changed to %@" });
    expect(data.semantics.departureGate).toBe("B12");
  });

  it("skips undeclared keys for object-form values but still updates semantics", () => {
    const { data, skipped } = applyStatusToTemplateData({}, {
      gate: { value: "B12", changeMessage: "Gate changed to %@" }
    }, ["seat"]);
    expect(data.gate).toBeUndefined();
    expect(data.semantics.departureGate).toBe("B12");
    expect(skipped).toEqual(["gate"]);
  });
});

describe("deriveIssueSemantics", () => {
  it("maps per-passenger field data onto pass semantics", () => {
    const out = deriveIssueSemantics({
      passenger: "Ada Lovelace", seat: "14F", gate: "B7",
      confirmation: "GHK2X9", "fare-class": "Y", priority: "Gold"
    }, { seats: [{ seatNumber: "12A", seatType: "economy" }] });
    expect(out).toEqual({
      passengerName: { givenName: "Ada", familyName: "Lovelace" },
      seats: [{ seatNumber: "14F", seatRow: "14", seatSection: "F", seatType: "economy" }],
      departureGate: "B7",
      confirmationNumber: "GHK2X9",
      ticketFareClass: "Y",
      priorityStatus: "Gold"
    });
  });

  it("derives seat row/section from the seat number only, omitting them when unparseable", () => {
    expect(deriveIssueSemantics({ seat: "UPPER DECK" }, {}).seats).toEqual([{ seatNumber: "UPPER DECK" }]);
    expect(deriveIssueSemantics({ seat: "38k" }, {}).seats).toEqual([{ seatNumber: "38k", seatRow: "38", seatSection: "K" }]);
  });

  it("takes the value from object-form data and ignores unmapped keys", () => {
    const out = deriveIssueSemantics({ gate: { value: "C3", changeMessage: "Gate %@" }, ff: "RP-123" }, {});
    expect(out).toEqual({ departureGate: "C3" });
  });

  it("returns an empty object for empty data", () => {
    expect(deriveIssueSemantics({}, {})).toEqual({});
    expect(deriveIssueSemantics(undefined, undefined)).toEqual({});
  });
});

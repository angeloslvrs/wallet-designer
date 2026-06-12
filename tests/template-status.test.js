import { describe, it, expect } from "vitest";
import { applyStatusToTemplateData, deriveIssueSemantics } from "../apps/server/src/template-status.js";

// A binding map like discovery would produce for a dev-sample-shaped template.
// Field keys here are arbitrary template vocabulary — the point of the map.
const BINDINGS = {
  departureGate: { fieldKey: "gate", source: "value-match", confidence: "medium" },
  currentBoardingDate: { fieldKey: "boarding", source: "date-proximity", confidence: "medium" },
  currentDepartureDate: { fieldKey: "depart-time", source: "date-proximity", confidence: "medium" },
  passengerName: { fieldKey: "passenger", source: "name-match", confidence: "medium" },
  seats: { fieldKey: "seat", source: "seat-composite", confidence: "medium" },
  confirmationNumber: { fieldKey: "confirmation", source: "value-match", confidence: "medium" },
  ticketFareClass: { fieldKey: "fare-class", source: "value-match", confidence: "medium" },
  priorityStatus: { fieldKey: "priority", source: "value-match", confidence: "medium" }
};

describe("applyStatusToTemplateData (semantic vocabulary, map-driven)", () => {
  it("maps departureGate onto the bound field and semantics", () => {
    const { data, skipped } = applyStatusToTemplateData({}, { departureGate: "B12" }, BINDINGS);
    expect(data.gate).toBe("B12");
    expect(data.semantics.departureGate).toBe("B12");
    expect(skipped).toEqual([]);
  });

  it("still updates semantics when the semantic has no bound field, and reports the skip", () => {
    const { data, skipped } = applyStatusToTemplateData({}, { departureGate: "B12" }, {});
    expect(data.gate).toBeUndefined();
    expect(data.semantics.departureGate).toBe("B12");
    expect(skipped).toEqual(["departureGate"]);
  });

  it("maps the schedule semantics onto bound fields + semantics", () => {
    const { data } = applyStatusToTemplateData({}, {
      currentBoardingDate: "2026-06-01T07:30:00-07:00",
      currentDepartureDate: "2026-06-01T08:15:00-07:00",
      currentArrivalDate: "2026-06-01T16:45:00-04:00"
    }, BINDINGS);
    expect(data.boarding).toBe("2026-06-01T07:30:00-07:00");
    expect(data["depart-time"]).toBe("2026-06-01T08:15:00-07:00");
    expect(data.semantics.currentBoardingDate).toBe("2026-06-01T07:30:00-07:00");
    expect(data.semantics.currentDepartureDate).toBe("2026-06-01T08:15:00-07:00");
    expect(data.semantics.currentArrivalDate).toBe("2026-06-01T16:45:00-04:00");
  });

  it("rejects a date semantic whose value is not ISO 8601", () => {
    expect(() => applyStatusToTemplateData({}, { currentBoardingDate: "half past seven" }, BINDINGS))
      .toThrow(/ISO 8601/);
  });

  it("ignores the raw legacy verbs (route layer normalizes them first)", () => {
    const { data } = applyStatusToTemplateData({}, { gate: "B12" }, BINDINGS);
    expect(data.gate).toBeUndefined();
    expect(data.semantics?.gate).toBeUndefined();
  });

  it("writes unbound day-of-travel semantics and reports them as skipped (informational)", () => {
    const { data, skipped } = applyStatusToTemplateData({}, {
      transitProvider: "Train to Concourse B", securityScreening: "TSA PreCheck"
    }, BINDINGS);
    expect(data.semantics.transitProvider).toBe("Train to Concourse B");
    expect(data.semantics.securityScreening).toBe("TSA PreCheck");
    expect(skipped.sort()).toEqual(["securityScreening", "transitProvider"]);
  });

  it("adds a delay additionalInfoField and clears it again with an empty string", () => {
    const delayed = applyStatusToTemplateData({}, { delayed: "45 min" }, BINDINGS);
    expect(delayed.data.additionalInfoFields).toEqual([{ key: "delay", label: "DELAY", value: "45 min" }]);
    const cleared = applyStatusToTemplateData(delayed.data, { delayed: "" }, BINDINGS);
    expect(cleared.data.additionalInfoFields).toEqual([]);
  });

  it("preserves the object form of existing field data (changeMessage survives a gate update)", () => {
    const existing = { gate: { value: "A1", changeMessage: "Gate changed to %@" } };
    const { data } = applyStatusToTemplateData(existing, { departureGate: "B12" }, BINDINGS);
    expect(data.gate).toEqual({ value: "B12", changeMessage: "Gate changed to %@" });
  });

  it("does not mutate the input data", () => {
    const input = { gate: "A1", semantics: { departureGate: "A1" } };
    applyStatusToTemplateData(input, { departureGate: "B12" }, BINDINGS);
    expect(input.gate).toBe("A1");
    expect(input.semantics.departureGate).toBe("A1");
  });

  it("returns the data unchanged for an empty body", () => {
    const input = { gate: "A1" };
    const { data, skipped } = applyStatusToTemplateData(input, {}, BINDINGS);
    expect(data).toEqual(input);
    expect(skipped).toEqual([]);
  });
});

describe("applyStatusToTemplateData — transit status", () => {
  it("maps transitStatus + reason onto semantics and a visible status row with a change banner", () => {
    const { data, skipped } = applyStatusToTemplateData({}, {
      transitStatus: "Delayed", transitStatusReason: "crew availability"
    }, BINDINGS);
    expect(data.semantics.transitStatus).toBe("Delayed");
    expect(data.semantics.transitStatusReason).toBe("crew availability");
    expect(data.additionalInfoFields).toEqual([
      { key: "status", label: "STATUS", value: "Delayed — crew availability", changeMessage: "%@" }
    ]);
    expect(skipped).toEqual([]);
  });

  it("composes a reason-only update with the stored transitStatus", () => {
    const first = applyStatusToTemplateData({}, { transitStatus: "Delayed" }, BINDINGS);
    const { data } = applyStatusToTemplateData(first.data, { transitStatusReason: "weather at JFK" }, BINDINGS);
    expect(data.semantics.transitStatus).toBe("Delayed");
    expect(data.additionalInfoFields).toEqual([
      { key: "status", label: "STATUS", value: "Delayed — weather at JFK", changeMessage: "%@" }
    ]);
  });

  it("clears the status row and both semantics with empty strings", () => {
    const set = applyStatusToTemplateData({}, { transitStatus: "Cancelled", transitStatusReason: "aircraft fault" }, BINDINGS);
    const { data } = applyStatusToTemplateData(set.data, { transitStatus: "", transitStatusReason: "" }, BINDINGS);
    expect(data.semantics.transitStatus).toBeUndefined();
    expect(data.semantics.transitStatusReason).toBeUndefined();
    expect(data.additionalInfoFields).toEqual([]);
  });

  it("keeps the delay row independent of the status row", () => {
    const { data } = applyStatusToTemplateData({}, { delayed: "45 min", transitStatus: "Delayed" }, BINDINGS);
    expect(data.additionalInfoFields.map(f => f.key).sort()).toEqual(["delay", "status"]);
  });
});

describe("applyStatusToTemplateData — per-field changeMessage", () => {
  it("accepts {value, changeMessage} for a bound field and uses the value for semantics", () => {
    const { data } = applyStatusToTemplateData({}, {
      departureGate: { value: "B12", changeMessage: "Gate changed to %@" }
    }, BINDINGS);
    expect(data.gate).toEqual({ value: "B12", changeMessage: "Gate changed to %@" });
    expect(data.semantics.departureGate).toBe("B12");
  });

  it("skips unbound semantics for object-form values but still updates semantics", () => {
    const { data, skipped } = applyStatusToTemplateData({}, {
      departureGate: { value: "B12", changeMessage: "Gate changed to %@" }
    }, {});
    expect(data.gate).toBeUndefined();
    expect(data.semantics.departureGate).toBe("B12");
    expect(skipped).toEqual(["departureGate"]);
  });
});

describe("deriveIssueSemantics (map-driven)", () => {
  it("translates per-passenger field data into pass semantics through the binding map", () => {
    const out = deriveIssueSemantics({
      passenger: "Ada Lovelace", seat: "14F", gate: "B7",
      confirmation: "GHK2X9", "fare-class": "Y", priority: "Gold"
    }, BINDINGS, { seats: [{ seatNumber: "A", seatRow: "12", seatType: "economy" }] });
    expect(out).toEqual({
      passengerName: { givenName: "Ada", familyName: "Lovelace" },
      seats: [{ seatRow: "14", seatNumber: "F", seatType: "economy" }],
      departureGate: "B7",
      confirmationNumber: "GHK2X9",
      ticketFareClass: "Y",
      priorityStatus: "Gold"
    });
  });

  it("decomposes the seat composite into seatRow + seatNumber, keeping unsplittable composites whole", () => {
    expect(deriveIssueSemantics({ seat: "UPPER DECK" }, BINDINGS).seats).toEqual([{ seatNumber: "UPPER DECK" }]);
    expect(deriveIssueSemantics({ seat: "38k" }, BINDINGS).seats).toEqual([{ seatRow: "38", seatNumber: "K" }]);
  });

  it("splits SURNAME/GIVEN passenger values on the slash", () => {
    expect(deriveIssueSemantics({ passenger: "DELA CRUZ/JUAN" }, BINDINGS).passengerName)
      .toEqual({ givenName: "JUAN", familyName: "DELA CRUZ" });
  });

  it("populates BOTH the current* and original* pair from a bound date input", () => {
    const out = deriveIssueSemantics({ boarding: "2026-06-20T07:30:00+08:00" }, BINDINGS);
    expect(out.currentBoardingDate).toBe("2026-06-20T07:30:00+08:00");
    expect(out.originalBoardingDate).toBe("2026-06-20T07:30:00+08:00");
  });

  it("rejects a non-ISO value for a date-bound field", () => {
    expect(() => deriveIssueSemantics({ boarding: "early morning" }, BINDINGS)).toThrow(/ISO 8601/);
  });

  it("takes the value from object-form data and ignores unbound keys", () => {
    const out = deriveIssueSemantics({ gate: { value: "C3", changeMessage: "Gate %@" }, ff: "RP-123" }, BINDINGS);
    expect(out).toEqual({ departureGate: "C3" });
  });

  it("returns an empty object for empty data or an empty binding map", () => {
    expect(deriveIssueSemantics({}, BINDINGS)).toEqual({});
    expect(deriveIssueSemantics({ passenger: "Ada" }, {})).toEqual({});
    expect(deriveIssueSemantics(undefined, undefined)).toEqual({});
  });
});

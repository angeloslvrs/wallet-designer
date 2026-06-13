import { describe, it, expect } from "vitest";
import { mergeTripValues, defaultIndividualKeys } from "../apps/designer/src/issue.js";

describe("mergeTripValues", () => {
  it("takes shared keys from the trip and individual keys from the row", () => {
    const shared = { gate: "B12", terminal: "2" };
    const row = { name: "ALICE", seat: "14A" };
    expect(mergeTripValues(shared, row, ["name", "seat"]))
      .toEqual({ gate: "B12", terminal: "2", name: "ALICE", seat: "14A" });
  });

  it("omits an individual key the row has not provided (template default applies)", () => {
    expect(mergeTripValues({ gate: "B12" }, {}, ["name"])).toEqual({ gate: "B12" });
  });

  it("never leaks a shared value for a key that is individual", () => {
    // 'name' is individual but only present in shared (stale) — must not appear.
    expect(mergeTripValues({ name: "STALE", gate: "B12" }, {}, ["name"])).toEqual({ gate: "B12" });
  });

  it("lets the row override even when shared also has the individual key", () => {
    expect(mergeTripValues({ name: "STALE", gate: "B12" }, { name: "BOB" }, ["name"]))
      .toEqual({ gate: "B12", name: "BOB" });
  });

  it("accepts a Set or an array of individual keys", () => {
    expect(mergeTripValues({ a: "1" }, { b: "2" }, new Set(["b"]))).toEqual({ a: "1", b: "2" });
  });

  it("is empty when nothing is provided", () => {
    expect(mergeTripValues()).toEqual({});
  });
});

describe("defaultIndividualKeys", () => {
  it("returns field keys bound to per-passenger semantics, ignoring shared ones", () => {
    const bindings = {
      passengerName: { fieldKey: "pax" },
      seats: { fieldKey: "seat" },
      boardingSequenceNumber: { fieldKey: "seq" },
      departureGate: { fieldKey: "gate" },
      departureTerminal: { fieldKey: "term" },
    };
    expect(new Set(defaultIndividualKeys(bindings))).toEqual(new Set(["pax", "seat", "seq"]));
  });

  it("returns empty when there are no bindings", () => {
    expect(defaultIndividualKeys()).toEqual([]);
    expect(defaultIndividualKeys({})).toEqual([]);
  });

  it("ignores per-passenger semantics that are not bound to a field", () => {
    expect(defaultIndividualKeys({ passengerName: { fieldKey: "pax" } })).toEqual(["pax"]);
  });
});

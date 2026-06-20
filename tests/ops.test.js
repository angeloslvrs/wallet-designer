import { describe, it, expect } from "vitest";
import { buildStatusBody, describePushResult, validateStatusValues } from "../apps/designer/src/ops.js";

describe("buildStatusBody", () => {
  it("keeps only non-empty trimmed fields", () => {
    expect(buildStatusBody({
      gate: " B7 ", boarding: "", depart: "  ", arrive: "2026-06-20T16:45:00-04:00",
      transitInfo: "", securityScreening: "", delayed: ""
    })).toEqual({ gate: "B7", arrive: "2026-06-20T16:45:00-04:00" });
  });

  it("returns null when nothing was entered", () => {
    expect(buildStatusBody({ gate: "", delayed: " " })).toBeNull();
    expect(buildStatusBody({})).toBeNull();
  });

  it("passes a delay note through", () => {
    expect(buildStatusBody({ delayed: "ATC delay — new boarding 06:30" }))
      .toEqual({ delayed: "ATC delay — new boarding 06:30" });
  });
});

describe("describePushResult", () => {
  it("describes an error response", () => {
    expect(describePushResult({ error: "no passes in this group" }))
      .toBe("✗ no passes in this group");
    expect(describePushResult({})).toBe("✗ error");
  });

  it("describes a single-pass push", () => {
    expect(describePushResult({ ok: true, push: { sent: 2, mode: "apns" } }))
      .toBe("✓ pushed 2 device(s)");
  });

  it("notes the semantics that updated but aren't shown on the pass face", () => {
    expect(describePushResult({ ok: true, push: { sent: 1 }, skippedFields: ["gate", "boarding"] }))
      .toBe("✓ pushed 1 device(s) · not on pass face: gate, boarding");
  });

  it("describes a group push, aggregating skipped keys across members", () => {
    const j = {
      ok: true, count: 3, sent: 5,
      results: [
        { serial: "A", push: { sent: 2 } },
        { serial: "B", push: { sent: 2 }, skippedFields: ["gate"] },
        { serial: "C", push: { sent: 1 }, skippedFields: ["gate", "boarding"] }
      ]
    };
    expect(describePushResult(j))
      .toBe("✓ 3 pass(es), 5 device(s) · not on pass face: gate, boarding");
  });

  it("describes a group push with no skips", () => {
    expect(describePushResult({ ok: true, count: 2, results: [
      { serial: "A", push: { sent: 2 } },
      { serial: "B", push: { sent: 2 } }
    ] })).toBe("✓ 2 pass(es), 4 device(s)");
  });

  it("surfaces failed and 410-pruned devices for a single pass", () => {
    expect(describePushResult({
      ok: true,
      push: { sent: 1, failures: [{ token: "x", status: 400 }], unregistered: [{ pushToken: "y" }] }
    })).toBe("✓ pushed 1 device(s) · ⚠ 1 failed · pruned 1 stale");
  });

  it("aggregates failed/pruned across a group push", () => {
    expect(describePushResult({ ok: true, count: 2, results: [
      { serial: "A", push: { sent: 1, failures: [{ token: "x" }], unregistered: [] } },
      { serial: "B", push: { sent: 0, failures: [], unregistered: [{ pushToken: "y" }] } }
    ] })).toBe("✓ 2 pass(es), 1 device(s) · ⚠ 1 failed · pruned 1 stale");
  });
});

describe("validateStatusValues", () => {
  it("flags a non-ISO date field by its semantic kind", () => {
    const errs = validateStatusValues({ currentBoardingDate: "soon", departureGate: "B7" });
    expect(errs.currentBoardingDate).toMatch(/date/i);
    expect(errs.departureGate).toBeUndefined();
  });

  it("is empty when every field is valid or blank", () => {
    expect(validateStatusValues({
      currentBoardingDate: "2026-06-20T07:30:00-07:00", departureGate: "B7", delayed: ""
    })).toEqual({});
  });

  it("does not constrain free-text status fields", () => {
    expect(validateStatusValues({ transitStatus: "Delayed", transitStatusReason: "crew availability" })).toEqual({});
  });
});

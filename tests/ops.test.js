import { describe, it, expect } from "vitest";
import { buildStatusBody, describePushResult } from "../apps/designer/src/ops.js";

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

  it("notes the field keys a template pass skipped", () => {
    expect(describePushResult({ ok: true, push: { sent: 1 }, skippedFields: ["gate", "boarding"] }))
      .toBe("✓ pushed 1 device(s) · template lacks: gate, boarding");
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
      .toBe("✓ 3 pass(es), 5 device(s) · template lacks: gate, boarding");
  });

  it("describes a group push with no skips", () => {
    expect(describePushResult({ ok: true, count: 2, sent: 4, results: [] }))
      .toBe("✓ 2 pass(es), 4 device(s)");
  });
});

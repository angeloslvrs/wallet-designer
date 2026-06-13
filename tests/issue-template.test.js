import { describe, it, expect } from "vitest";
import { composeGroupId, suggestSerial, buildIssueRequest, describeIssueResult } from "../apps/designer/src/issue.js";

describe("composeGroupId", () => {
  it("composes FLIGHT@YYYY-MM-DD from flight code and date", () => {
    expect(composeGroupId("RP247", "2026-06-20")).toBe("RP247@2026-06-20");
  });

  it("trims and uppercases the flight code", () => {
    expect(composeGroupId("  rp247 ", "2026-06-20")).toBe("RP247@2026-06-20");
  });

  it("returns empty string when either piece is missing", () => {
    expect(composeGroupId("", "2026-06-20")).toBe("");
    expect(composeGroupId("RP247", "")).toBe("");
    expect(composeGroupId("  ", "  ")).toBe("");
  });
});

describe("suggestSerial", () => {
  it("suggests <groupId>-<NNN>, 1-based and zero-padded", () => {
    expect(suggestSerial("RP247@2026-06-20", 1)).toBe("RP247@2026-06-20-001");
    expect(suggestSerial("RP247@2026-06-20", 12)).toBe("RP247@2026-06-20-012");
  });

  it("suggests nothing without a groupId", () => {
    expect(suggestSerial("", 1)).toBe("");
    expect(suggestSerial("   ", 3)).toBe("");
  });
});

describe("buildIssueRequest", () => {
  it("maps the form to the POST /api/passes template body", () => {
    expect(buildIssueRequest({
      template: "dev-sample",
      groupId: " RP247@2026-06-20 ",
      serial: " RP247@2026-06-20-001 ",
      values: { passenger: "Ada Lovelace", seat: "12A", gate: "" }
    })).toEqual({
      template: "dev-sample",
      serialNumber: "RP247@2026-06-20-001",
      groupId: "RP247@2026-06-20",
      data: { passenger: "Ada Lovelace", seat: "12A" }
    });
  });

  it("drops empty and whitespace-only values from data", () => {
    const req = buildIssueRequest({
      template: "dev-sample", groupId: "G", serial: "G-001",
      values: { passenger: "  Bob  ", seat: "   ", gate: "" }
    });
    expect(req.data).toEqual({ passenger: "Bob" });
  });

  it("sends an empty data object when nothing was filled in", () => {
    const req = buildIssueRequest({ template: "dev-sample", groupId: "G", serial: "G-001", values: {} });
    expect(req.data).toEqual({});
  });

  it("includes a filled semantics object and drops empty semantic values", () => {
    const req = buildIssueRequest({
      template: "cebpac", groupId: "5J@2026-06-13", serial: "X-1",
      values: { gate: "B7", term: "" },
      semantics: { airlineCode: "5J", departureGate: "" }
    });
    expect(req).toEqual({
      template: "cebpac", serialNumber: "X-1", groupId: "5J@2026-06-13",
      data: { gate: "B7", semantics: { airlineCode: "5J" } }
    });
  });
});

describe("describeIssueResult", () => {
  it("describes a successful issue", () => {
    expect(describeIssueResult(true, { serialNumber: "RP247@2026-06-20-001" }))
      .toBe("✓ issued");
  });

  it("surfaces the server error verbatim (unknown field keys)", () => {
    expect(describeIssueResult(false, { error: 'unknown field keys for template "dev-sample": gatez' }))
      .toBe('✗ unknown field keys for template "dev-sample": gatez');
  });

  it("falls back to a generic error when the body has none", () => {
    expect(describeIssueResult(false, {})).toBe("✗ error");
    expect(describeIssueResult(false, undefined)).toBe("✗ error");
  });
});

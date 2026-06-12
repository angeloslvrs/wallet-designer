import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";

// Issue-time semantics derivation: POST /api/passes with template data must
// store derived semantics (passengerName, seats, confirmationNumber, …) so
// template placeholder semantics never ship on an issued pass.
//
// storage.js resolves STATE_PATH at import time, so set the env before the
// dynamic imports below (same pattern as template-delete.test.js).
let handleTemplateUpload, issueTemplatePass, getPassRecord;

const PASS_JSON = JSON.stringify({
  formatVersion: 1,
  passTypeIdentifier: "pass.dev.placeholder",
  description: "Boarding pass",
  boardingPass: {
    headerFields: [{ key: "gate", label: "GATE", value: "—" }],
    secondaryFields: [{ key: "passenger", label: "PASSENGER", value: "FIRSTNAME LASTNAME" }],
    backFields: [
      { key: "confirmation", label: "CONFIRMATION", value: "—" },
      { key: "fare-class", label: "FARE CLASS", value: "—" },
      { key: "priority", label: "PRIORITY", value: "—" },
      { key: "seat", label: "SEAT", value: "—" }
    ]
  },
  semantics: {
    passengerName: { givenName: "FIRSTNAME", familyName: "LASTNAME" },
    seats: [{ seatNumber: "12A", seatType: "economy" }],
    confirmationNumber: "PLACEHOLDER"
  }
});

function zipOf(entries) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
}
function mkRes() {
  return {
    statusCode: 0, payload: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; }
  };
}

beforeAll(async () => {
  process.env.TEMPLATES_DIR = await mkdtemp(join(tmpdir(), "wpd-templates-iss-"));
  process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-state-iss-")), "passes.json");
  ({ handleTemplateUpload } = await import("../apps/server/src/routes/templates.js"));
  ({ issueTemplatePass } = await import("../apps/server/src/routes/admin.js"));
  ({ getPassRecord } = await import("../apps/server/src/storage.js"));

  const res = mkRes();
  await handleTemplateUpload(
    { params: { id: "iss" }, body: zipOf({ "pass.json": PASS_JSON, "icon.png": "x" }) }, res);
  expect(res.statusCode).toBe(201);
});

describe("issueTemplatePass — derived semantics", () => {
  it("stores semantics derived from per-passenger data so placeholders never ship", async () => {
    await issueTemplatePass({
      template: "iss", serialNumber: "ISS-001", groupId: "ISS@2026-07-01",
      data: { passenger: "Ada Lovelace", seat: "14F", confirmation: "GHK2X9", "fare-class": "Y", priority: "Gold" }
    });
    const rec = await getPassRecord("ISS-001");
    expect(rec.data.semantics).toEqual({
      passengerName: { givenName: "Ada", familyName: "Lovelace" },
      seats: [{ seatNumber: "14F", seatRow: "14", seatSection: "F", seatType: "economy" }],
      confirmationNumber: "GHK2X9",
      ticketFareClass: "Y",
      priorityStatus: "Gold"
    });
  });

  it("lets explicit data.semantics win over derived values", async () => {
    await issueTemplatePass({
      template: "iss", serialNumber: "ISS-002", groupId: "ISS@2026-07-01",
      data: {
        passenger: "Ada Lovelace",
        semantics: { passengerName: { givenName: "Augusta Ada", familyName: "King" } }
      }
    });
    const rec = await getPassRecord("ISS-002");
    expect(rec.data.semantics.passengerName).toEqual({ givenName: "Augusta Ada", familyName: "King" });
  });

  it("stores data without a semantics key when nothing is derivable", async () => {
    await issueTemplatePass({
      template: "iss", serialNumber: "ISS-003", groupId: "ISS@2026-07-01", data: {}
    });
    const rec = await getPassRecord("ISS-003");
    expect(rec.data.semantics).toBeUndefined();
  });
});

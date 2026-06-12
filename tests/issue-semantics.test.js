import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { applyTemplateData } from "../packages/pass-builder/template.js";

// Issue-time semantics derivation, map-driven: POST /api/passes with template
// data must store semantics translated through the template's discovered
// binding map, and must CLEAR (null → delete at merge) the template's
// volatile placeholder semantics (schedule dates, passengerName, seats) that
// nothing re-derives — placeholders never ship on an issued pass.
//
// storage.js resolves STATE_PATH at import time, so set the env before the
// dynamic imports below (same pattern as template-delete.test.js).
let handleTemplateUpload, issueTemplatePass, getPassRecord;

// Sample values mirror the semantics (the Pass Designer way), so binding
// discovery at upload time can propose the map this test relies on.
const PASS_JSON = JSON.stringify({
  formatVersion: 1,
  passTypeIdentifier: "pass.dev.placeholder",
  description: "Boarding pass",
  boardingPass: {
    headerFields: [
      { key: "gate", label: "GATE", value: "B7" },
      { key: "seat", label: "SEAT", value: "12A" }
    ],
    secondaryFields: [{ key: "passenger", label: "PASSENGER", value: "FIRSTNAME LASTNAME" }],
    auxiliaryFields: [
      { key: "boarding", label: "BOARDING", value: "2026-07-01T07:30:00-07:00", dateStyle: "PKDateStyleNone", timeStyle: "PKDateStyleShort" }
    ],
    backFields: [
      { key: "confirmation", label: "CONFIRMATION", value: "GHK2X9" },
      { key: "fare-class", label: "FARE CLASS", value: "Y" },
      { key: "priority", label: "PRIORITY", value: "Gold" }
    ]
  },
  semantics: {
    departureGate: "B7",
    passengerName: { givenName: "FIRSTNAME", familyName: "LASTNAME" },
    seats: [{ seatNumber: "A", seatRow: "12", seatType: "economy" }],
    originalBoardingDate: "2026-07-01T07:30:00-07:00",
    currentBoardingDate: "2026-07-01T07:30:00-07:00",
    confirmationNumber: "GHK2X9",
    ticketFareClass: "Y",
    priorityStatus: "Gold"
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

describe("issueTemplatePass — map-driven derived semantics", () => {
  it("stores semantics translated through the binding map, clearing un-derived volatile placeholders", async () => {
    await issueTemplatePass({
      template: "iss", serialNumber: "ISS-001", groupId: "ISS@2026-07-01",
      data: { passenger: "Ada Lovelace", seat: "14F", gate: "B9", confirmation: "ZZTOP1", "fare-class": "J", priority: "Platinum" }
    });
    const rec = await getPassRecord("ISS-001");
    expect(rec.data.semantics).toEqual({
      // boarding dates were not in the issue data → cleared (null deletes at merge)
      currentBoardingDate: null,
      originalBoardingDate: null,
      passengerName: { givenName: "Ada", familyName: "Lovelace" },
      seats: [{ seatRow: "14", seatNumber: "F", seatType: "economy" }],
      departureGate: "B9",
      confirmationNumber: "ZZTOP1",
      ticketFareClass: "J",
      priorityStatus: "Platinum"
    });
  });

  it("populates both date pairs from a bound date input", async () => {
    await issueTemplatePass({
      template: "iss", serialNumber: "ISS-004", groupId: "ISS@2026-07-01",
      data: { boarding: "2026-08-01T09:10:00+08:00" }
    });
    const rec = await getPassRecord("ISS-004");
    expect(rec.data.semantics.currentBoardingDate).toBe("2026-08-01T09:10:00+08:00");
    expect(rec.data.semantics.originalBoardingDate).toBe("2026-08-01T09:10:00+08:00");
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

  it("clears ALL volatile placeholders when nothing is derivable, and the merge deletes them", async () => {
    await issueTemplatePass({
      template: "iss", serialNumber: "ISS-003", groupId: "ISS@2026-07-01", data: {}
    });
    const rec = await getPassRecord("ISS-003");
    expect(rec.data.semantics).toEqual({
      currentBoardingDate: null, originalBoardingDate: null, passengerName: null, seats: null
    });
    const merged = applyTemplateData(JSON.parse(PASS_JSON), rec.data);
    expect(merged.semantics.passengerName).toBeUndefined();
    expect(merged.semantics.seats).toBeUndefined();
    expect(merged.semantics.currentBoardingDate).toBeUndefined();
    expect(merged.semantics.originalBoardingDate).toBeUndefined();
    // non-volatile template semantics survive untouched
    expect(merged.semantics.confirmationNumber).toBe("GHK2X9");
  });
});

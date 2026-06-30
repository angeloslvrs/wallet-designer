import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Defense in depth: issueTemplatePass (what POST /api/passes calls) must reject
// values that violate a field's descriptor kind, so a bad value can never ship
// even if the UI is bypassed. Validation derives from the template's
// bindings → semantics → kind, NOT from hardcoded field-key names. Proven
// against the real committed cebpac export.
let issueTemplatePass, getPassRecord;
let n = 0;
const nextSerial = () => `VAL-${++n}`;
const issue = (data, s = nextSerial()) =>
  issueTemplatePass({ template: "cebpac", serialNumber: s, groupId: "5J5056@2026-08-01", data });

beforeAll(async () => {
  process.env.TEMPLATES_DIR = "templates";
  process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-state-val-")), "passes.json");
  ({ issueTemplatePass } = await import("../apps/server/src/routes/admin.js"));
  ({ getPassRecord } = await import("../apps/server/src/storage.js"));
});

describe("issueTemplatePass — rejects malformed field values", () => {
  it("rejects a bad airport code (depart → departureAirportCode)", async () => {
    await expect(issue({ depart: "Manilla" })).rejects.toThrow(/depart.*3 letters/i);
  });

  it("rejects a non-numeric boarding sequence (sequence → boardingSequenceNumber)", async () => {
    await expect(issue({ sequence: "x" })).rejects.toThrow(/sequence.*number/i);
  });

  it("rejects a non-ISO date on a bound date field (date → currentDepartureDate)", async () => {
    await expect(issue({ date: "tomorrow" })).rejects.toThrow(/date/i);
  });

  it("rejects offset-less and calendar-invalid date values", async () => {
    await expect(issue({ date: "2026-08-01T10:00" })).rejects.toThrow(/date/i);
    await expect(issue({ date: "2026-02-30T10:00:00Z" })).rejects.toThrow(/date/i);
  });

  it("rejects strict-date failures in explicit semantics and expirationDate", async () => {
    await expect(issue({ semantics: { currentBoardingDate: "2026-08-01T09:10" } }))
      .rejects.toThrow(/semantics\.currentBoardingDate.*date/i);
    await expect(issue({ expirationDate: "2026-09-01T00:00" }))
      .rejects.toThrow(/expirationDate.*date/i);
  });

  it("accepts a valid lowercase airport code and stores it uppercased", async () => {
    const s = nextSerial();
    await issue({ depart: "mnl" }, s);
    const stored = await getPassRecord(s);
    expect(stored.data.depart).toBe("MNL");
  });

  it("accepts a fully valid set of fields", async () => {
    await expect(issue({
      depart: "MNL", arrive: "NRT", sequence: "12", seat: "23F", passenger: "DELA CRUZ/JUAN"
    })).resolves.toBeTruthy();
  });

  it("leaves empty optional fields alone (template default applies)", async () => {
    await expect(issue({ depart: "MNL", term: "" })).resolves.toBeTruthy();
  });
});

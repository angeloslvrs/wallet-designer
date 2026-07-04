import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// POST /api/passes must report whether it CREATED a new pass or OVERWROTE an
// existing one. Apple keys a pass by serialNumber + passTypeId, so re-posting a
// serial updates that pass rather than making a second one — `created:false`
// lets the issue UI surface that instead of a silent clobber. registerPass is
// the route's core (shape-agnostic create-or-update), unit-tested here against
// a temp store so no Express harness is needed.
let registerPass, getPassRecord, saveTemplatePass;
let n = 0;
const nextSerial = () => `CRT-${++n}`;
const issue = (serialNumber) =>
  registerPass({ template: "cebpac", serialNumber, groupId: "5J5057@2026-06-14", data: { depart: "MNL" } });

beforeAll(async () => {
  process.env.TEMPLATES_DIR = "templates";
  process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-state-crt-")), "passes.json");
  ({ registerPass } = await import("../apps/server/src/routes/admin.js"));
  ({ getPassRecord, saveTemplatePass } = await import("../apps/server/src/storage.js"));
});

describe("registerPass — created vs overwrite", () => {
  it("reports created:true for a brand-new serial", async () => {
    const res = await issue(nextSerial());
    expect(res.created).toBe(true);
  });

  it("reports created:false when re-posting an existing serial, and keeps the token stable", async () => {
    const serial = nextSerial();
    const first = await issue(serial);
    expect(first.created).toBe(true);
    const second = await issue(serial);
    expect(second.created).toBe(false);
    // Re-issue must NOT rotate the token (would 401 installed copies).
    expect(second.authenticationToken).toBe(first.authenticationToken);
    // Overwrite, not duplicate: still exactly one stored record for the serial.
    expect((await getPassRecord(serial))).toBeTruthy();
  });

  it("derives `created` from the write helper, not a separate read (single source)", async () => {
    // The store helper decides `created` atomically with the write; registerPass
    // just forwards it. Calling the helper directly must agree: true then false.
    const serial = nextSerial();
    const args = { serialNumber: serial, template: "cebpac", data: { depart: "MNL" }, groupId: "5J5057@2026-06-14" };
    const first = await saveTemplatePass(args);
    expect(first.created).toBe(true);
    const second = await saveTemplatePass(args);
    expect(second.created).toBe(false);
  });

  it("exactly one of two concurrent issues of the same new serial reports created", async () => {
    // The race the fix closes: a read-before-write in the route let both see
    // "absent" and both 201. With the flag sourced from the write helper, an
    // interleaved pair yields exactly one created:true.
    const serial = nextSerial();
    const [a, b] = await Promise.all([issue(serial), issue(serial)]);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect(await getPassRecord(serial)).toBeTruthy();
  });
});

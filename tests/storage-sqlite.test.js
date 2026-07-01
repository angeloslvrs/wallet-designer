import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

// SQLite persistence specifics: DB file siting, one-shot legacy-JSON import
// with a timestamped backup, import idempotency across boots, and token
// stability across re-issue + reboot. The storage API itself is covered by
// tests/template-storage.test.js, which must keep passing unmodified.

/** Fresh "boot": storage.js resolves STATE_PATH at import time. */
async function bootStorage(statePath) {
  vi.resetModules();
  process.env.STATE_PATH = statePath;
  return import("../apps/server/src/storage.js");
}

const LEGACY = {
  passes: {
    "RP1@2026-06-01-001": {
      passTypeIdentifier: "pass.dev.local",
      authenticationToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      groupId: "RP1@2026-06-01",
      template: "dev-sample",
      data: { passenger: "Ada Lovelace" },
      lastModified: "Wed, 10 Jun 2026 10:00:00 GMT"
    },
    "RP-FORM-1": {
      passTypeIdentifier: "pass.dev.local",
      authenticationToken: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      groupId: "RP247@2026-06-01",
      state: { meta: { serialNumber: "RP-FORM-1" }, flight: {} },
      lastModified: "Wed, 10 Jun 2026 11:00:00 GMT"
    }
  },
  registrations: {
    DEVICE1: {
      "RP1@2026-06-01-001": {
        pushToken: "tok1",
        passTypeIdentifier: "pass.dev.local",
        registeredAt: "2026-06-10T10:00:00.000Z"
      }
    }
  },
  log: [{ at: "2026-06-10T10:00:00.000Z", entries: ["hello"] }]
};

describe("SQLite storage", () => {
  let dir, statePath;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wpd-sqlite-"));
    statePath = join(dir, "passes.json");
  });

  it("persists to a SQLite file next to STATE_PATH and stops writing JSON", async () => {
    const s = await bootStorage(statePath);
    await s.saveTemplatePass({ serialNumber: "S-1", template: "dev-sample", data: {}, groupId: "G@1", passTypeId: "pass.dev.local" });
    expect(existsSync(join(dir, "passes.sqlite"))).toBe(true);
    expect(existsSync(statePath)).toBe(false);
  });

  it("imports a legacy passes.json on first boot, with a timestamped backup", async () => {
    await writeFile(statePath, JSON.stringify(LEGACY));
    const s = await bootStorage(statePath);
    const snap = await s.snapshot();
    expect(Object.keys(snap.passes).sort()).toEqual(["RP-FORM-1", "RP1@2026-06-01-001"]);
    expect(snap.passes["RP1@2026-06-01-001"]).toMatchObject(LEGACY.passes["RP1@2026-06-01-001"]);
    expect(snap.passes["RP1@2026-06-01-001"].updateTag).toBe(1);
    expect(snap.passes["RP-FORM-1"]).toMatchObject(LEGACY.passes["RP-FORM-1"]);
    expect(snap.passes["RP-FORM-1"].updateTag).toBe(2);
    expect(snap.registrations).toEqual(LEGACY.registrations);
    expect(snap.log).toEqual(LEGACY.log);
    const backups = (await readdir(dir)).filter(f => f.startsWith("passes.json.bak-"));
    expect(backups).toHaveLength(1);
  });

  it("never re-imports on later boots — deletions survive and one backup exists", async () => {
    await writeFile(statePath, JSON.stringify(LEGACY));
    const s1 = await bootStorage(statePath);
    expect(await s1.deletePass("RP1@2026-06-01-001")).toBe(true);

    const s2 = await bootStorage(statePath); // legacy file still on disk
    const snap = await s2.snapshot();
    expect(Object.keys(snap.passes)).toEqual(["RP-FORM-1"]);
    expect(snap.registrations).toEqual({}); // registration removed with its pass
    const backups = (await readdir(dir)).filter(f => f.startsWith("passes.json.bak-"));
    expect(backups).toHaveLength(1);
  });

  it("keeps the authenticationToken stable across re-issue and reboot", async () => {
    const s1 = await bootStorage(statePath);
    const first = await s1.saveTemplatePass({ serialNumber: "S-9", template: "dev-sample", data: {}, groupId: "G@1", passTypeId: "pass.dev.local" });
    expect(first.authenticationToken).toMatch(/^[0-9a-f]{32}$/);

    const s2 = await bootStorage(statePath);
    const again = await s2.saveTemplatePass({ serialNumber: "S-9", template: "dev-sample", data: { seat: "1A" }, groupId: "G@1", passTypeId: "pass.dev.local" });
    expect(again.authenticationToken).toBe(first.authenticationToken);
  });

  it("allocates increasing updateTags and collision-safe lastModified values", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-30T00:00:00.500Z"));
    try {
      const s = await bootStorage(statePath);
      const first = await s.saveTemplatePass({
        serialNumber: "SAME-SECOND", template: "dev-sample", data: { gate: "A1" },
        groupId: "G@1", passTypeId: "pass.dev.local"
      });
      const second = await s.saveTemplatePass({
        serialNumber: "SAME-SECOND", template: "dev-sample", data: { gate: "A2" },
        groupId: "G@1", passTypeId: "pass.dev.local"
      });
      const third = await s.updatePassData("SAME-SECOND", data => ({ ...data, gate: "A3" }));
      expect(second.updateTag).toBe(first.updateTag + 1);
      expect(third.updateTag).toBe(second.updateTag + 1);
      expect(Date.parse(second.lastModified)).toBeGreaterThan(Date.parse(first.lastModified));
      expect(Date.parse(third.lastModified)).toBeGreaterThan(Date.parse(second.lastModified));
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists only registrations with update tags greater than sinceTag", async () => {
    const s = await bootStorage(statePath);
    const first = await s.saveTemplatePass({
      serialNumber: "TAG-1", template: "dev-sample", data: {}, groupId: "G@1", passTypeId: "pass.dev.local"
    });
    const second = await s.saveTemplatePass({
      serialNumber: "TAG-2", template: "dev-sample", data: {}, groupId: "G@1", passTypeId: "pass.dev.local"
    });
    await s.registerDevice({
      deviceLibraryIdentifier: "DEVICE-TAG", passTypeIdentifier: "pass.dev.local",
      serialNumber: "TAG-1", pushToken: "p1"
    });
    await s.registerDevice({
      deviceLibraryIdentifier: "DEVICE-TAG", passTypeIdentifier: "pass.dev.local",
      serialNumber: "TAG-2", pushToken: "p2"
    });
    await expect(s.listUpdatedSerials({
      deviceLibraryIdentifier: "DEVICE-TAG",
      passTypeIdentifier: "pass.dev.local",
      sinceTag: String(first.updateTag)
    })).resolves.toEqual({ serials: ["TAG-2"], lastUpdated: String(second.updateTag) });
  });

  it("backfills old SQLite rows without update_tag and preserves lastModified", async () => {
    const legacyDb = new DatabaseSync(join(dir, "passes.sqlite"));
    legacyDb.exec(`
      CREATE TABLE passes (
        serial               TEXT PRIMARY KEY,
        pass_type_identifier TEXT,
        authentication_token TEXT NOT NULL,
        group_id             TEXT,
        template             TEXT,
        state_json           TEXT,
        data_json            TEXT,
        last_modified        TEXT NOT NULL
      );
      CREATE TABLE registrations (
        device_library_identifier TEXT NOT NULL,
        serial                    TEXT NOT NULL,
        pass_type_identifier      TEXT NOT NULL,
        push_token                TEXT NOT NULL,
        registered_at             TEXT NOT NULL,
        PRIMARY KEY (device_library_identifier, serial)
      );
      CREATE TABLE device_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        at           TEXT NOT NULL,
        entries_json TEXT NOT NULL
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE template_bindings (
        template_id   TEXT PRIMARY KEY,
        bindings_json TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
    `);
    legacyDb.prepare(`
      INSERT INTO passes
        (serial, pass_type_identifier, authentication_token, group_id, template, data_json, last_modified)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("OLD-1", "pass.dev.local", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "G@1", "dev-sample", "{}", "Wed, 10 Jun 2026 10:00:00 GMT");
    legacyDb.prepare(`
      INSERT INTO passes
        (serial, pass_type_identifier, authentication_token, group_id, template, data_json, last_modified)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("OLD-2", "pass.dev.local", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "G@1", "dev-sample", "{}", "Wed, 10 Jun 2026 11:00:00 GMT");
    legacyDb.close();

    const s = await bootStorage(statePath);
    const snap = await s.snapshot();
    expect(snap.passes["OLD-1"]).toMatchObject({ lastModified: "Wed, 10 Jun 2026 10:00:00 GMT", updateTag: 1 });
    expect(snap.passes["OLD-2"]).toMatchObject({ lastModified: "Wed, 10 Jun 2026 11:00:00 GMT", updateTag: 2 });
  });

  it("bounds the device log to its ring size across reboots", async () => {
    const s1 = await bootStorage(statePath);
    for (let i = 0; i < 1005; i++) await s1.logFromDevice([`line ${i}`]);
    const snap = await (await bootStorage(statePath)).snapshot();
    expect(snap.log).toHaveLength(1000);
    expect(snap.log.at(-1).entries).toEqual(["line 1004"]);
  });

  // The passes table is keyed by serial alone (single-PASS_TYPE_ID model). A
  // write-time guard refuses to silently clobber a serial already issued under a
  // different passTypeIdentifier — the common re-issue path (same serial, same
  // passType) must stay untouched and keep the auth token stable.
  describe("serial passType write-time guard", () => {
    const ORIG_PASS_TYPE_ID = process.env.PASS_TYPE_ID;
    beforeEach(() => { delete process.env.PASS_TYPE_ID; });
    afterEach(() => {
      if (ORIG_PASS_TYPE_ID === undefined) delete process.env.PASS_TYPE_ID;
      else process.env.PASS_TYPE_ID = ORIG_PASS_TYPE_ID;
    });

    it("throws when a template pass serial is re-saved under a different passType", async () => {
      const s = await bootStorage(statePath);
      await s.saveTemplatePass({
        serialNumber: "GUARD-1", template: "dev-sample", data: {}, groupId: "G@1", passTypeId: "pass.dev.local"
      });
      await expect(s.saveTemplatePass({
        serialNumber: "GUARD-1", template: "dev-sample", data: {}, groupId: "G@1", passTypeId: "pass.dev.other"
      })).rejects.toThrow(/passTypeIdentifier/);
    });

    it("does NOT throw re-saving a template pass under the SAME passType and keeps the token stable", async () => {
      const s = await bootStorage(statePath);
      const first = await s.saveTemplatePass({
        serialNumber: "GUARD-2", template: "dev-sample", data: {}, groupId: "G@1", passTypeId: "pass.dev.local"
      });
      const again = await s.saveTemplatePass({
        serialNumber: "GUARD-2", template: "dev-sample", data: { seat: "2B" }, groupId: "G@1", passTypeId: "pass.dev.local"
      });
      expect(again.passTypeIdentifier).toBe("pass.dev.local");
      expect(again.authenticationToken).toBe(first.authenticationToken);
    });

    it("throws when a FormState pass serial is re-saved under a different passType", async () => {
      const s = await bootStorage(statePath);
      const base = { flight: {}, meta: { serialNumber: "GUARD-3", passTypeId: "pass.dev.local" } };
      await s.savePass(base);
      await expect(s.savePass({
        ...base, meta: { ...base.meta, passTypeId: "pass.dev.other" }
      })).rejects.toThrow(/passTypeIdentifier/);
    });

    it("does NOT throw re-saving a FormState pass under the SAME passType and keeps the token stable", async () => {
      const s = await bootStorage(statePath);
      const base = { flight: {}, meta: { serialNumber: "GUARD-4", passTypeId: "pass.dev.local" } };
      const first = await s.savePass(base);
      const again = await s.savePass(base);
      expect(again.passTypeIdentifier).toBe("pass.dev.local");
      expect(again.authenticationToken).toBe(first.authenticationToken);
    });
  });
});

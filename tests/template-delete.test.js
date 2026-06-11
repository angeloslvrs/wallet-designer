import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";

// storage.js resolves STATE_PATH at import time, so set the env before the
// dynamic imports below (same pattern as template-storage.test.js).
let handleTemplateUpload, handleTemplateDelete, saveTemplatePass;

const PASS_JSON = JSON.stringify({
  formatVersion: 1,
  passTypeIdentifier: "pass.dev.placeholder",
  description: "Boarding pass",
  boardingPass: { headerFields: [{ key: "gate", label: "GATE", value: "—" }] }
});

function zipOf(entries) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
}
const mkReq = (id, body) => ({ params: { id }, body });
function mkRes() {
  return {
    statusCode: 0, payload: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; }
  };
}

async function installTemplate(id) {
  const res = mkRes();
  await handleTemplateUpload(mkReq(id, zipOf({ "pass.json": PASS_JSON, "icon.png": "x" })), res);
  expect(res.statusCode).toBe(201);
}

beforeAll(async () => {
  process.env.TEMPLATES_DIR = await mkdtemp(join(tmpdir(), "wpd-templates-del-"));
  process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-state-del-")), "passes.json");
  ({ handleTemplateUpload, handleTemplateDelete } = await import("../apps/server/src/routes/templates.js"));
  ({ saveTemplatePass } = await import("../apps/server/src/storage.js"));
});

describe("handleTemplateDelete", () => {
  it("deletes an unreferenced template bundle", async () => {
    await installTemplate("deleteme");
    const dir = join(process.env.TEMPLATES_DIR, "deleteme.pkpasstemplate");
    expect(existsSync(dir)).toBe(true);

    const res = mkRes();
    await handleTemplateDelete(mkReq("deleteme"), res);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, id: "deleteme" });
    expect(existsSync(dir)).toBe(false);
  });

  it("refuses with 409 while any stored pass references the template", async () => {
    await installTemplate("inuse");
    await saveTemplatePass({
      serialNumber: "REF-001", template: "inuse", data: { gate: "B7" },
      groupId: "REF@2026-06-20", passTypeId: "pass.dev.placeholder"
    });

    const res = mkRes();
    await handleTemplateDelete(mkReq("inuse"), res);
    expect(res.statusCode).toBe(409);
    expect(res.payload.error).toMatch(/referenced/);
    expect(res.payload.serials).toEqual(["REF-001"]);
    // the bundle must survive — installed passes rebuild from it on every fetch
    expect(existsSync(join(process.env.TEMPLATES_DIR, "inuse.pkpasstemplate"))).toBe(true);
  });

  it("404s on a template that is not installed", async () => {
    const res = mkRes();
    await handleTemplateDelete(mkReq("ghost"), res);
    expect(res.statusCode).toBe(404);
  });

  it("rejects ids that are not a plain slug", async () => {
    for (const id of ["../escape", "a b", ""]) {
      const res = mkRes();
      await handleTemplateDelete(mkReq(id), res);
      expect(res.statusCode, `id ${JSON.stringify(id)}`).toBe(400);
    }
  });
});

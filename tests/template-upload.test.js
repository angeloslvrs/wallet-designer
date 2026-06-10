import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { handleTemplateUpload } from "../apps/server/src/routes/templates.js";

const PASS_JSON = JSON.stringify({
  formatVersion: 1,
  passTypeIdentifier: "pass.dev.placeholder",
  description: "Boarding pass",
  boardingPass: { headerFields: [{ key: "gate", label: "GATE", value: "—" }] }
});

function zipOf(entries) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content));
  }
  return zip.toBuffer();
}

function mkReq(id, body) {
  return { params: { id }, body };
}
function mkRes() {
  return {
    statusCode: 0, payload: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; }
  };
}

beforeAll(async () => {
  process.env.TEMPLATES_DIR = await mkdtemp(join(tmpdir(), "wpd-templates-"));
});

describe("handleTemplateUpload", () => {
  it("writes the sanitized bundle to <id>.pkpasstemplate and reports its field keys", async () => {
    const res = mkRes();
    await handleTemplateUpload(mkReq("summer", zipOf({
      "Flight.pkpasstemplate/pass.json": PASS_JSON,
      "Flight.pkpasstemplate/icon.png": "png-bytes"
    })), res);
    expect(res.statusCode).toBe(201);
    expect(res.payload.id).toBe("summer");
    expect(res.payload.fieldKeys).toEqual(["gate"]);
    const dir = join(process.env.TEMPLATES_DIR, "summer.pkpasstemplate");
    expect(existsSync(join(dir, "pass.json"))).toBe(true);
    expect(existsSync(join(dir, "icon.png"))).toBe(true);
  });

  it("replaces the whole bundle on re-upload (no stale assets survive)", async () => {
    await handleTemplateUpload(mkReq("repl", zipOf({ "pass.json": PASS_JSON, "extra.png": "x" })), mkRes());
    const res = mkRes();
    await handleTemplateUpload(mkReq("repl", zipOf({ "pass.json": PASS_JSON })), res);
    expect(res.statusCode).toBe(201);
    const dir = join(process.env.TEMPLATES_DIR, "repl.pkpasstemplate");
    expect(existsSync(join(dir, "pass.json"))).toBe(true);
    expect(existsSync(join(dir, "extra.png"))).toBe(false);
  });

  it("rejects ids that are not a plain slug", async () => {
    for (const id of ["../escape", "a b", ".hidden", ""]) {
      const res = mkRes();
      await handleTemplateUpload(mkReq(id, zipOf({ "pass.json": PASS_JSON })), res);
      expect(res.statusCode, `id ${JSON.stringify(id)}`).toBe(400);
    }
  });

  it("rejects a missing or empty body with a usage hint", async () => {
    const res = mkRes();
    await handleTemplateUpload(mkReq("nobody", undefined), res);
    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toMatch(/raw request body/);
  });

  it("rejects a zip without a pass.json", async () => {
    const res = mkRes();
    await handleTemplateUpload(mkReq("nopass", zipOf({ "icon.png": "x" })), res);
    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toMatch(/pass\.json/);
  });
});

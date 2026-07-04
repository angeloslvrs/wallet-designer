import { describe, it, expect, beforeAll, vi } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";

// Mock only loadTemplate so a re-upload can be forced to fail at the validation
// step (after the staged bundle is written) — everything else is the real thing.
vi.mock("@wpd/pass-builder", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadTemplate: vi.fn(actual.loadTemplate) };
});
import { loadTemplate } from "@wpd/pass-builder";
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

  it("keeps the original bundle intact when a re-upload fails mid-validation, then a good re-upload replaces it", async () => {
    // Seed a valid bundle.
    await handleTemplateUpload(mkReq("atomic", zipOf({
      "pass.json": PASS_JSON,
      "original.png": "original-bytes"
    })), mkRes());
    const dir = join(process.env.TEMPLATES_DIR, "atomic.pkpasstemplate");
    expect(existsSync(join(dir, "original.png"))).toBe(true);

    // Re-upload that sanitizes fine but fails validation (loadTemplate throws
    // once, standing in for a corrupt staged bundle / disk error).
    loadTemplate.mockImplementationOnce(() => { throw new Error("staged bundle is unloadable"); });
    const failRes = mkRes();
    await handleTemplateUpload(mkReq("atomic", zipOf({
      "pass.json": PASS_JSON,
      "replacement.png": "new-bytes"
    })), failRes);
    expect(failRes.statusCode).toBe(400);

    // The original bundle survived untouched and still loads.
    expect(existsSync(join(dir, "original.png"))).toBe(true);
    expect(existsSync(join(dir, "replacement.png"))).toBe(false);
    await expect(loadTemplate(dir)).resolves.toMatchObject({ passJson: expect.any(Object) });

    // No staging dir was left behind.
    const leftover = (await readdir(process.env.TEMPLATES_DIR)).filter(n => n.startsWith(".tmp-"));
    expect(leftover).toEqual([]);

    // A subsequent good re-upload replaces the bundle wholesale.
    const okRes = mkRes();
    await handleTemplateUpload(mkReq("atomic", zipOf({
      "pass.json": PASS_JSON,
      "replacement.png": "new-bytes"
    })), okRes);
    expect(okRes.statusCode).toBe(201);
    expect(existsSync(join(dir, "replacement.png"))).toBe(true);
    expect(existsSync(join(dir, "original.png"))).toBe(false);
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

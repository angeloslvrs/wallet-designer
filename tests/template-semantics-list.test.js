import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";

let handleTemplateUpload, handleTemplateList;
const PASS_JSON = JSON.stringify({
  formatVersion: 1, passTypeIdentifier: "pass.dev.placeholder", description: "Boarding pass",
  boardingPass: { headerFields: [{ key: "gate", label: "GATE", value: "B7" }] },
  semantics: { airlineCode: "RP", departureGate: "B7" }
});
function zipOf(entries) { const z = new AdmZip(); for (const [n, c] of Object.entries(entries)) z.addFile(n, Buffer.from(c)); return z.toBuffer(); }
function mkRes() { return { statusCode: 0, payload: null, status(c){this.statusCode=c;return this;}, json(o){this.payload=o;return this;} }; }

beforeAll(async () => {
  process.env.TEMPLATES_DIR = await mkdtemp(join(tmpdir(), "wpd-tpl-sem-"));
  process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-state-sem-")), "passes.json");
  ({ handleTemplateUpload, handleTemplateList } = await import("../apps/server/src/routes/templates.js"));
  const res = mkRes();
  await handleTemplateUpload({ params: { id: "sem" }, body: zipOf({ "pass.json": PASS_JSON, "icon.png": "x" }) }, res);
  expect(res.statusCode).toBe(201);
});

describe("templates list", () => {
  it("includes each template's baked semantics", async () => {
    const res = mkRes();
    await handleTemplateList({}, res);
    const tpl = res.payload.find(t => t.id === "sem");
    expect(tpl.semantics).toEqual({ airlineCode: "RP", departureGate: "B7" });
  });
});

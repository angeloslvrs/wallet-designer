import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";

// Templates shelf data: Pass Designer bundles (`kind: "designer"`) and saved
// Studio designs (`kind: "studio"`, from designs/ — see designs-route.test.js) each carry a thumbnail-safe
// `preview` pass.json — no per-pass identity/secrets, no Designer `_id`s.
let handleTemplateUpload, handleTemplateList, previewPassJson;
const PASS_JSON = JSON.stringify({
  formatVersion: 1, passTypeIdentifier: "pass.dev.placeholder", teamIdentifier: "T", serialNumber: "S",
  authenticationToken: "secret-token-xxxxxxxx", webServiceURL: "https://example.test/api/wallet",
  description: "Boarding pass", logoText: "Lib Air",
  boardingPass: { headerFields: [{ _id: "uuid-1", key: "gate", label: "GATE", value: "B7" }] },
  semantics: { airlineCode: "RP", departureGate: "B7" }
});
function zipOf(entries) { const z = new AdmZip(); for (const [n, c] of Object.entries(entries)) z.addFile(n, Buffer.from(c)); return z.toBuffer(); }
function mkRes() { return { statusCode: 0, payload: null, status(c){this.statusCode=c;return this;}, json(o){this.payload=o;return this;} }; }

beforeAll(async () => {
  process.env.TEMPLATES_DIR = await mkdtemp(join(tmpdir(), "wpd-tpl-lib-"));
  process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-state-lib-")), "passes.json");
  ({ handleTemplateUpload, handleTemplateList, previewPassJson } = await import("../apps/server/src/routes/templates.js"));
  const res = mkRes();
  await handleTemplateUpload({ params: { id: "lib" }, body: zipOf({ "pass.json": PASS_JSON, "icon.png": "x", "logo@2x.png": "png-bytes" }) }, res);
  expect(res.statusCode).toBe(201);
});

describe("designer templates — shelf fields", () => {
  it("marks bundles kind=designer with a sanitized preview and the logo as a data URL", async () => {
    const res = mkRes();
    await handleTemplateList({}, res);
    const t = res.payload.find(x => x.id === "lib");
    expect(t.kind).toBe("designer");
    expect(t.preview.logoText).toBe("Lib Air");
    expect(t.preview.authenticationToken).toBeUndefined();
    expect(t.preview.webServiceURL).toBeUndefined();
    expect(t.preview.serialNumber).toBeUndefined();
    expect(t.preview.boardingPass.headerFields[0]._id).toBeUndefined();
    expect(t.logo).toMatch(/^data:image\/png;base64,/);
  });
});

describe("previewPassJson", () => {
  it("previewPassJson never mutates its input", () => {
    const src = { authenticationToken: "a", boardingPass: { primaryFields: [{ _id: "x", key: "k" }] } };
    previewPassJson(src);
    expect(src.authenticationToken).toBe("a");
    expect(src.boardingPass.primaryFields[0]._id).toBe("x");
  });
});

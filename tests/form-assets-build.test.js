import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import AdmZip from "adm-zip";
import { buildPkpass } from "../packages/pass-builder/index.js";
import { migrateFormState } from "../packages/pass-builder/migrate.js";

const certDir = "certs/dev";

// A 1x1 transparent PNG, distinct from the assets/ default logo bytes.
const UPLOAD = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

let state;
beforeAll(() => {
  if (!existsSync(`${certDir}/signerCert.pem`)) {
    throw new Error("dev cert missing — run `npm run init` first");
  }
  state = migrateFormState(JSON.parse(readFileSync("fixtures/fully-loaded.json", "utf8")));
});

describe("buildPkpass image uploads", () => {
  it("emits the uploaded logo bytes as logo.png/@2x/@3x in the .pkpass", async () => {
    const withLogo = { ...state, branding: { ...state.branding, logoDataUrl: `data:image/png;base64,${UPLOAD.toString("base64")}` } };
    const pkpass = await buildPkpass({ state: withLogo, certDir });
    const zip = new AdmZip(pkpass);
    const names = zip.getEntries().map(e => e.entryName);
    expect(names).toContain("logo.png");
    expect(names).toContain("logo@2x.png");
    expect(names).toContain("logo@3x.png");
    expect(zip.getEntry("logo.png").getData().equals(UPLOAD)).toBe(true);
  });

  it("falls back to disk assets when no upload is present", async () => {
    const pkpass = await buildPkpass({ state, certDir });
    const names = new AdmZip(pkpass).getEntries().map(e => e.entryName);
    expect(names).toContain("icon.png"); // from assets/
  });
});

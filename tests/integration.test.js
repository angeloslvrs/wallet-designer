import { describe, it, expect, beforeAll } from "vitest";
import { buildPkpass } from "../packages/pass-builder/index.js";
import { computeManifest } from "../packages/pass-builder/manifest.js";
import AdmZip from "adm-zip";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const certDir = "certs/dev";

describe("integration: build → re-parse → validate", () => {
  beforeAll(() => {
    if (!existsSync(`${certDir}/signerCert.pem`)) {
      throw new Error("dev cert missing — run `npm run gen-dev-cert` first");
    }
    if (!existsSync("assets/icon.png")) {
      throw new Error("assets missing — run `npm run gen-assets` first");
    }
  });

  it("produces a parseable, internally-consistent .pkpass", async () => {
    const state = JSON.parse(await readFile("fixtures/fully-loaded.json", "utf8"));
    const buf = await buildPkpass({ state, certDir });

    const zip = new AdmZip(buf);
    const entries = zip.getEntries().map(e => e.entryName).sort();

    expect(entries).toContain("pass.json");
    expect(entries).toContain("manifest.json");
    expect(entries).toContain("signature");
    expect(entries).toContain("icon.png");

    const manifest = JSON.parse(zip.getEntry("manifest.json").getData().toString("utf8"));

    const filesInZip = {};
    for (const e of zip.getEntries()) {
      if (e.entryName === "manifest.json" || e.entryName === "signature") continue;
      filesInZip[e.entryName] = e.getData();
    }
    const recomputed = computeManifest(filesInZip);
    expect(recomputed).toEqual(manifest);
  });

  it("preserves iOS 26 semantics through the build", async () => {
    const state = JSON.parse(await readFile("fixtures/fully-loaded.json", "utf8"));
    const buf = await buildPkpass({ state, certDir });
    const zip = new AdmZip(buf);
    const pass = JSON.parse(zip.getEntry("pass.json").getData().toString("utf8"));
    expect(pass.semantics.airlineCode).toBe("RP");
    expect(pass.semantics.wifiAccess[0].ssid).toBe("GoGoInflight");
    expect(pass.semantics.duration).toBe(19800);
  });

  it("lets server overrides win over the FormState meta (webServiceURL/serial/team)", async () => {
    const state = JSON.parse(await readFile("fixtures/fully-loaded.json", "utf8"));
    const overrides = { webServiceURL: "https://prod.example/api/wallet", serialNumber: "OVERRIDE-1", teamIdentifier: "TEAMOVERRIDE" };
    const buf = await buildPkpass({ state, certDir, overrides });
    const pass = JSON.parse(new AdmZip(buf).getEntry("pass.json").getData().toString("utf8"));
    expect(pass.webServiceURL).toBe("https://prod.example/api/wallet");
    expect(pass.serialNumber).toBe("OVERRIDE-1");
    expect(pass.teamIdentifier).toBe("TEAMOVERRIDE");
  });
});

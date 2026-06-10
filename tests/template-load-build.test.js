import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { loadTemplate, buildPkpassFromTemplate } from "../packages/pass-builder/template.js";
import { computeManifest } from "../packages/pass-builder/manifest.js";

const certDir = "certs/dev";

function skeletonPassJson() {
  return {
    formatVersion: 1,
    passTypeIdentifier: "pass.dev.placeholder",
    teamIdentifier: "PLACEHOLDER",
    organizationName: "Rocket Partners Airlines",
    description: "Boarding pass",
    barcodes: [{ format: "PKBarcodeFormatQR", message: "PLACEHOLDER", messageEncoding: "iso-8859-1" }],
    boardingPass: {
      transitType: "PKTransitTypeAir",
      headerFields: [{ key: "gate", label: "GATE", value: "—" }],
      primaryFields: [
        { key: "depart", label: "San Francisco", value: "SFO" },
        { key: "arrive", label: "New York", value: "JFK" }
      ],
      secondaryFields: [{ key: "passenger", label: "PASSENGER", value: "FIRSTNAME LASTNAME" }]
    }
  };
}

/** Lay a synthetic .pkpasstemplate bundle on disk, junk files included. */
async function makeTemplateDir() {
  const dir = await mkdtemp(join(tmpdir(), "wpd-template-"));
  await writeFile(join(dir, "pass.json"), JSON.stringify(skeletonPassJson(), null, 2));
  await writeFile(join(dir, "icon.png"), await readFile("assets/icon.png"));
  await mkdir(join(dir, "en.lproj"), { recursive: true });
  await writeFile(join(dir, "en.lproj/pass.strings"), '"GATE" = "GATE";\n');
  // junk that must never reach the built pass
  await writeFile(join(dir, ".DS_Store"), "junk");
  await writeFile(join(dir, "manifest.json"), "{}");
  await writeFile(join(dir, "signature"), "stale");
  return dir;
}

let templateDir;

beforeAll(async () => {
  if (!existsSync(`${certDir}/signerCert.pem`)) {
    throw new Error("dev cert missing — run `npm run gen-dev-cert` first");
  }
  if (!existsSync("assets/icon.png")) {
    throw new Error("assets missing — run `npm run gen-assets` first");
  }
  templateDir = await makeTemplateDir();
});

describe("loadTemplate", () => {
  it("parses pass.json and collects assets with bundle-relative paths", async () => {
    const { passJson, assets } = await loadTemplate(templateDir);
    expect(passJson.passTypeIdentifier).toBe("pass.dev.placeholder");
    expect(Object.keys(assets).sort()).toEqual(["en.lproj/pass.strings", "icon.png"]);
    expect(Buffer.isBuffer(assets["icon.png"])).toBe(true);
  });

  it("excludes pass.json, .DS_Store, and stale manifest/signature from assets", async () => {
    const { assets } = await loadTemplate(templateDir);
    for (const name of ["pass.json", ".DS_Store", "manifest.json", "signature"]) {
      expect(assets[name]).toBeUndefined();
    }
  });

  it("throws a pointed error when the directory is not a template bundle", async () => {
    const empty = await mkdtemp(join(tmpdir(), "wpd-empty-"));
    await expect(loadTemplate(empty)).rejects.toThrow(/pass\.json/);
  });
});

describe("buildPkpassFromTemplate", () => {
  const overrides = {
    serialNumber: "TPL-0001",
    passTypeIdentifier: "pass.dev.local",
    teamIdentifier: "DEV0000000",
    authenticationToken: "0123456789abcdef0123456789abcdef",
    webServiceURL: "https://example.test/api/wallet"
  };

  it("produces a signed .pkpass carrying the template assets", async () => {
    const buf = await buildPkpassFromTemplate({ templateDir, data: { gate: "B12" }, overrides, certDir });
    const zip = new AdmZip(buf);
    const entries = zip.getEntries().map(e => e.entryName).sort();
    expect(entries).toEqual(["en.lproj/pass.strings", "icon.png", "manifest.json", "pass.json", "signature"]);
  });

  it("applies the data merge and forces the server-controlled overrides", async () => {
    const buf = await buildPkpassFromTemplate({ templateDir, data: { gate: "B12" }, overrides, certDir });
    const pass = JSON.parse(new AdmZip(buf).getEntry("pass.json").getData().toString("utf8"));
    expect(pass.boardingPass.headerFields[0].value).toBe("B12");
    expect(pass.serialNumber).toBe("TPL-0001");
    expect(pass.passTypeIdentifier).toBe("pass.dev.local");
    expect(pass.teamIdentifier).toBe("DEV0000000");
    expect(pass.authenticationToken).toBe(overrides.authenticationToken);
    expect(pass.webServiceURL).toBe(overrides.webServiceURL);
  });

  it("writes a manifest consistent with the zipped files", async () => {
    const buf = await buildPkpassFromTemplate({ templateDir, data: {}, overrides, certDir });
    const zip = new AdmZip(buf);
    const manifest = JSON.parse(zip.getEntry("manifest.json").getData().toString("utf8"));
    const filesInZip = {};
    for (const e of zip.getEntries()) {
      if (e.entryName === "manifest.json" || e.entryName === "signature") continue;
      filesInZip[e.entryName] = e.getData();
    }
    expect(computeManifest(filesInZip)).toEqual(manifest);
  });

  it("rejects per-pass data with keys the template does not declare", async () => {
    await expect(
      buildPkpassFromTemplate({ templateDir, data: { seat: "14A" }, overrides, certDir })
    ).rejects.toThrow(/seat/);
  });
});

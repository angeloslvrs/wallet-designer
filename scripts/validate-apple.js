// Validate a built pass with Apple's own validators — the `buildpass` CLI
// from github.com/apple/pass-builder — when a binary is available locally.
//
// There is NO local Swift requirement: without a binary this exits 0 with a
// "skipped" note. The enforced gate is CI (.github/workflows/apple-validate.yml),
// which builds buildpass on GitHub's runners at a pinned commit.
//
// `buildpass validate` takes an UNCOMPRESSED pass bundle directory (its
// PassPackage loader requires a directory), so a .pkpass argument is unzipped
// to a temp dir first. It runs structural/semantic validators only — no
// signature verification — so dev-profile (self-signed) output validates fine.
//
// usage: npm run validate:apple [-- <path/to/pass.pkpass | path/to/bundle.pass>]
//        BUILDPASS_BIN=/path/to/buildpass npm run validate:apple

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";

const DEFAULT_TARGET = "out/dev-sample.pkpass";

function findBuildpass() {
  if (process.env.BUILDPASS_BIN) return process.env.BUILDPASS_BIN;
  const which = spawnSync("which", ["buildpass"], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : null;
}

const bin = findBuildpass();
if (!bin) {
  console.log("skipped — buildpass not installed (set BUILDPASS_BIN or put `buildpass` on PATH).");
  console.log("CI runs this check on every push: .github/workflows/apple-validate.yml");
  process.exit(0);
}

const target = process.argv[2] ?? DEFAULT_TARGET;
let passDir = target;
let tempDir = null;

if (target.endsWith(".pkpass")) {
  tempDir = mkdtempSync(join(tmpdir(), "wpd-validate-"));
  passDir = join(tempDir, "sample.pass");
  try {
    new AdmZip(target).extractAllTo(passDir, true);
  } catch (err) {
    console.error(`✗ could not unzip ${target}: ${err.message}`);
    console.error("  build one first: npm run build:pass -- --template dev-sample");
    process.exit(1);
  }
}

const result = spawnSync(bin, ["validate", passDir], { stdio: "inherit" });
if (tempDir) rmSync(tempDir, { recursive: true, force: true });
process.exit(result.status ?? 1);

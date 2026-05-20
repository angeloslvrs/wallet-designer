import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { buildPkpass } from "@wpd/pass-builder";
import "dotenv/config";

const { values } = parseArgs({
  options: {
    in:  { type: "string" },
    out: { type: "string" }
  }
});

if (!values.in) {
  console.error("usage: npm run build:pass -- --in fixtures/<name>.json [--out out/<name>.pkpass]");
  process.exit(1);
}

const profile = process.env.CERT_PROFILE ?? "dev";
const certDir = `certs/${profile}`;
const state = JSON.parse(await readFile(values.in, "utf8"));

const buf = await buildPkpass({
  state,
  certDir,
  passphrase: process.env.KEY_PASSPHRASE
});

const outPath = values.out ?? `out/${basename(values.in, ".json")}.pkpass`;
await mkdir("out", { recursive: true });
await writeFile(outPath, buf);
console.log(`✓ wrote ${outPath} (${buf.length} bytes, profile=${profile})`);

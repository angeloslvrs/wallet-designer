import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { buildPkpass } from "@wpd/pass-builder";
import { shiftPassDates } from "@wpd/pass-builder/shift-dates.js";
import "dotenv/config";

const { values } = parseArgs({
  options: {
    in:   { type: "string" },
    out:  { type: "string" },
    now:  { type: "boolean" },          // re-anchor schedule so it's relevant right now (live-activity demos)
    lead: { type: "string" }            // minutes from now until departure (default 60)
  }
});

if (!values.in) {
  console.error("usage: npm run build:pass -- --in fixtures/<name>.json [--out out/<name>.pkpass] [--now [--lead 60]]");
  process.exit(1);
}

const profile = process.env.CERT_PROFILE ?? "dev";
const certDir = `certs/${profile}`;
let state = JSON.parse(await readFile(values.in, "utf8"));

if (values.now) {
  const leadMinutes = Number(values.lead ?? 60);
  state = shiftPassDates(state, { leadMinutes });
  console.log(`↻ shifted schedule: departs ${state.flight.departure.depart} (now + ${leadMinutes}m)`);
}

// Force identifiers to match the signing cert so the pass installs on a device.
state.meta.passTypeId = process.env.PASS_TYPE_ID ?? state.meta.passTypeId;
state.meta.teamId = process.env.TEAM_ID ?? state.meta.teamId;

const buf = await buildPkpass({
  state,
  certDir,
  passphrase: process.env.KEY_PASSPHRASE
});

const outPath = values.out ?? `out/${basename(values.in, ".json")}.pkpass`;
await mkdir("out", { recursive: true });
await writeFile(outPath, buf);
console.log(`✓ wrote ${outPath} (${buf.length} bytes, profile=${profile})`);

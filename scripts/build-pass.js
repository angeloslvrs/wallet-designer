import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { buildPkpass, buildPkpassFromTemplate } from "@wpd/pass-builder";
import { shiftPassDates } from "@wpd/pass-builder/shift-dates.js";
import { templateDir } from "../apps/server/src/pass-build.js";
import "dotenv/config";

const { values } = parseArgs({
  options: {
    in:       { type: "string" },
    out:      { type: "string" },
    now:      { type: "boolean" },      // re-anchor schedule so it's relevant right now (live-activity demos)
    lead:     { type: "string" },       // minutes from now until departure (default 60)
    template: { type: "string" },       // build from templates/<id>.pkpasstemplate instead of a FormState fixture
    serial:   { type: "string" },       // template mode: serialNumber to stamp (default CLI-SAMPLE)
    data:     { type: "string" }        // template mode: path to a JSON object of fieldKey → value
  }
});

if (!values.in && !values.template) {
  console.error("usage: npm run build:pass -- --in fixtures/<name>.json [--out out/<name>.pkpass] [--now [--lead 60]]");
  console.error("       npm run build:pass -- --template <id> [--serial CLI-SAMPLE] [--data data.json] [--out out/<id>.pkpass]");
  process.exit(1);
}

const profile = process.env.CERT_PROFILE ?? "dev";
const certDir = `certs/${profile}`;

if (values.template) {
  const data = values.data ? JSON.parse(await readFile(values.data, "utf8")) : {};
  const buf = await buildPkpassFromTemplate({
    // templateDir() validates the id against TEMPLATE_ID_RE (throws on
    // anything that could escape templates/) — same guard the server uses.
    templateDir: templateDir(values.template),
    data,
    overrides: {
      serialNumber: values.serial ?? "CLI-SAMPLE",
      ...(process.env.PASS_TYPE_ID && { passTypeIdentifier: process.env.PASS_TYPE_ID }),
      ...(process.env.TEAM_ID && { teamIdentifier: process.env.TEAM_ID })
    },
    certDir,
    passphrase: process.env.KEY_PASSPHRASE
  });
  const outPath = values.out ?? `out/${values.template}.pkpass`;
  await mkdir("out", { recursive: true });
  await writeFile(outPath, buf);
  console.log(`✓ wrote ${outPath} (${buf.length} bytes, profile=${profile}, template=${values.template})`);
  process.exit(0);
}

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

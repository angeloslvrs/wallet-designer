import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { schema } from "@wpd/pass-schema";

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validator = ajv.compile(schema);

export function validate(state) {
  const ok = validator(state);
  return ok ? { ok: true } : { ok: false, errors: validator.errors };
}

export async function validateAllFixtures() {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturesDir = join(here, "..", "..", "fixtures");
  const names = ["minimal.json", "fully-loaded.json", "multi-seat.json"];
  let bad = 0;
  for (const n of names) {
    const raw = JSON.parse(await readFile(join(fixturesDir, n), "utf8"));
    const r = validate(raw);
    if (!r.ok) {
      console.error(`FAIL ${n}:`, r.errors);
      bad++;
    } else {
      console.log(`OK   ${n}`);
    }
  }
  if (bad) process.exit(1);
}

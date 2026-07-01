import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { schema } from "@wpd/pass-schema";
import { SEMANTIC_CATALOG } from "./semantics.js";

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validator = ajv.compile(schema);

// The semantic keys this repo knows about (Apple's SemanticTags boarding subset
// + the richer boarding-relevant extras — SEMANTIC_CATALOG is built from
// BOARDING_SEMANTICS + EXTRA_SEMANTICS in semantics.js). `wifiAccess` is derived
// at emit time from iOS26.wifi but is a legitimate semantics key too.
// Apple's full SemanticTags vocabulary is larger and evolving, so `semantics` is
// intentionally NOT hard-restricted in the JSON schema — an unknown key here is a
// NON-FATAL warning (an escape hatch for valid future/rail/event keys), never a
// validation failure.
const KNOWN_SEMANTIC_KEYS = new Set([...Object.keys(SEMANTIC_CATALOG), "wifiAccess"]);

/** Non-fatal: flag semantics keys outside the known boarding vocabulary. */
function semanticWarnings(semantics) {
  if (!semantics || typeof semantics !== "object") return [];
  return Object.keys(semantics)
    .filter(k => !KNOWN_SEMANTIC_KEYS.has(k))
    .map(k => ({ key: k, message: `Unknown semantic key "${k}" — not in the known SemanticTags vocabulary (allowed but unverified; typo?)` }));
}

export function validate(state) {
  const ok = validator(state);
  const warnings = semanticWarnings(state?.semantics);
  const base = warnings.length ? { warnings } : {};
  return ok ? { ok: true, ...base } : { ok: false, errors: validator.errors, ...base };
}

export async function validateAllFixtures() {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturesDir = join(here, "..", "..", "fixtures");
  const names = (await readdir(fixturesDir)).filter(f => f.endsWith(".json")).sort();
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

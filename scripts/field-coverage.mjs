// Field-coverage report: Apple's pass semantics (apple/pass-builder protobufs)
// vs what this repo can actually emit. Regenerates docs/field-coverage.md.
//
// Coverage is measured by EXECUTING the pipeline, not by parsing our source:
//   - designer flow: formStateToPassJson over every fixtures/*.json, keys unioned
//   - ops updates:   applyStatusToTemplateData with a fully-populated status body
//   - stand-in template: templates/dev-sample.pkpasstemplate/pass.json semantics
//
// Protos are read from apple/pass-builder at the SAME pinned SHA as the CI
// validate gate (.github/workflows/apple-validate.yml). For offline reruns set
// PASS_BUILDER_DIR=/path/to/a/local/clone.
//
// usage: node scripts/field-coverage.mjs

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formStateToPassJson } from "@wpd/pass-builder";
import { applyStatusToTemplateData } from "../apps/server/src/template-status.js";

// Keep in sync with PASS_BUILDER_SHA in .github/workflows/apple-validate.yml.
const PASS_BUILDER_SHA = "170f2a11601712acaa94d4aac3ecb4a2da9675fb";
const PROTO_FILES = ["PassSemantics.proto", "PassSeat.proto"];
const OUT_PATH = "docs/field-coverage.md";

// Event-ticket-only semantics — real gaps, but not for an airline boarding pass.
const EVENT_ONLY_PREFIXES = [
  "admissionLevel", "additionalTicketAttributes", "attendeeName", "entranceDescription",
  "eventType", "eventName", "eventStartDate", "eventEndDate", "tailgatingAllowed",
  "venue", "awayTeam", "homeTeam", "league", "sportName", "genre",
  "albumIds", "artistIds", "performerNames", "playlistIds"
];

const snakeToCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

async function protoText(name) {
  if (process.env.PASS_BUILDER_DIR) {
    return readFile(join(process.env.PASS_BUILDER_DIR, "Protobufs", name), "utf8");
  }
  const url = `https://raw.githubusercontent.com/apple/pass-builder/${PASS_BUILDER_SHA}/Protobufs/${name}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`could not fetch ${url} (${r.status}) — set PASS_BUILDER_DIR to a local clone for offline runs`);
  return r.text();
}

/**
 * Brace-depth parser: fields are attributed to their innermost message, so
 * messages nested inside PassSemantics (EventDateInfo, CurrencyAmount,
 * WifiNetwork) don't pollute the parent's field list. oneof/enum blocks push
 * an anonymous frame so their closing brace pops correctly.
 * @returns {Record<string, {name: string, camel: string, type: string}[]>}
 */
function parseProtoMessages(text) {
  const messages = {};
  const stack = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "");
    const msg = line.match(/\bmessage\s+(\w+)\s*\{/);
    if (msg) { stack.push(msg[1]); messages[msg[1]] ??= []; continue; }

    // oneof members count as fields of the nearest named message; enum entries
    // can't match (the regex needs a type AND a name before the "=").
    const field = line.match(/^\s*(?:optional|repeated|required)?\s*([\w.]+)\s+(\w+)\s*=\s*\d+;/);
    const owner = stack.findLast(n => n !== null);
    if (field && owner) {
      messages[owner].push({ name: field[2], camel: snakeToCamel(field[2]), type: field[1] });
    }

    const net = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    for (let i = 0; i < net; i++) stack.push(null);          // oneof/enum block
    for (let i = 0; i < -net; i++) stack.pop();
  }
  return messages;
}

/** Union of semantics keys the designer (FormState) flow can emit, measured by building every fixture. */
async function designerSemantics() {
  const keys = new Set();
  const seatKeys = new Set();
  for (const f of await readdir("fixtures")) {
    if (!f.endsWith(".json")) continue;
    const state = JSON.parse(await readFile(join("fixtures", f), "utf8"));
    let pass;
    try { pass = formStateToPassJson(state); } catch { continue; }
    for (const k of Object.keys(pass.semantics ?? {})) keys.add(k);
    for (const seat of pass.semantics?.seats ?? []) for (const k of Object.keys(seat)) seatKeys.add(k);
  }
  return { keys, seatKeys };
}

/** Semantics keys the ops status vocabulary can write on template passes. */
function statusSemantics() {
  const { data } = applyStatusToTemplateData({}, {
    gate: "B7", boarding: "2026-06-20T07:30:00-07:00", depart: "2026-06-20T08:00:00-07:00",
    arrive: "2026-06-20T16:45:00-04:00", transitInfo: "x", securityScreening: "x", delayed: "x"
  }, []);
  return new Set(Object.keys(data.semantics ?? {}));
}

async function templateSemantics() {
  const pj = JSON.parse(await readFile("templates/dev-sample.pkpasstemplate/pass.json", "utf8"));
  return new Set(Object.keys(pj.semantics ?? {}));
}

function table(rows, headers) {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map(r => `| ${r.join(" | ")} |`)
  ].join("\n");
}

const protos = {};
for (const f of PROTO_FILES) Object.assign(protos, parseProtoMessages(await protoText(f)));

const semanticsFields = protos.PassSemantics ?? [];
const seatFields = protos.PassSeat ?? [];
const nestedMessages = ["EventDateInfo", "CurrencyAmount", "WifiNetwork"];

const designer = await designerSemantics();
const status = statusSemantics();
const template = await templateSemantics();

const isEventOnly = (camel) => EVENT_ONLY_PREFIXES.some(p => camel === p || camel.startsWith(p));

const covered = [], partial = [], missing = [], missingEventOnly = [];
for (const f of semanticsFields) {
  const sources = [
    designer.keys.has(f.camel) && "designer (form-to-pass)",
    status.has(f.camel) && "ops status updates",
    template.has(f.camel) && "dev-sample template"
  ].filter(Boolean);
  const row = [`\`${f.camel}\``, `\`${f.name}\``, f.type, sources.join(", ") || "—"];
  if (sources.includes("designer (form-to-pass)")) covered.push(row);
  else if (sources.length) partial.push(row);
  else if (isEventOnly(f.camel)) missingEventOnly.push(row);
  else missing.push(row);
}

const protoCamel = new Set(semanticsFields.map(f => f.camel));
const drift = [...designer.keys].filter(k => !protoCamel.has(k)).sort();

const seatCovered = [], seatMissing = [];
for (const f of seatFields) {
  (designer.seatKeys.has(f.camel) ? seatCovered : seatMissing)
    .push([`\`${f.camel}\``, `\`${f.name}\``, f.type]);
}

const headers = ["pass.json key", "proto field", "type", "emitted by"];
const md = `# Field coverage vs Apple pass semantics

Generated by \`scripts/field-coverage.mjs\` — do not edit by hand; rerun the script.

- Source of truth: \`Protobufs/PassSemantics.proto\` + \`Protobufs/PassSeat.proto\` from
  [apple/pass-builder](https://github.com/apple/pass-builder) at \`${PASS_BUILDER_SHA.slice(0, 8)}\`
  (the same pinned SHA as \`.github/workflows/apple-validate.yml\`).
- "Coverage" is measured by running the pipeline: every \`fixtures/*.json\` through
  \`formStateToPassJson\`, a fully-populated status body through
  \`applyStatusToTemplateData\`, and the stand-in template's own \`semantics\`.
- Caveat: the protos document what Pass Builder models; PassKit may accept
  additional legacy keys not present here.

**PassSemantics: ${semanticsFields.length} fields — ${covered.length} covered, ${partial.length} partial, ${missing.length} missing (boarding-pass relevant), ${missingEventOnly.length} missing (event-ticket-only).**

## Covered (emitted by the designer flow)

${table(covered, headers)}

## Partial (only via ops updates or the stand-in template, not the designer)

${partial.length ? table(partial, headers) : "_none_"}

## Missing — boarding-pass relevant

${table(missing, headers)}

## Missing — event-ticket-only (not applicable to boarding passes)

${table(missingEventOnly, headers)}

## Seats (\`PassSeat\`)

Covered: ${seatCovered.map(r => r[0]).join(", ") || "—"}

Missing: ${seatMissing.map(r => r[0]).join(", ") || "—"}

> \`seatRow\`/\`seatSection\` are omitted **deliberately** — a stale row that
> disagreed with \`seatNumber\` was rendered by iOS as a doubled seat (e.g.
> "3838"); see the comment in \`packages/pass-builder/form-to-pass.js\`.

## Drift — keys we emit that are NOT in the protos

${drift.length ? drift.map(k => `- \`${k}\``).join("\n") : "_none_"}

${drift.length ? `These may be legacy PassKit names that iOS still accepts, or typos that iOS
silently ignores — verify against a device before relying on them.` : ""}

## Recommendation — top gaps for iOS 26 boarding passes

In rough order of value for the expanded boarding-pass view:

1. **\`transitStatus\` / \`transitStatusReason\`** — the system status line
   (on-time/delayed/cancelled). Today delays are a visible \`additionalInfoFields\`
   row only; the semantic status is what the expanded view and Live Activities key off.
2. **\`confirmationNumber\` + \`ticketFareClass\` + \`priorityStatus\`** — cheap wins,
   plain strings shown in the expanded details card.
3. **\`departureAirportTimeZone\` / \`destinationAirportTimeZone\`** — see drift
   list: we emit \`departure/destinationLocationTimeZone\` instead; renaming to the
   proto names is likely the fix.
4. **\`departureCityName\` / \`destinationCityName\`** — we ship the city only inside
   \`departure/destinationLocationDescription\`; the dedicated fields are what the
   route header uses.
5. **\`membershipProgramName\` / \`membershipProgramNumber\`** — we render frequent
   flyer as a visible field but never semantically.
6. **\`boardingZone\`**, **\`passenger*Ssrs\`**, **\`internationalDocumentsAreVerified\`**
   — niche, add when the data exists upstream.

Nested messages not broken out above: ${nestedMessages.map(m => `\`${m}\``).join(", ")}
(\`wifiAccess\` ssid/password are emitted; \`balance\`/\`totalPrice\` are store-card
semantics, n/a here; \`EventDateInfo\` is event-ticket-only).
`;

await writeFile(OUT_PATH, md);
console.log(`✓ wrote ${OUT_PATH}`);
console.log(`  PassSemantics: ${covered.length} covered / ${partial.length} partial / ${missing.length} missing (+${missingEventOnly.length} event-only) of ${semanticsFields.length}`);
console.log(`  PassSeat: ${seatCovered.length}/${seatFields.length} covered`);
if (drift.length) console.log(`  drift (emitted but not in protos): ${drift.join(", ")}`);

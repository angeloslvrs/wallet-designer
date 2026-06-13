// .pkpasstemplate support: load a Pass Designer template bundle, merge
// per-pass data onto it by field key, and build a signed .pkpass through the
// existing manifest/sign pipeline (sign.js untouched).
//
// The merge model mirrors Apple's own pass-builder personalization API
// (PassPackage.fields.setValue(_:forKey:)): the template is a complete
// skeleton pass.json with placeholder values, and per-pass data addresses
// fields by their `key`. Field keys are the contract between Pass Designer
// and this server; everything here is convention-agnostic — whatever keys the
// template declares are the keys you may set.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TIMEZONE_KEY_ALIASES } from "./semantics.js";
import { signPkpass } from "./sign.js";

/**
 * Per-pass data accepted by {@link applyTemplateData}:
 *  - `<fieldKey>`: string | number — replaces that field's `value` in every
 *    zone that declares the key.
 *  - `<fieldKey>`: object — shallow patch of the field (`value`, `label`,
 *    `changeMessage`, `attributedValue`, …). A `key` property is ignored.
 *  - `semantics`: object — deep-merged into the pass-level semantics.
 *  - `additionalInfoFields`: array — appended to the template's; a data entry
 *    whose key already exists in the template replaces the template's entry.
 *  - `barcodeMessage` / `barcodeAltText`: string — applied to every barcode.
 * Unknown keys throw (fail fast: a typo must not silently leave a placeholder
 * value on a real pass).
 * @typedef {Record<string, any>} TemplateData
 */

const STYLE_KEYS = ["boardingPass", "coupon", "eventTicket", "generic", "storeCard"];
export const FIELD_ZONES = ["headerFields", "primaryFields", "secondaryFields", "auxiliaryFields", "backFields", "additionalInfoFields"];
const RESERVED_KEYS = new Set(["semantics", "additionalInfoFields", "barcodeMessage", "barcodeAltText"]);

/** The style dict key ("boardingPass", …) of a pass.json, or undefined. */
export function styleKey(passJson) {
  return STYLE_KEYS.find(k => passJson?.[k] && typeof passJson[k] === "object");
}

/**
 * Every field `key` the template declares, across all zones of its style dict.
 * These keys are the merge API surface of the template.
 * @param {object} passJson
 * @returns {string[]}
 */
export function templateFieldKeys(passJson) {
  const style = styleKey(passJson);
  if (!style) return [];
  const keys = [];
  for (const zone of FIELD_ZONES) {
    for (const field of passJson[style][zone] ?? []) {
      if (field?.key !== undefined) keys.push(field.key);
    }
  }
  return keys;
}

/**
 * Pure: merge per-pass data onto a template pass.json by field key.
 * Returns a new object; the input is never mutated.
 * @param {object} passJson
 * @param {TemplateData} [data]
 * @returns {object}
 */
export function applyTemplateData(passJson, data = {}) {
  const out = structuredClone(passJson);
  const style = styleKey(out);
  const declared = new Set(templateFieldKeys(out));

  const unknown = Object.keys(data).filter(k => !RESERVED_KEYS.has(k) && !declared.has(k));
  if (unknown.length) {
    throw new Error(
      `unknown template field key(s): ${unknown.join(", ")} — this template declares: ` +
      `${[...declared].join(", ") || "(none)"}`
    );
  }

  for (const [key, raw] of Object.entries(data)) {
    if (RESERVED_KEYS.has(key)) continue;
    const isPatch = raw !== null && typeof raw === "object" && !Array.isArray(raw);
    const { key: _ignored, ...patch } = isPatch ? raw : { value: raw };
    for (const zone of FIELD_ZONES) {
      for (const field of out[style][zone] ?? []) {
        if (field.key === key) Object.assign(field, patch);
      }
    }
  }

  if (data.semantics !== undefined) {
    out.semantics = deepMerge(out.semantics ?? {}, data.semantics);
  }
  if (data.additionalInfoFields !== undefined && style) {
    const overridden = new Set(data.additionalInfoFields.map(f => f.key));
    out[style].additionalInfoFields = [
      ...(out[style].additionalInfoFields ?? []).filter(f => !overridden.has(f.key)),
      ...structuredClone(data.additionalInfoFields)
    ];
  }
  if (data.barcodeMessage !== undefined || data.barcodeAltText !== undefined) {
    out.barcodes = (out.barcodes ?? []).map(b => ({
      ...b,
      ...(data.barcodeMessage !== undefined && { message: data.barcodeMessage }),
      ...(data.barcodeAltText !== undefined && { altText: data.barcodeAltText })
    }));
  }

  return out;
}

/** Objects merge recursively; arrays and scalars replace; null DELETES the
 *  key — that's how issue-time data clears a template's placeholder semantics
 *  (sample schedule dates, passengerName, seats) that nothing re-derives. */
function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) { delete out[k]; continue; }
    const bothObjects =
      v !== null && typeof v === "object" && !Array.isArray(v) &&
      out[k] !== null && typeof out[k] === "object" && !Array.isArray(out[k]);
    out[k] = bothObjects ? deepMerge(out[k], v) : structuredClone(v);
  }
  return out;
}

// Files that must never be carried from a template into a built pass: OS junk,
// any stale manifest/signature (present when a signed .pkpass was unzipped and
// repurposed as a template — the build regenerates both), and Pass Designer's
// tooling.json (Designer-only metadata, not part of a pass).
const SKIPPED_FILES = new Set([".DS_Store", "manifest.json", "signature", "tooling.json"]);
const SKIPPED_DIRS = new Set(["__MACOSX"]);

/**
 * Read a .pkpasstemplate bundle (a directory: skeleton pass.json + image and
 * .lproj assets) from disk.
 * @param {string} dir
 * @returns {Promise<{passJson: object, assets: Record<string, Buffer>}>}
 */
export async function loadTemplate(dir) {
  let passJson;
  try {
    passJson = JSON.parse(await readFile(join(dir, "pass.json"), "utf8"));
  } catch (err) {
    const reason = err.code === "ENOENT" ? "is missing" : `did not parse: ${err.message}`;
    throw new Error(`not a usable .pkpasstemplate — ${join(dir, "pass.json")} ${reason}`);
  }
  /** @type {Record<string, Buffer>} */
  const assets = {};
  await collectAssets(dir, "", assets);
  return { passJson, assets };
}

async function collectAssets(root, rel, out) {
  for (const entry of await readdir(join(root, rel), { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) await collectAssets(root, relPath, out);
      continue;
    }
    if (SKIPPED_FILES.has(entry.name)) continue;
    if (relPath === "pass.json") continue;
    out[relPath] = await readFile(join(root, relPath));
  }
}

/**
 * One-shot: template bundle + per-pass data → signed .pkpass Buffer.
 * `overrides` are the server-controlled identity fields; they are applied
 * last and always win over whatever the template or data carries.
 * @param {object} opts
 * @param {string} opts.templateDir
 * @param {TemplateData} [opts.data]
 * @param {{serialNumber?: string, passTypeIdentifier?: string, teamIdentifier?: string,
 *          authenticationToken?: string, webServiceURL?: string}} [opts.overrides]
 * @param {string} opts.certDir
 * @param {string} [opts.passphrase]
 * @returns {Promise<Buffer>}
 */
export async function buildPkpassFromTemplate({ templateDir, data = {}, overrides = {}, certDir, passphrase }) {
  const { passJson, assets } = await loadTemplate(templateDir);
  const merged = mirrorTimeZoneAliases(stripInternalIds(applyTemplateData(passJson, data)));
  for (const key of OVERRIDE_KEYS) {
    if (overrides[key] !== undefined) merged[key] = overrides[key];
  }
  merged.formatVersion ??= 1;
  return signPkpass({ certDir, passphrase, passJson: merged, assets: ensureBaseImageVariants(assets) });
}

const OVERRIDE_KEYS = ["serialNumber", "passTypeIdentifier", "teamIdentifier", "authenticationToken", "webServiceURL"];

// Apple's pass image slots. Pass Designer (macOS) exports only the @2x/@3x
// scale variants of these — never the 1x base. iOS rejects "Add to Wallet"
// when the bundle has no base icon.png (the canonical icon PassKit loads at
// install), so an imported template that only carries icon@2x/@3x cannot be
// installed. FormState passes always ship a base icon.png from assets/, which
// is why designer-built passes install and raw template passes did not.
const PASS_IMAGE_SLOTS = new Set(["icon", "logo", "thumbnail", "strip", "background", "footer"]);
const SCALE_VARIANT_RE = /^(.*?)([^/]+)@[23]x\.png$/i;

/**
 * Pure: for each standard pass image slot that exists only as a @2x/@3x
 * variant, synthesize the missing 1x base file by aliasing the @2x bytes
 * (falling back to @3x). Returns a new assets map; the input is untouched and
 * the on-disk template bundle stays faithful to Designer's export — this is an
 * emit-time normalization, like {@link stripInternalIds}.
 *
 * Dimensions are not downscaled: iOS scales the icon to fit, and no Apple
 * validator enforces image dimensions — the install requirement is only that
 * the base file is present. Localized variants (e.g. `en.lproj/icon@2x.png`)
 * get the same treatment. Non-standard slots (Pass Designer's `primaryLogo`,
 * which iOS never renders) are left alone.
 * @param {Record<string, Buffer>} assets
 * @returns {Record<string, Buffer>}
 */
export function ensureBaseImageVariants(assets) {
  const out = { ...assets };
  for (const path of Object.keys(assets)) {
    const m = path.match(SCALE_VARIANT_RE);
    if (!m) continue;
    const [, dir, slot] = m;
    if (!PASS_IMAGE_SLOTS.has(slot.toLowerCase())) continue;
    const base = `${dir}${slot}.png`;
    if (out[base] !== undefined) continue; // template already provides a 1x base
    out[base] = assets[`${dir}${slot}@2x.png`] ?? assets[`${dir}${slot}@3x.png`];
  }
  return out;
}

/**
 * Pure: ensure BOTH time-zone key spellings carry the same IANA value on the
 * emitted pass. Apple's docs list only *LocationTimeZone while Pass Designer
 * and the protos emit *AirportTimeZone — Designer exports carry one spelling,
 * so the build mirrors whichever is present onto its missing twin.
 */
export function mirrorTimeZoneAliases(passJson) {
  if (!passJson?.semantics) return passJson;
  const semantics = { ...passJson.semantics };
  for (const [docKey, designerKey] of Object.entries(TIMEZONE_KEY_ALIASES)) {
    if (semantics[docKey] !== undefined && semantics[designerKey] === undefined) semantics[designerKey] = semantics[docKey];
    if (semantics[designerKey] !== undefined && semantics[docKey] === undefined) semantics[docKey] = semantics[designerKey];
  }
  return { ...passJson, semantics };
}

/**
 * Pure: deep-copy with every `_id` property removed. Pass Designer stamps
 * internal `_id` UUIDs on fields and semantics seats; they are Designer
 * bookkeeping, not pass content, so EMITTED pass.json drops them — on-disk
 * template bundles stay faithful to what Designer exported.
 */
export function stripInternalIds(value) {
  if (Array.isArray(value)) return value.map(stripInternalIds);
  if (value !== null && typeof value === "object") {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k !== "_id") out[k] = stripInternalIds(v);
    }
    return out;
  }
  return value;
}

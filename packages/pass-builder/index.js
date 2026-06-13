import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formStateToPassJson } from "./form-to-pass.js";
import { signPkpass } from "./sign.js";
import { validate } from "./validate.js";

export { formStateToPassJson, signPkpass, validate };
export { loadTemplate, applyTemplateData, templateFieldKeys, buildPkpassFromTemplate, stripInternalIds, mirrorTimeZoneAliases } from "./template.js";
export { seatSemantics, splitPersonName, BOARDING_SEMANTICS, SEMANTIC_CATALOG, REQUIRED_SEMANTICS, SEMANTIC_DATE_KEYS, TIMEZONE_KEY_ALIASES } from "./semantics.js";
export { discoverBindings, collectFields } from "./bindings.js";
export { suggestDisplayValues, formatSemanticValue } from "./suggest.js";

/**
 * One-shot: FormState → signed .pkpass Buffer.
 * @param {object} opts
 * @param {import("@wpd/pass-schema").FormState} opts.state
 * @param {string} opts.certDir
 * @param {string} [opts.passphrase]
 * @param {string} [opts.assetsDir]   — default "./assets"
 * @param {Record<string,unknown>} [opts.overrides] — server-controlled top-level
 *   pass.json values (serialNumber, passTypeIdentifier, teamIdentifier,
 *   authenticationToken, webServiceURL) that win over the FormState's own meta.
 */
export async function buildPkpass({ state, certDir, passphrase, assetsDir = "assets", overrides = {} }) {
  const v = validate(state);
  if (!v.ok) {
    const err = new Error("FormState failed schema validation");
    err.details = v.errors;
    throw err;
  }
  const passJson = formStateToPassJson(state);
  // Server identity wins over whatever the FormState carried. Notably webServiceURL:
  // the designer's dev default (http://localhost:4317/...) is not HTTPS, so iOS
  // refuses to install a pass that still carries it.
  for (const [k, val] of Object.entries(overrides)) if (val !== undefined) passJson[k] = val;
  const assetNames = ["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png"];
  /** @type {Record<string,Buffer>} */
  const assets = {};
  for (const name of assetNames) {
    try { assets[name] = await readFile(join(assetsDir, name)); } catch { /* optional */ }
  }
  return signPkpass({ certDir, passphrase, passJson, assets });
}

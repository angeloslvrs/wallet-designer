// Server-side binding-map access: stored map if one exists, otherwise
// discover from the template's pass.json and persist (covers templates that
// were installed before bindings existed — recomputed on first use; bundles
// on disk are never modified).

import { discoverBindings, templateFieldKeys, BOARDING_SEMANTICS } from "@wpd/pass-builder";
import { getTemplateBindings, saveTemplateBindings } from "./storage.js";

/**
 * @param {string} templateId
 * @param {object} passJson the template's (unmerged) pass.json
 * @returns {Promise<Record<string, {fieldKey: string, source: string, confidence: string}>>}
 */
export async function bindingsForTemplate(templateId, passJson) {
  const stored = await getTemplateBindings(templateId);
  if (stored) return stored;
  const discovered = discoverBindings(passJson);
  await saveTemplateBindings(templateId, discovered);
  return discovered;
}

/**
 * Validate a user-edited binding map ({semanticKey: fieldKey}) against the
 * vocabulary and the template's declared field keys; returns the storable
 * map. Throws with a user-facing message on any bad entry.
 * @param {object} body     {semanticKey: fieldKey} — null/"" entries are dropped (unbound)
 * @param {object} passJson the template's pass.json
 */
export function sanitizeBindingEdits(body, passJson) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("body must be an object of semanticKey → fieldKey");
  }
  const declared = new Set(templateFieldKeys(passJson));
  /** @type {Record<string, {fieldKey: string, source: string, confidence: string}>} */
  const out = {};
  for (const [semKey, fieldKey] of Object.entries(body)) {
    if (fieldKey === null || fieldKey === "") continue;     // explicit unbind
    if (!(semKey in BOARDING_SEMANTICS)) {
      throw new Error(`unknown semantic key: ${semKey}`);
    }
    if (typeof fieldKey !== "string" || !declared.has(fieldKey)) {
      throw new Error(`template does not declare field key "${fieldKey}" (for ${semKey})`);
    }
    out[semKey] = { fieldKey, source: "manual", confidence: "high" };
  }
  return out;
}

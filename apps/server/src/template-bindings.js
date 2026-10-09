// Server-side binding-map access: stored map if one exists, otherwise
// discover from the template's pass.json and persist (covers templates that
// were installed before bindings existed — recomputed on first use; bundles
// on disk are never modified).

import { discoverBindings, formStateToPassJson, migrateFormState, templateFieldKeys, BOARDING_SEMANTICS } from "@wpd/pass-builder";
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

// ---- Studio designs ----------------------------------------------------------
// A saved design's bindings live in the same table under "studio:<name>"
// (TEMPLATE_ID_RE forbids ":", so no bundle id can collide). Unlike bundles,
// nothing is persisted until the operator confirms: until then discovery runs
// live, so an unconverted design keeps tracking its own sample values as it's
// edited. Confirmed maps survive the values being cleared (an airline design).

/** The template_bindings id of a saved Studio design. */
export const studioBindingsId = (name) => `studio:${name}`;

/**
 * The design's raw binding surface: its pass.json with label tokens and 24h
 * time fields unresolved, so time fields still hold ISO dates.
 * @param {object} state the design's FormState
 */
export function designBindingSurface(state) {
  return formStateToPassJson(migrateFormState(state), { resolveFields: false });
}

/**
 * @param {string} name   saved design name
 * @param {object} surface {@link designBindingSurface} of the design
 * @returns {Promise<{bindings: Record<string, {fieldKey: string, source: string, confidence: string}>, saved: boolean}>}
 */
export async function bindingsForDesign(name, surface) {
  const stored = await getTemplateBindings(studioBindingsId(name));
  if (!stored) return { bindings: discoverBindings(surface), saved: false };
  // A field removed from the design since confirming drops out of the map
  // (filtered, not deleted — restoring the field restores the binding).
  const declared = new Set(templateFieldKeys(surface));
  return { bindings: Object.fromEntries(Object.entries(stored).filter(([, b]) => declared.has(b?.fieldKey))), saved: true };
}

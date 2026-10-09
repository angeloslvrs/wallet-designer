// Pass style dicts and their field zones. Dependency-free on purpose: the
// designer's browser bundle imports it (via field-render.js), so it must never
// pull in template.js's Node-only imports (fs, path, the signer).

export const STYLE_KEYS = ["boardingPass", "coupon", "eventTicket", "generic", "storeCard"];
export const FIELD_ZONES = ["headerFields", "primaryFields", "secondaryFields", "auxiliaryFields", "backFields", "additionalInfoFields"];

/** The style dict key ("boardingPass", …) of a pass.json, or undefined. */
export function styleKey(passJson) {
  return STYLE_KEYS.find(k => passJson?.[k] && typeof passJson[k] === "object");
}

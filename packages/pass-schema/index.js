import schema from "./schema.json" with { type: "json" };
export { schema };

/**
 * @typedef {Object} DisplayField
 * @property {string} key
 * @property {string} label
 * @property {string} value
 * @property {string} [dateStyle]
 * @property {string} [timeStyle]
 * @property {"24h"} [timeFormat]  value stays ISO; rendered "HH:mm" at emit
 * @property {boolean} [optional]  left off the pass while the value is blank
 * (label may carry {semanticKey} / {semanticKey:upper} tokens, resolved at emit)
 * @property {string} [changeMessage]
 */

/**
 * @typedef {Object} FormState  semantics-first boarding-pass design
 * (optional `services`: boarding-pass services page links — top-level pass.json keys)
 * @property {{passTypeId:string, teamId:string, organizationName:string, serialNumber:string, description:string, webServiceURL?:string, authenticationToken?:string, expirationDate?:string, groupId?:string}} meta
 * @property {{logoText:string, foregroundColor:string, backgroundColor:string, labelColor:string, logoDataUrl?:string, iconDataUrl?:string, footerDataUrl?:string, primaryLogoDataUrl?:string}} branding
 * @property {{format:string, message:string, altText:string}} barcode
 * @property {Record<string, *>} semantics  Apple semantic keys (SEMANTIC_CATALOG), filled-only; wifiAccess lives in iOS26.wifi
 * @property {{header:DisplayField[], primary:DisplayField[], secondary:DisplayField[], auxiliary:DisplayField[], back:DisplayField[]}} displayFields
 * @property {Object} [iOS26]  structural extras: additionalInfoFields, relevantDates, eventGuide, upcomingPassInformation, wifi
 */

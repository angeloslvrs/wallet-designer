import schema from "./schema.json" with { type: "json" };
export { schema };

/**
 * @typedef {Object} DisplayField
 * @property {string} key
 * @property {string} label
 * @property {string} value
 * @property {string} [dateStyle]
 * @property {string} [timeStyle]
 * @property {string} [changeMessage]
 */

/**
 * @typedef {Object} FormState  semantics-first boarding-pass design
 * @property {{passTypeId:string, teamId:string, organizationName:string, serialNumber:string, description:string, webServiceURL?:string, authenticationToken?:string, expirationDate?:string}} meta
 * @property {{logoText:string, foregroundColor:string, backgroundColor:string, labelColor:string, logoDataUrl?:string, iconDataUrl?:string, footerDataUrl?:string, primaryLogoDataUrl?:string}} branding
 * @property {{format:string, message:string, altText:string}} barcode
 * @property {Record<string, *>} semantics  Apple semantic keys (SEMANTIC_CATALOG), filled-only; wifiAccess lives in iOS26.wifi
 * @property {{header:DisplayField[], primary:DisplayField[], secondary:DisplayField[], auxiliary:DisplayField[], back:DisplayField[]}} displayFields
 * @property {Object} [iOS26]  structural extras: additionalInfoFields, relevantDates, eventGuide, upcomingPassInformation, wifi
 */

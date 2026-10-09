import { isEmptyTyped } from "./suggest-empty.js";
import { SEMANTIC_CATALOG, mirrorSemanticAliases } from "./semantics.js";
import { applyPassDates } from "./expiry.js";
import { resolvePassFields } from "./field-render.js";

/**
 * Pure: new-shape FormState -> Apple pass.json with full iOS 26 opt-in.
 * boardingPass.*Fields come verbatim from displayFields; semantics are spread
 * filled-only (both time-zone spellings mirrored, wifiAccess derived from the
 * iOS26.wifi bucket); the 5 iOS26 structural extras pass through. Label tokens
 * and timeFormat fields are resolved last (field-render.js) unless
 * `resolveFields: false` — the raw binding surface, where 24h time fields still
 * hold ISO dates so discovery and descriptors see them as dates.
 * @param {import("@wpd/pass-schema").FormState} s
 * @param {{resolveFields?: boolean}} [opts]
 */
export function formStateToPassJson(s, { resolveFields = true } = {}) {
  const { meta, branding, barcode } = s;
  const df = s.displayFields ?? {};
  const ios = s.iOS26 ?? {};

  const boardingPass = {
    transitType: "PKTransitTypeAir",
    headerFields: (df.header ?? []).map(f => ({ ...f })),
    primaryFields: (df.primary ?? []).map(f => ({ ...f })),
    secondaryFields: (df.secondary ?? []).map(f => ({ ...f })),
    auxiliaryFields: (df.auxiliary ?? []).map(f => ({ ...f })),
    backFields: (df.back ?? []).map(f => ({ ...f })),
    ...(ios.additionalInfoFields?.length && { additionalInfoFields: ios.additionalInfoFields })
  };

  const passJson = {
    formatVersion: 1,
    passTypeIdentifier: meta.passTypeId,
    teamIdentifier: meta.teamId,
    organizationName: meta.organizationName,
    serialNumber: meta.serialNumber,
    description: meta.description,
    logoText: branding.logoText,
    foregroundColor: branding.foregroundColor,
    backgroundColor: branding.backgroundColor,
    labelColor: branding.labelColor,
    preferredStyleSchemes: ["semanticBoardingPass", "boardingPass"],
    // Apple's live flight-data feed is authoritative over pushed semantics for a
    // recognized real flight — including departureGate, which it otherwise blanks
    // out until the airline's own feed reports a gate. Exclude it so our status
    // updates always win.
    liveDataConfiguration: { excludedSemantics: ["departureGate"] },
    barcodes: [{ format: barcode.format, message: barcode.message, messageEncoding: "iso-8859-1", altText: barcode.altText }],
    boardingPass,
    semantics: emitSemantics(s.semantics, ios.wifi),
    ...(ios.relevantDates?.length && { relevantDates: ios.relevantDates.map(d => ({ date: d, relevantDate: d })) }),
    ...(ios.eventGuide && stripUndef(ios.eventGuide)),
    ...(ios.upcomingPassInformation?.length && {
      upcomingPassInformation: ios.upcomingPassInformation.map(e => ({ identifier: e.identifier, name: e.name, type: "event", dateInformation: { date: e.date } }))
    }),
    // Services page (manage booking, change seat, Wi-Fi…): filled ones only.
    ...stripUndef(s.services ?? {}),
    ...(meta.webServiceURL && { webServiceURL: meta.webServiceURL }),
    ...(meta.authenticationToken && { authenticationToken: meta.authenticationToken })
  };

  const dated = applyPassDates(passJson, { expirationDate: meta.expirationDate });
  return resolveFields ? resolvePassFields(dated) : dated;
}

/** Filled-only semantics (per catalog type), with doc + proto spellings + wifiAccess. */
function emitSemantics(semantics = {}, wifi) {
  const out = {};
  for (const [k, v] of Object.entries(semantics)) {
    const type = SEMANTIC_CATALOG[k]?.type ?? "text";
    if (!isEmptyTyped(type, v)) out[k] = v;
  }
  // Doc and proto spellings (time zones, security programs, SSRs, lounge) both ship.
  const mirrored = mirrorSemanticAliases(out);
  if (wifi?.length) mirrored.wifiAccess = wifi.map(w => ({ ssid: w.ssid, ...(w.password && { password: w.password }) }));
  return mirrored;
}

function stripUndef(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") out[k] = v;
  return out;
}

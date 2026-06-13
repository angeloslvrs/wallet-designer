import { isEmptyTyped } from "./suggest-empty.js";
import { SEMANTIC_CATALOG, TIMEZONE_KEY_ALIASES } from "./semantics.js";

/**
 * Pure: new-shape FormState -> Apple pass.json with full iOS 26 opt-in.
 * boardingPass.*Fields come verbatim from displayFields; semantics are spread
 * filled-only (both time-zone spellings mirrored, wifiAccess derived from the
 * iOS26.wifi bucket); the 5 iOS26 structural extras pass through.
 * @param {import("@wpd/pass-schema").FormState} s
 */
export function formStateToPassJson(s) {
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

  return {
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
    preferredStyleSchemes: ["semanticBoardingPass"],
    barcodes: [{ format: barcode.format, message: barcode.message, messageEncoding: "iso-8859-1", altText: barcode.altText }],
    boardingPass,
    semantics: emitSemantics(s.semantics, ios.wifi),
    ...(ios.relevantDates?.length && { relevantDates: ios.relevantDates.map(d => ({ date: d, relevantDate: d })) }),
    ...(ios.eventGuide && stripUndef(ios.eventGuide)),
    ...(ios.upcomingPassInformation?.length && {
      upcomingPassInformation: ios.upcomingPassInformation.map(e => ({ identifier: e.identifier, name: e.name, type: "event", dateInformation: { date: e.date } }))
    }),
    ...(meta.webServiceURL && { webServiceURL: meta.webServiceURL }),
    ...(meta.authenticationToken && { authenticationToken: meta.authenticationToken })
  };
}

/** Filled-only semantics (per catalog type), with both tz spellings + wifiAccess. */
function emitSemantics(semantics = {}, wifi) {
  const out = {};
  for (const [k, v] of Object.entries(semantics)) {
    const type = SEMANTIC_CATALOG[k]?.type ?? "text";
    if (!isEmptyTyped(type, v)) out[k] = v;
  }
  for (const [docKey, airportKey] of Object.entries(TIMEZONE_KEY_ALIASES)) {
    if (out[docKey] && !out[airportKey]) out[airportKey] = out[docKey];
    else if (out[airportKey] && !out[docKey]) out[docKey] = out[airportKey];
  }
  if (wifi?.length) out.wifiAccess = wifi.map(w => ({ ssid: w.ssid, ...(w.password && { password: w.password }) }));
  return out;
}

function stripUndef(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") out[k] = v;
  return out;
}

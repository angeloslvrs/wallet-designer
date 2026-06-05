import { formatFieldValue } from "./format.js";

const mapFields = (arr) => (arr ?? []).map(f => ({
  key: f.key,
  label: f.label ?? "",
  value: formatFieldValue(f)
}));

/**
 * Pure adapter: the signed pass.json → a formatted view-model for the faithful preview.
 * Reads the same arrays iOS lays out, so preview == shipped pass.
 * @param {object} pass  output of formStateToPassJson
 */
export function toPassView(pass) {
  const bp = pass.boardingPass ?? {};
  const bc = pass.barcodes?.[0] ?? null;
  return {
    logoText: pass.logoText ?? "",
    colors: {
      bg: pass.backgroundColor ?? "rgb(0,0,0)",
      fg: pass.foregroundColor ?? "rgb(255,255,255)",
      label: pass.labelColor ?? pass.foregroundColor ?? "rgb(255,255,255)"
    },
    header: mapFields(bp.headerFields),
    primary: mapFields(bp.primaryFields),
    secondary: mapFields(bp.secondaryFields),
    auxiliary: mapFields(bp.auxiliaryFields),
    back: mapFields(bp.backFields),
    additional: mapFields(bp.additionalInfoFields),
    barcode: bc ? { format: bc.format, message: bc.message, altText: bc.altText ?? "" } : null
  };
}

// Single source of truth for the Designer's branding image slots: which
// FormState `branding` key carries each Apple pass image, its on-disk slot
// filename, and the label shown in the Designer form. Imported by both the
// builder (to emit bytes) and apps/designer/src/form.js (to render inputs).
//
// Boarding passes render only logo, icon, footer (+ iOS 26 primaryLogo) — no
// strip/thumbnail/background.

/** @type {Array<{key:string, slot:string, label:string}>} */
export const BRANDING_IMAGE_SLOTS = [
  { key: "logoDataUrl",        slot: "logo",        label: "Logo (top-left)" },
  { key: "iconDataUrl",        slot: "icon",        label: "Icon — lock screen & Mail (required by iOS)" },
  { key: "footerDataUrl",      slot: "footer",      label: "Footer (above the barcode)" },
  { key: "primaryLogoDataUrl", slot: "primaryLogo", label: "Primary logo (iOS 26 expanded view)" }
];

const DATA_URL_RE = /^data:image\/png;base64,([a-z0-9+/=\s]+)$/i;

/**
 * Decode every uploaded branding image into PNG bundle entries.
 * Writes identical bytes to base/@2x/@3x (dimensions are not downscaled — iOS
 * scales to fit and no Apple validator enforces image dimensions).
 * @param {object|undefined} branding  FormState.branding
 * @returns {Record<string, Buffer>}  filename → bytes (new object; input untouched)
 */
export function imageAssetsFromBranding(branding) {
  /** @type {Record<string, Buffer>} */
  const out = {};
  if (!branding || typeof branding !== "object") return out;
  for (const { key, slot } of BRANDING_IMAGE_SLOTS) {
    const val = branding[key];
    if (typeof val !== "string" || !val) continue;
    const m = DATA_URL_RE.exec(val.trim());
    if (!m) continue;
    const buf = Buffer.from(m[1].replace(/\s+/g, ""), "base64");
    if (!buf.length) continue;
    out[`${slot}.png`] = buf;
    out[`${slot}@2x.png`] = buf;
    out[`${slot}@3x.png`] = buf;
  }
  return out;
}

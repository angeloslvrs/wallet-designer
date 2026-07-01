// bwip-js is ~900 kB — by far the app's biggest dependency. The Designer preview
// draws a barcode on first paint, but we don't want the encoder in the entry
// chunk: it's lazily imported the first time a barcode is actually rendered, then
// cached. renderBarcode returns its container synchronously (unchanged contract)
// and fills the barcode in once the encoder resolves.
let bwipPromise = null;
function loadBwip() {
  bwipPromise ??= import("bwip-js").then(m => m.default);
  return bwipPromise;
}

const FORMAT_MAP = {
  PKBarcodeFormatPDF417: "pdf417",
  PKBarcodeFormatQR: "qrcode",
  PKBarcodeFormatAztec: "azteccode",
  PKBarcodeFormatCode128: "code128"
};

// 2-D square symbologies render compact + centered (≈116px, the way Wallet
// shows them); linear codes span the strip width and stay short. Sizing the
// canvas the same for both made square codes balloon to the strip width.
const SQUARE_TYPES = new Set(["qrcode", "azteccode"]);

/**
 * Map an Apple PassKit barcode format to a bwip-js symbology id.
 * @param {string} passKitFormat
 * @returns {string|null}
 */
export function passKitToBwipType(passKitFormat) {
  return FORMAT_MAP[passKitFormat] ?? null;
}

/**
 * Render a barcode into a <canvas>. On any failure (unknown format, empty
 * message, encode error) returns a neutral placeholder element instead of throwing.
 * @param {{format:string, message:string, altText?:string}} barcode
 * @returns {HTMLElement}
 */
export function renderBarcode(barcode) {
  const type = passKitToBwipType(barcode?.format);
  if (!type || !barcode?.message) return placeholder(barcode?.altText, barcode?.format);
  const shape = SQUARE_TYPES.has(type) ? "square" : "linear";
  const canvas = document.createElement("canvas");
  canvas.className = `wallet-barcode-canvas wallet-barcode-canvas--${shape}`;
  // Draw once the (lazily-loaded, then cached) encoder is available. On any
  // failure the caller's strip just holds an empty canvas — same visual as the
  // previous try/catch fallback would have produced for an encode error.
  loadBwip().then(bwipjs => {
    try {
      bwipjs.toCanvas(canvas, {
        bcid: type,
        text: barcode.message,
        scale: 2,
        includetext: false,
        ...(type === "pdf417" ? { columns: 6 } : {}),
        paddingwidth: 0,
        paddingheight: 0
      });
    } catch { /* leave the blank canvas as the fallback */ }
  }).catch(() => { /* encoder unavailable — leave the blank canvas */ });
  return canvas;
}

function placeholder(altText, format) {
  const type = passKitToBwipType(format);
  const shape = type && SQUARE_TYPES.has(type) ? "square" : "linear";
  const d = document.createElement("div");
  d.className = `wallet-barcode-placeholder wallet-barcode-placeholder--${shape}`;
  d.textContent = altText || "barcode";
  return d;
}

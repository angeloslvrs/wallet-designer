import bwipjs from "bwip-js";

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
  try {
    const canvas = document.createElement("canvas");
    bwipjs.toCanvas(canvas, {
      bcid: type,
      text: barcode.message,
      scale: 2,
      includetext: false,
      ...(type === "pdf417" ? { columns: 6 } : {}),
      paddingwidth: 0,
      paddingheight: 0
    });
    const shape = SQUARE_TYPES.has(type) ? "square" : "linear";
    canvas.className = `wallet-barcode-canvas wallet-barcode-canvas--${shape}`;
    return canvas;
  } catch {
    return placeholder(barcode?.altText, barcode?.format);
  }
}

function placeholder(altText, format) {
  const type = passKitToBwipType(format);
  const shape = type && SQUARE_TYPES.has(type) ? "square" : "linear";
  const d = document.createElement("div");
  d.className = `wallet-barcode-placeholder wallet-barcode-placeholder--${shape}`;
  d.textContent = altText || "barcode";
  return d;
}

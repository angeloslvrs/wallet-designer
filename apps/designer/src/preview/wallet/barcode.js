import bwipjs from "bwip-js";

const FORMAT_MAP = {
  PKBarcodeFormatPDF417: "pdf417",
  PKBarcodeFormatQR: "qrcode",
  PKBarcodeFormatAztec: "azteccode",
  PKBarcodeFormatCode128: "code128"
};

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
  if (!type || !barcode?.message) return placeholder(barcode?.altText);
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
    canvas.className = "wallet-barcode-canvas";
    return canvas;
  } catch {
    return placeholder(barcode?.altText);
  }
}

function placeholder(altText) {
  const d = document.createElement("div");
  d.className = "wallet-barcode-placeholder";
  d.textContent = altText || "barcode";
  return d;
}

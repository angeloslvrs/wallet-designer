import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison. Returns false on a length mismatch without
 * leaking position via early character comparison. The length itself is not a
 * meaningful secret for the fixed-shape tokens/credentials we compare here.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function timingSafeStrEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

import { createHash } from "node:crypto";

/**
 * Compute the Apple Wallet manifest.json content: { filename: sha1-hex, ... }
 * @param {Record<string, Buffer>} files
 * @returns {Record<string, string>}
 */
export function computeManifest(files) {
  /** @type {Record<string,string>} */
  const m = {};
  for (const [name, buf] of Object.entries(files)) {
    m[name] = createHash("sha1").update(buf).digest("hex");
  }
  return m;
}

import { PKPass } from "passkit-generator";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * @param {object} opts
 * @param {string} opts.certDir       — e.g. "certs/dev"
 * @param {string} [opts.passphrase]
 * @param {object} opts.passJson      — full pass.json object
 * @param {Record<string, Buffer>} opts.assets — { "icon.png": Buffer, ... }
 * @returns {Promise<Buffer>} the signed .pkpass bytes
 */
export async function signPkpass({ certDir, passphrase, passJson, assets }) {
  const [signerCert, signerKey, wwdr] = await Promise.all([
    readFile(join(certDir, "signerCert.pem")),
    readFile(join(certDir, "signerKey.pem")),
    readFile(join(certDir, "wwdr.pem"))
  ]);

  const pass = new PKPass(
    { "pass.json": Buffer.from(JSON.stringify(passJson)), ...assets },
    { signerCert, signerKey, wwdr, signerKeyPassphrase: passphrase ?? "" }
  );

  return pass.getAsBuffer();
}

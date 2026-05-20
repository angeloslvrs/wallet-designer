import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import forge from "node-forge";
import archiver from "archiver";

/**
 * Sign and bundle a .pkpass by hand. We bypass passkit-generator's PKPass
 * because its pass.json round-trip strips fields the iOS 26 schema introduced
 * (e.g. `boardingPass.additionalInfoFields`). This keeps every key we put on
 * pass.json verbatim.
 *
 * @param {object} opts
 * @param {string} opts.certDir
 * @param {string} [opts.passphrase]
 * @param {object} opts.passJson
 * @param {Record<string, Buffer>} opts.assets
 * @returns {Promise<Buffer>}
 */
export async function signPkpass({ certDir, passphrase, passJson, assets }) {
  const [signerCertPem, signerKeyPem, wwdrPem] = await Promise.all([
    readFile(join(certDir, "signerCert.pem"), "utf8"),
    readFile(join(certDir, "signerKey.pem"), "utf8"),
    readFile(join(certDir, "wwdr.pem"), "utf8")
  ]);

  const passJsonBuf = Buffer.from(JSON.stringify(passJson));
  const files = { "pass.json": passJsonBuf, ...assets };

  // 1. manifest.json — SHA1 hex of each file
  const manifest = {};
  for (const [name, buf] of Object.entries(files)) {
    manifest[name] = createHash("sha1").update(buf).digest("hex");
  }
  const manifestBuf = Buffer.from(JSON.stringify(manifest));

  // 2. signature — PKCS#7 detached signature of manifest
  const signatureBuf = signManifest(manifestBuf, { signerCertPem, signerKeyPem, wwdrPem, passphrase });

  // 3. zip everything
  return zipPkpass({ ...files, "manifest.json": manifestBuf, signature: signatureBuf });
}

function signManifest(manifestBuf, { signerCertPem, signerKeyPem, wwdrPem, passphrase }) {
  const signerCert = forge.pki.certificateFromPem(signerCertPem);
  const wwdr = forge.pki.certificateFromPem(wwdrPem);
  const signerKey = passphrase
    ? forge.pki.decryptRsaPrivateKey(signerKeyPem, passphrase)
    : forge.pki.privateKeyFromPem(signerKeyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = new forge.util.ByteStringBuffer(manifestBuf);
  p7.addCertificate(wwdr);
  p7.addCertificate(signerCert);
  p7.addSigner({
    key: signerKey,
    certificate: signerCert,
    digestAlgorithm: forge.pki.oids.sha1,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime }
    ]
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary");
}

async function zipPkpass(files) {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const sink = new PassThrough();
    const chunks = [];
    sink.on("data", c => chunks.push(c));
    sink.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    archive.pipe(sink);
    for (const [name, buf] of Object.entries(files)) {
      archive.append(buf, { name });
    }
    archive.finalize();
  });
}

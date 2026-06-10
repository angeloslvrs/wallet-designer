// Read an uploaded, zipped .pkpasstemplate into a sanitized {path → Buffer}
// map, safe to write under the server's templates directory.

import AdmZip from "adm-zip";

// Root-level files regenerated at build time — never accepted from an upload.
const STALE_ROOT_FILES = new Set(["manifest.json", "signature"]);
// Templates are a pass.json + a handful of images; anything bigger than this
// uncompressed is a zip bomb, not a template.
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_WRAPPER_DEPTH = 8;

/**
 * @param {Buffer} buf
 * @returns {Record<string, Buffer>}
 */
export function readTemplateZip(buf) {
  let zip;
  try {
    zip = new AdmZip(buf);
  } catch (err) {
    throw new Error(`not a readable zip: ${err.message ?? err}`);
  }

  const entries = zip.getEntries()
    .filter(e => !e.isDirectory)
    .map(e => ({ name: e.entryName.replaceAll("\\", "/"), entry: e }))
    .filter(({ name }) => {
      const parts = name.split("/");
      return name && !parts.includes("__MACOSX") && parts.at(-1) !== ".DS_Store";
    });

  // Reject traversal before any normalization — a hostile name stays hostile.
  for (const { name } of entries) {
    if (name.startsWith("/") || /^[a-zA-Z]:/.test(name) || name.split("/").includes("..")) {
      throw new Error(`zip entry escapes the template directory: ${name}`);
    }
  }

  // macOS zips a bundle as "Flight.pkpasstemplate/…" — peel shared wrapper
  // folders until pass.json sits at the root.
  let names = entries.map(({ name }) => name);
  for (let depth = 0; depth < MAX_WRAPPER_DEPTH && !names.includes("pass.json"); depth++) {
    const roots = new Set(names.map(n => n.split("/")[0]));
    if (roots.size !== 1 || !names.every(n => n.includes("/"))) break;
    names = names.map(n => n.slice(n.indexOf("/") + 1));
  }

  /** @type {Record<string, Buffer>} */
  const files = {};
  let total = 0;
  entries.forEach(({ entry }, i) => {
    const name = names[i];
    if (!name || STALE_ROOT_FILES.has(name)) return;
    const data = entry.getData();
    total += data.length;
    if (total > MAX_UNCOMPRESSED_BYTES) {
      throw new Error(`zip expands past ${MAX_UNCOMPRESSED_BYTES} bytes — not accepting it as a template`);
    }
    files[name] = data;
  });

  if (!files["pass.json"]) {
    throw new Error("zip does not contain a pass.json — expected a zipped .pkpasstemplate bundle");
  }
  try {
    JSON.parse(files["pass.json"].toString("utf8"));
  } catch (err) {
    throw new Error(`pass.json in the zip did not parse: ${err.message}`);
  }
  return files;
}

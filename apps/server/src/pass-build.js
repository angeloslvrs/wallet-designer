// One place that turns a stored pass record into a signed .pkpass, whichever
// shape it has: FormState-backed (rec.state) or template-backed
// (rec.template + rec.data). Both the wallet web service and the admin
// download route build through here so an updated pass always serves the same
// bytes either way.

import { join } from "node:path";
import { buildPkpass, buildPkpassFromTemplate, migrateFormState } from "@wpd/pass-builder";
import { env } from "./env.js";

export const TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9-]*$/i;

// Read lazily (not at import) so tests can point TEMPLATES_DIR at a tmpdir.
export function templatesRoot() {
  return process.env.TEMPLATES_DIR ?? "templates";
}

/** Disk directory for a template id. Throws on ids that could leave the root. */
export function templateDir(id) {
  if (!TEMPLATE_ID_RE.test(id)) throw new Error(`invalid template id: ${id}`);
  return join(templatesRoot(), `${id}.pkpasstemplate`);
}

/**
 * @param {object} rec     stored pass record from storage.js
 * @param {string} serial  the record's serialNumber (storage keys it externally)
 * @returns {Promise<Buffer>}
 */
export async function buildStoredPass(rec, serial) {
  if (rec.template) {
    return buildPkpassFromTemplate({
      templateDir: templateDir(rec.template),
      data: rec.data ?? {},
      // Server-controlled identity — never trusted from the template bundle.
      overrides: {
        serialNumber: serial,
        passTypeIdentifier: rec.passTypeIdentifier,
        authenticationToken: rec.authenticationToken,
        ...(process.env.TEAM_ID && { teamIdentifier: process.env.TEAM_ID }),
        ...(process.env.WEB_SERVICE_URL && { webServiceURL: process.env.WEB_SERVICE_URL })
      },
      certDir: env.certDir,
      passphrase: env.passphrase
    });
  }
  return buildPkpass({
    state: migrateFormState(rec.state),
    certDir: env.certDir,
    passphrase: env.passphrase,
    // Same server-controlled identity the template path forces. Without it a
    // FormState pass keeps the designer's dev webServiceURL (http://localhost),
    // which iOS rejects at install, plus any stale team id / token in the state.
    overrides: {
      serialNumber: serial,
      ...(rec.passTypeIdentifier && { passTypeIdentifier: rec.passTypeIdentifier }),
      ...(rec.authenticationToken && { authenticationToken: rec.authenticationToken }),
      ...(process.env.TEAM_ID && { teamIdentifier: process.env.TEAM_ID }),
      ...(process.env.WEB_SERVICE_URL && { webServiceURL: process.env.WEB_SERVICE_URL })
    }
  });
}

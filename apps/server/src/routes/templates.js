// Manage .pkpasstemplate bundles: list what's installed, upload a new one.
// Upload exists so a Pass Designer export can go Mac → server without shell
// access: zip the bundle, POST the zip as the raw request body.
// Control plane: the access guard keeps this LAN/Basic-Auth only.

import { raw, Router } from "express";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { loadTemplate, templateFieldKeys } from "@wpd/pass-builder";
import { readTemplateZip } from "@wpd/pass-builder/template-zip.js";
import { TEMPLATE_ID_RE, templateDir, templatesRoot } from "../pass-build.js";

export const templatesRouter = Router();

const BUNDLE_SUFFIX = ".pkpasstemplate";

// GET /api/templates — installed templates and their merge surface (field keys)
templatesRouter.get("/templates", async (_req, res) => {
  let names = [];
  try { names = await readdir(templatesRoot()); } catch { /* no templates yet */ }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(BUNDLE_SUFFIX)) continue;
    const id = name.slice(0, -BUNDLE_SUFFIX.length);
    try {
      const { passJson, assets } = await loadTemplate(join(templatesRoot(), name));
      out.push({
        id,
        description: passJson.description,
        organizationName: passJson.organizationName,
        fieldKeys: templateFieldKeys(passJson),
        assets: Object.keys(assets)
      });
    } catch (err) {
      out.push({ id, error: err.message });
    }
  }
  res.json(out);
});

/** POST /api/templates/:id — body is the zipped .pkpasstemplate itself. */
export async function handleTemplateUpload(req, res) {
  const { id } = req.params;
  if (!TEMPLATE_ID_RE.test(id ?? "")) {
    return res.status(400).json({ error: 'template id must be a slug like "summer-2026" (letters, digits, dashes)' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: "send the zipped .pkpasstemplate as the raw request body (Content-Type: application/zip)" });
  }
  try {
    const files = readTemplateZip(req.body);
    const dir = templateDir(id);
    // Replace wholesale — a re-upload must not leave stale assets behind.
    await rm(dir, { recursive: true, force: true });
    const root = resolve(dir);
    for (const [name, buf] of Object.entries(files)) {
      const dest = resolve(join(dir, name));
      // Independent of readTemplateZip's own checks: nothing escapes the bundle dir.
      if (dest !== root && !dest.startsWith(root + sep)) {
        throw new Error(`zip entry escapes the template directory: ${name}`);
      }
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buf);
    }
    const { passJson } = await loadTemplate(dir);
    res.status(201).json({ id, fieldKeys: templateFieldKeys(passJson), files: Object.keys(files) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

templatesRouter.post("/templates/:id", raw({ type: () => true, limit: "20mb" }), handleTemplateUpload);

// Manage .pkpasstemplate bundles: list what's installed, upload a new one.
// Upload exists so a Pass Designer export can go Mac → server without shell
// access: zip the bundle, POST the zip as the raw request body.
// Control plane: the access guard keeps this LAN/Basic-Auth only.

import { raw, Router } from "express";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import { discoverBindings, loadTemplate, templateFieldKeys, templateFieldDescriptors } from "@wpd/pass-builder";
import { readTemplateZip } from "@wpd/pass-builder/template-zip.js";
import { TEMPLATE_ID_RE, templateDir, templatesRoot } from "../pass-build.js";
import { deleteTemplateBindings, saveTemplateBindings, snapshot } from "../storage.js";
import { bindingsForTemplate, sanitizeBindingEdits } from "../template-bindings.js";
import { asyncHandler } from "../util/async-handler.js";

export const templatesRouter = Router();

const BUNDLE_SUFFIX = ".pkpasstemplate";

// GET /api/templates — installed templates and their merge surface (field keys +
// the baked semantics block, which the semantics-first editor pre-fills from).
export async function handleTemplateList(_req, res) {
  let names = [];
  try { names = await readdir(templatesRoot()); } catch { /* no templates yet */ }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(BUNDLE_SUFFIX)) continue;
    const id = name.slice(0, -BUNDLE_SUFFIX.length);
    try {
      const { passJson, assets } = await loadTemplate(join(templatesRoot(), name));
      const bindings = await bindingsForTemplate(id, passJson);
      out.push({
        id,
        description: passJson.description,
        organizationName: passJson.organizationName,
        fieldKeys: templateFieldKeys(passJson),
        // Descriptors resolve each field's validation kind through the bindings
        // (semantics → kind), so the issue UI and server validate identically.
        fields: templateFieldDescriptors(passJson, bindings),
        bindings,
        semantics: passJson.semantics ?? {},
        assets: Object.keys(assets)
      });
    } catch (err) {
      out.push({ id, error: err.message });
    }
  }
  res.json(out);
}
templatesRouter.get("/templates", asyncHandler(handleTemplateList));

/** POST /api/templates/:id — body is the zipped .pkpasstemplate itself. */
export async function handleTemplateUpload(req, res) {
  const { id } = req.params;
  if (!TEMPLATE_ID_RE.test(id ?? "")) {
    return res.status(400).json({ error: 'template id must be a slug like "summer-2026" (letters, digits, dashes)' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: "send the zipped .pkpasstemplate as the raw request body (Content-Type: application/zip)" });
  }
  const dir = templateDir(id);
  // Stage the new bundle in a sibling temp dir (same filesystem, so the final
  // rename is atomic) and validate it there. A re-upload must not touch the
  // existing bundle until the replacement is proven loadable — a mid-write
  // failure would otherwise brick every already-issued pass that rebuilds from
  // it on device fetch (there'd be NO bundle on disk).
  const tmpDir = join(templatesRoot(), `.tmp-${id}-${randomBytes(6).toString("hex")}`);
  try {
    const files = readTemplateZip(req.body);
    const root = resolve(tmpDir);
    for (const [name, buf] of Object.entries(files)) {
      const dest = resolve(join(tmpDir, name));
      // Independent of readTemplateZip's own checks: nothing escapes the bundle dir.
      if (dest !== root && !dest.startsWith(root + sep)) {
        throw new Error(`zip entry escapes the template directory: ${name}`);
      }
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buf);
    }
    // Validate by actually loading the staged bundle — if this throws, the
    // existing bundle is still on disk and untouched.
    const { passJson } = await loadTemplate(tmpDir);
    // (Re-)discover bindings for the fresh bundle — a re-upload may have
    // renamed field keys, so stored bindings are recomputed, not kept.
    const bindings = discoverBindings(passJson);
    // Swap last, and as narrow a window as possible: drop the old bundle
    // (replace wholesale — no stale assets survive) then rename the staged one
    // into place, back-to-back.
    await rm(dir, { recursive: true, force: true });
    await rename(tmpDir, dir);
    await saveTemplateBindings(id, bindings);
    res.status(201).json({ id, fieldKeys: templateFieldKeys(passJson), bindings, files: Object.keys(files) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    // Clean up the staging dir if it survived (i.e. the swap never renamed it away).
    await rm(tmpDir, { recursive: true, force: true });
  }
}

templatesRouter.post("/templates/:id", raw({ type: () => true, limit: "20mb" }), asyncHandler(handleTemplateUpload));

/**
 * DELETE /api/templates/:id — refuse (409) while any stored pass references
 * the template: installed passes rebuild from their bundle on every device
 * fetch, so deleting a referenced one breaks passes already on phones.
 */
export async function handleTemplateDelete(req, res) {
  const { id } = req.params;
  if (!TEMPLATE_ID_RE.test(id ?? "")) {
    return res.status(400).json({ error: 'template id must be a slug like "summer-2026" (letters, digits, dashes)' });
  }
  const dir = templateDir(id);
  try { await stat(dir); } catch { return res.status(404).json({ error: `no template "${id}" installed` }); }

  const snap = await snapshot();
  const serials = Object.entries(snap.passes)
    .filter(([, rec]) => rec.template === id)
    .map(([serial]) => serial);
  if (serials.length) {
    return res.status(409).json({
      error: `template "${id}" is referenced by ${serials.length} issued pass(es) — installed passes rebuild from it on every fetch; delete those passes first`,
      serials
    });
  }

  await rm(dir, { recursive: true, force: true });
  await deleteTemplateBindings(id);
  res.status(200).json({ ok: true, id });
}

templatesRouter.delete("/templates/:id", asyncHandler(handleTemplateDelete));

/**
 * PUT /api/templates/:id/bindings — replace the template's semanticKey →
 * fieldKey map with user-confirmed bindings ({semanticKey: fieldKey}; null or
 * "" unbinds). Unbound semantics are informational, never an error.
 */
export async function handleBindingsSave(req, res) {
  const { id } = req.params;
  if (!TEMPLATE_ID_RE.test(id ?? "")) {
    return res.status(400).json({ error: 'template id must be a slug like "summer-2026" (letters, digits, dashes)' });
  }
  let passJson;
  try { ({ passJson } = await loadTemplate(templateDir(id))); }
  catch { return res.status(404).json({ error: `no template "${id}" installed` }); }
  try {
    const bindings = sanitizeBindingEdits(req.body, passJson);
    await saveTemplateBindings(id, bindings);
    res.json({ id, bindings });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

templatesRouter.put("/templates/:id/bindings", asyncHandler(handleBindingsSave));

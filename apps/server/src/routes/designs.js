// Saved Studio designs: FormState snapshots the operator saves from the Design
// view, shown on the Templates shelf as `kind: "studio"` templates. They live in
// designs/ (gitignored user data) — NOT fixtures/, which holds CI's tracked
// regression fixtures and is exposed read-only via /api/fixtures.
// Control plane: the access guard keeps this LAN/Basic-Auth only.

import { Router } from "express";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { asyncHandler } from "../util/async-handler.js";
import { deleteTemplateBindings, saveTemplateBindings } from "../storage.js";
import { designBindingSurface, sanitizeBindingEdits, studioBindingsId } from "../template-bindings.js";
import { routesReferencing } from "./flight-routes.js";

export const designsRouter = Router();

// Read lazily (not at import) so tests can point DESIGNS_DIR at a tmpdir.
export function designsRoot() {
  return process.env.DESIGNS_DIR ?? "designs";
}

// A design name is a file stem: no path separators, no leading dot.
export const DESIGN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const fileOf = (name) => join(designsRoot(), `${name}.json`);

/** Names of all saved designs, sorted. A missing designs/ folder is just empty. */
export async function listDesignNames() {
  let files = [];
  try { files = await readdir(designsRoot()); } catch { /* none saved yet */ }
  return files.filter(f => f.endsWith(".json")).map(f => f.slice(0, -".json".length)).filter(n => DESIGN_NAME_RE.test(n)).sort();
}

/** The parsed FormState of a saved design, or null if there's no such design. */
export async function readDesign(name) {
  if (!DESIGN_NAME_RE.test(name ?? "")) return null;
  try { return JSON.parse(await readFile(fileOf(name), "utf8")); }
  catch (err) { if (err.code === "ENOENT") return null; throw err; }
}

export async function handleDesignList(_req, res) {
  res.json(await listDesignNames());
}

export async function handleDesignGet(req, res) {
  const { name } = req.params;
  if (!DESIGN_NAME_RE.test(name ?? "")) return res.status(400).json({ error: "invalid design name" });
  const state = await readDesign(name);
  if (!state) return res.status(404).json({ error: `design not found: ${name}` });
  res.json(state);
}

export async function handleDesignPut(req, res) {
  const { name } = req.params;
  if (!DESIGN_NAME_RE.test(name ?? "")) {
    return res.status(400).json({ error: 'design name must start with a letter or digit and use only letters, digits, ".", "_" or "-" (max 64)' });
  }
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ error: "send the design's FormState as a JSON object" });
  await mkdir(designsRoot(), { recursive: true });
  const existed = (await readDesign(name)) !== null;
  // Write-then-rename so a crash mid-write never leaves a truncated design.
  const tmp = join(designsRoot(), `.${name}.${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(tmp, JSON.stringify(body, null, 2));
  await rename(tmp, fileOf(name));
  res.status(existed ? 200 : 201).json({ ok: true, name, created: !existed });
}

export async function handleDesignDelete(req, res) {
  const { name } = req.params;
  if (!DESIGN_NAME_RE.test(name ?? "")) return res.status(400).json({ error: "invalid design name" });
  // Routes build on the design live; refuse while any is attached.
  const routes = await routesReferencing("studio", name);
  if (routes.length) return res.status(409).json({ error: `design "${name}" has ${routes.length} route(s) — delete or move them first`, routes });
  try { await unlink(fileOf(name)); }
  catch (err) { if (err.code === "ENOENT") return res.status(404).json({ error: `design not found: ${name}` }); throw err; }
  await deleteTemplateBindings(studioBindingsId(name));
  res.json({ ok: true });
}

/**
 * PUT /api/designs/:name/bindings — confirm the design's semanticKey → fieldKey
 * map ({semanticKey: fieldKey}; null or "" unbinds). Stored entries are
 * `manual`/`high` and survive the design's sample values being cleared.
 */
export async function handleDesignBindingsPut(req, res) {
  const { name } = req.params;
  if (!DESIGN_NAME_RE.test(name ?? "")) return res.status(400).json({ error: "invalid design name" });
  const state = await readDesign(name);
  if (!state) return res.status(404).json({ error: `design not found: ${name}` });
  try {
    const bindings = sanitizeBindingEdits(req.body, designBindingSurface(state));
    await saveTemplateBindings(studioBindingsId(name), bindings);
    res.json({ name, bindings });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/** DELETE /api/designs/:name/bindings — forget confirmed bindings (back to live discovery). */
export async function handleDesignBindingsDelete(req, res) {
  const { name } = req.params;
  if (!DESIGN_NAME_RE.test(name ?? "")) return res.status(400).json({ error: "invalid design name" });
  await deleteTemplateBindings(studioBindingsId(name));
  res.json({ ok: true });
}

designsRouter.get("/designs", asyncHandler(handleDesignList));
designsRouter.get("/designs/:name", asyncHandler(handleDesignGet));
designsRouter.put("/designs/:name", asyncHandler(handleDesignPut));
designsRouter.delete("/designs/:name", asyncHandler(handleDesignDelete));
designsRouter.put("/designs/:name/bindings", asyncHandler(handleDesignBindingsPut));
designsRouter.delete("/designs/:name/bindings", asyncHandler(handleDesignBindingsDelete));

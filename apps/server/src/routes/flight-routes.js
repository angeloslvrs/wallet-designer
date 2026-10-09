// Saved routes (Airline › Route › Flight): the reusable part of a flight —
// identity, airports, times of day — attached to an airline template (a Studio
// design or a Pass Designer bundle). JSON files in routes/ (gitignored user
// data, like designs/). Issuing from a route picks the date (the Flight on the
// board) and passengers. Control plane: the access guard keeps this LAN-only.

import { Router } from "express";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { ROUTE_ID_RE, validateRoute } from "@wpd/pass-builder";
import { readDesign } from "./designs.js";
import { TEMPLATE_ID_RE, templateDir } from "../pass-build.js";
import { asyncHandler } from "../util/async-handler.js";

export const flightRoutesRouter = Router();

// Read lazily (not at import) so tests can point ROUTES_DIR at a tmpdir.
export function routesRoot() {
  return process.env.ROUTES_DIR ?? "routes";
}
const fileOf = (id) => join(routesRoot(), `${id}.json`);

/** Every saved route ({id, ...route}), sorted by id. A missing routes/ is empty. */
export async function listRoutes() {
  let files = [];
  try { files = await readdir(routesRoot()); } catch { /* none saved yet */ }
  const out = [];
  for (const f of files.filter(f => f.endsWith(".json")).sort()) {
    const id = f.slice(0, -".json".length);
    if (!ROUTE_ID_RE.test(id)) continue;
    const r = await readRoute(id).catch(() => null);
    if (r) out.push(r);
  }
  return out;
}

/** One route with its id, or null. */
export async function readRoute(id) {
  if (!ROUTE_ID_RE.test(id ?? "")) return null;
  try { return { ...JSON.parse(await readFile(fileOf(id), "utf8")), id }; }
  catch (err) { if (err.code === "ENOENT") return null; throw err; }
}

/** Ids of the routes attached to a template. */
export async function routesReferencing(kind, id) {
  return (await listRoutes()).filter(r => r.template?.kind === kind && r.template?.id === id).map(r => r.id);
}

async function templateExists({ kind, id }) {
  if (kind === "studio") return (await readDesign(id)) !== null;
  if (!TEMPLATE_ID_RE.test(id)) return false;
  try { await stat(join(templateDir(id), "pass.json")); return true; } catch { return false; }
}

export async function handleRouteList(_req, res) {
  res.json(await listRoutes());
}

export async function handleRouteGet(req, res) {
  const { id } = req.params;
  if (!ROUTE_ID_RE.test(id ?? "")) return res.status(400).json({ error: "invalid route id" });
  const route = await readRoute(id);
  if (!route) return res.status(404).json({ error: `route not found: ${id}` });
  res.json(route);
}

export async function handleRoutePut(req, res) {
  const { id } = req.params;
  if (!ROUTE_ID_RE.test(id ?? "")) {
    return res.status(400).json({ error: 'route id must start with a letter or digit and use only letters, digits, ".", "_" or "-" (max 64)' });
  }
  const problems = validateRoute(req.body);
  if (problems.length) return res.status(400).json({ error: problems.join("; ") });
  const { template, values = {}, schedule = {}, fields = {} } = req.body;
  if (!(await templateExists(template))) return res.status(400).json({ error: `no ${template.kind === "studio" ? "design" : "template"} "${template.id}" to attach the route to` });
  await mkdir(routesRoot(), { recursive: true });
  const existed = (await readRoute(id)) !== null;
  const tmp = join(routesRoot(), `.${id}.${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(tmp, JSON.stringify({ template: { kind: template.kind, id: template.id }, values, schedule, fields }, null, 2));
  await rename(tmp, fileOf(id));
  res.status(existed ? 200 : 201).json({ ok: true, id, created: !existed });
}

export async function handleRouteDelete(req, res) {
  const { id } = req.params;
  if (!ROUTE_ID_RE.test(id ?? "")) return res.status(400).json({ error: "invalid route id" });
  try { await unlink(fileOf(id)); }
  catch (err) { if (err.code === "ENOENT") return res.status(404).json({ error: `route not found: ${id}` }); throw err; }
  res.json({ ok: true });
}

flightRoutesRouter.get("/routes", asyncHandler(handleRouteList));
flightRoutesRouter.get("/routes/:id", asyncHandler(handleRouteGet));
flightRoutesRouter.put("/routes/:id", asyncHandler(handleRoutePut));
flightRoutesRouter.delete("/routes/:id", asyncHandler(handleRouteDelete));

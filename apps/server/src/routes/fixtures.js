import { Router } from "express";
import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { asyncHandler } from "../util/async-handler.js";

// Read-only: fixtures/ holds the repo's tracked regression fixtures (CI builds
// and schema-checks them). Exposed so `?fixture=<name>` deep-links still load one
// into the Design view. Operator-saved designs live in designs/ (routes/designs.js).
export const fixturesRouter = Router();
export const FIXTURES_DIR = "fixtures";
const DIR = FIXTURES_DIR;
const safeName = (n) => n.replace(/[^a-zA-Z0-9._-]/g, "");

fixturesRouter.get("/fixtures", asyncHandler(async (_req, res) => {
  try {
    const files = (await readdir(DIR)).filter(f => f.endsWith(".json"));
    res.json(files.map(f => basename(f, ".json")));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

fixturesRouter.get("/fixtures/:name", asyncHandler(async (req, res) => {
  const name = safeName(req.params.name);
  try {
    const raw = await readFile(join(DIR, `${name}.json`), "utf8");
    res.type("application/json").send(raw);
  } catch {
    res.status(404).json({ error: `fixture not found: ${name}` });
  }
}));

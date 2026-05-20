import { Router } from "express";
import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";

export const fixturesRouter = Router();
const DIR = "fixtures";

fixturesRouter.get("/fixtures", async (_req, res) => {
  try {
    const files = (await readdir(DIR)).filter(f => f.endsWith(".json"));
    res.json(files.map(f => basename(f, ".json")));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

fixturesRouter.get("/fixtures/:name", async (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9._-]/g, "");
  try {
    const raw = await readFile(join(DIR, `${name}.json`), "utf8");
    res.type("application/json").send(raw);
  } catch {
    res.status(404).json({ error: `fixture not found: ${name}` });
  }
});

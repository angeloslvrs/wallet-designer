import { Router } from "express";
import { readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { join, basename } from "node:path";

export const fixturesRouter = Router();
const DIR = "fixtures";
const safeName = (n) => n.replace(/[^a-zA-Z0-9._-]/g, "");

fixturesRouter.get("/fixtures", async (_req, res) => {
  try {
    const files = (await readdir(DIR)).filter(f => f.endsWith(".json"));
    res.json(files.map(f => basename(f, ".json")));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

fixturesRouter.get("/fixtures/:name", async (req, res) => {
  const name = safeName(req.params.name);
  try {
    const raw = await readFile(join(DIR, `${name}.json`), "utf8");
    res.type("application/json").send(raw);
  } catch {
    res.status(404).json({ error: `fixture not found: ${name}` });
  }
});

// Save the current form state as a named template (control-plane: LAN/auth only).
fixturesRouter.put("/fixtures/:name", async (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ error: "invalid name" });
  try {
    await writeFile(join(DIR, `${name}.json`), JSON.stringify(req.body, null, 2));
    res.status(201).json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

fixturesRouter.delete("/fixtures/:name", async (req, res) => {
  const name = safeName(req.params.name);
  try {
    await unlink(join(DIR, `${name}.json`));
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: `template not found: ${name}` });
  }
});

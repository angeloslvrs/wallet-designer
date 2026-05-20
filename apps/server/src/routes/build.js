import { Router } from "express";
import { buildPkpass } from "@wpd/pass-builder";
import { env } from "../env.js";

export const buildRouter = Router();

buildRouter.post("/build", async (req, res) => {
  try {
    const buf = await buildPkpass({
      state: req.body,
      certDir: env.certDir,
      passphrase: env.passphrase
    });
    const name = (req.body?.meta?.serialNumber ?? "boarding-pass").replace(/[^a-zA-Z0-9._-]/g, "_");
    res.setHeader("Content-Type", "application/vnd.apple.pkpass");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.pkpass"`);
    res.send(buf);
  } catch (err) {
    res.status(400).json({ error: err.message, details: err.details });
  }
});

buildRouter.get("/profile", (_req, res) => {
  res.json({ profile: env.profile, certDir: env.certDir, port: env.port });
});

import { Router } from "express";
import { env } from "../env.js";
import { savePass } from "../storage.js";
import { buildStoredPass } from "../pass-build.js";

export const buildRouter = Router();

buildRouter.post("/build", async (req, res) => {
  try {
    const rec = await savePass(req.body);
    // Build through the same server-controlled identity path Wallet fetches use,
    // so the immediate download matches later pass-web-service updates.
    const buf = await buildStoredPass(rec, req.body?.meta?.serialNumber);
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

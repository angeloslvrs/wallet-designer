import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { env } from "./env.js";
import { buildRouter } from "./routes/build.js";
import { fixturesRouter } from "./routes/fixtures.js";
import { walletRouter } from "./routes/wallet.js";
import { adminRouter } from "./routes/admin.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/api", buildRouter);
app.use("/api", fixturesRouter);
app.use("/api", adminRouter);
app.use("/api/wallet", walletRouter);

// Production: serve the built designer SPA from the same origin so one public
// domain covers the UI, the /api routes, and the pass webServiceURL callbacks.
const DIST = join(process.cwd(), "apps/designer/dist");
const INDEX = join(DIST, "index.html");
if (existsSync(INDEX)) {
  app.use(express.static(DIST));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api")) return res.sendFile(INDEX);
    next();
  });
  console.log(`Serving designer SPA from ${DIST}`);
}

app.listen(env.port, () => {
  console.log(`Server listening on http://0.0.0.0:${env.port} (profile=${env.profile})`);
});

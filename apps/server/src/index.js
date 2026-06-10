import express from "express";
import compression from "compression";
import { rateLimit } from "express-rate-limit";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { env } from "./env.js";
import { accessGuard } from "./middleware/guard.js";
import { buildRouter } from "./routes/build.js";
import { fixturesRouter } from "./routes/fixtures.js";
import { walletRouter } from "./routes/wallet.js";
import { adminRouter } from "./routes/admin.js";

const app = express();
app.set("trust proxy", 1);           // 1 hop = the nginx-proxy-manager in front; gives real client IP
app.use(compression());              // gzip responses (the 1.4MB bundle → ~270KB) so the proxy can deliver it
// No CORS by design: the SPA is served same-origin with the API, and Apple's
// PassKit calls are server-to-server (no Origin header, CORS-exempt). A wildcard
// would only let a random site a LAN/VPN browser visits read the control plane
// (incl. pass auth tokens) — the opposite of the LAN-only intent.
app.use(express.json({ limit: "1mb" }));
// Lightweight request log for the pass/wallet flow so push + device fetches are observable.
app.use((req, res, next) => {
  if (req.path.startsWith("/api/wallet") || req.path.startsWith("/api/passes")) {
    res.on("finish", () => console.log(`[req] ${req.ip} ${req.method} ${req.originalUrl} -> ${res.statusCode}`));
  }
  next();
});
app.use(accessGuard);                // /api/wallet/* public; everything else LAN-only or Basic-Auth
app.use("/api", buildRouter);
app.use("/api", fixturesRouter);
app.use("/api", adminRouter);
// Rate-limit the only public surface (Apple PassKit web service). Device traffic
// is low-volume per IP, so this is generous for real clients while capping abuse
// of the unauthenticated /v1/log + registration-list endpoints.
const walletLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use("/api/wallet", walletLimiter, walletRouter);

// Production: serve the built designer SPA from the same origin so one public
// domain covers the UI, the /api routes, and the pass webServiceURL callbacks.
const DIST = join(process.cwd(), "apps/designer/dist");
const INDEX = join(DIST, "index.html");
if (existsSync(INDEX)) {
  app.use(express.static(DIST, {
    setHeaders(res, filePath) {
      // index.html must never be cached, or a deploy's new asset hashes are missed.
      // Hashed assets are content-addressed, so they can be cached forever.
      if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
      else if (filePath.includes("/assets/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    // Only fall back to the SPA for navigation requests. Asset/extension paths
    // must 404 honestly — otherwise a stale cached index.html requesting an old
    // bundle hash gets HTML back, runs it as JS, and the app silently dies.
    if (req.path.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(req.path)) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(INDEX);
  });
  console.log(`Serving designer SPA from ${DIST}`);
}

app.listen(env.port, () => {
  console.log(`Server listening on http://0.0.0.0:${env.port} (profile=${env.profile})`);
});

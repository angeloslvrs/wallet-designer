import express from "express";
import compression from "compression";
import { rateLimit } from "express-rate-limit";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { env } from "./env.js";
import { accessGuard } from "./middleware/guard.js";
import { errorHandler } from "./middleware/error-handler.js";
import { buildRouter } from "./routes/build.js";
import { fixturesRouter } from "./routes/fixtures.js";
import { designsRouter } from "./routes/designs.js";
import { flightRoutesRouter } from "./routes/flight-routes.js";
import { walletRouter } from "./routes/wallet.js";
import { adminRouter } from "./routes/admin.js";
import { templatesRouter } from "./routes/templates.js";

const app = express();
// X-Forwarded-For trust: default is 1 hop (the nginx-proxy-manager in front),
// which trusts ANY immediate peer — so a LAN host hitting :4317 directly could
// spoof a private client IP past the access guard. Prod pins the proxy instead:
// TRUST_PROXY=<ip|cidr>[,<ip|cidr>…] (the NPM LXC's address) honors X-Forwarded-For
// only from that peer. Binding to 127.0.0.1 is NOT an option here — NPM proxies
// from a separate LXC over the LAN (see docs/deploy.md).
const trustProxy = process.env.TRUST_PROXY;
app.set("trust proxy", trustProxy ? trustProxy.split(",").map(s => s.trim()) : 1);
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
app.use("/api", fixturesRouter);    // read-only CI fixtures (?fixture= deep links)
app.use("/api", designsRouter);     // saved Studio designs (designs/)
app.use("/api", flightRoutesRouter); // saved routes (routes/)
app.use("/api", adminRouter);
app.use("/api", templatesRouter);   // .pkpasstemplate upload/list (control plane)
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

// Final middleware: any error a route forwarded via next(err) (async rejections
// are routed here by asyncHandler) is logged server-side and answered with a
// generic body — no stack traces or err.message leak (esp. to the public
// /api/wallet/* routes). Must be registered LAST, after all routes.
app.use(errorHandler);

// Backstop only — asyncHandler already forwards route rejections to errorHandler
// above; this catches anything that still slips past (e.g. a stray promise in a
// background task) so one unhandled rejection cannot take the process down.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

app.listen(env.port, () => {
  console.log(`Server listening on http://0.0.0.0:${env.port} (profile=${env.profile})`);
});

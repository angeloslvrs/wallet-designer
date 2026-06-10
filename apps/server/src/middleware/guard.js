// Access guard.
//
// The PassKit web service (/api/wallet/*) MUST stay public — Apple's devices
// call it from the internet, and it is already protected per-pass by the
// `ApplePass {authenticationToken}` header.
//
// Everything else — the designer SPA, /api/build, /api/passes (issue + push
// controls), /api/fixtures, /api/profile — is the control plane. It is allowed
// only from the LAN, or from a remote client presenting admin Basic Auth.
// This keeps random internet visitors from minting or editing passes with the
// real signing cert.

import { timingSafeStrEqual } from "../util/timing-safe.js";

const PUBLIC_PREFIX = "/api/wallet";

function normalizeIp(ip) {
  if (!ip) return "";
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

export function isPrivateIp(ip) {
  ip = normalizeIp(ip);
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^(fc|fd)/i.test(ip)) return true; // IPv6 unique-local
  return false;
}

export function checkBasicAuth(req, user, pass) {
  const h = req.header("Authorization") ?? "";
  if (!h.startsWith("Basic ")) return false;
  let decoded;
  try { decoded = Buffer.from(h.slice(6), "base64").toString("utf8"); } catch { return false; }
  const i = decoded.indexOf(":");
  if (i < 0) return false;
  return timingSafeStrEqual(decoded.slice(0, i), user) && timingSafeStrEqual(decoded.slice(i + 1), pass);
}

/** Express middleware. Mount after `app.set("trust proxy", 1)`. */
export function accessGuard(req, res, next) {
  if (req.path.startsWith(PUBLIC_PREFIX)) return next();      // Apple PassKit web service
  if (isPrivateIp(req.ip)) return next();                    // LAN — open, no password
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASSWORD;
  if (user && pass && checkBasicAuth(req, user, pass)) return next();
  res.set("WWW-Authenticate", 'Basic realm="boardingpass configurator"');
  return res.status(401).send("Authentication required");
}

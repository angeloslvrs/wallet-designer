// APNs HTTP/2 push for the passes web service.
// Dev mode: logs what would be pushed.
// Prod mode: opens a real TLS HTTP/2 connection to api.push.apple.com using the
// Pass Type ID certificate (the SAME cert used to sign the pass) as the client
// TLS identity, and pushes an empty background notification with topic = pass
// type id.
//
// Reliability (why a gate/delay push "sometimes didn't show"): APNs sends a
// GOAWAY on idle HTTP/2 sessions, so the long-lived cached session silently goes
// half-open and the NEXT push fails on a dead stream. We now:
//   (a) ping-check the cached session before a batch and reconnect if it's dead,
//   (b) retry transport failures once on a freshly-opened session, and
//   (c) report 410 "Unregistered" tokens so the caller prunes stale devices.
// We also send apns-expiration (so APNs store-and-forwards to an offline device
// for a day) and apns-collapse-id = the pass serial (so a burst of updates
// coalesces to the latest on the device).

import http2 from "node:http2";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "./env.js";

const APNS_HOST = process.env.APNS_HOST ?? "api.push.apple.com";
const PING_TIMEOUT_MS = 3000;
const STREAM_TIMEOUT_MS = 10000; // per-push watchdog: never let one stalled stream hang deliver()
const EXPIRATION_WINDOW_S = 24 * 60 * 60; // store-and-forward for a day if offline

// Injection seams — test-only. Production always uses the real modules/env.
let http2Impl = http2;
let readFileImpl = readFile;
let profileOverride = null;
let streamTimeoutMs = STREAM_TIMEOUT_MS;

const activeProfile = () => profileOverride ?? env.profile;

/** @internal test-only: swap the http2/readFile impls, cert profile, or stream timeout. */
export function _setTestHooks(overrides = {}) {
  if ("http2" in overrides) http2Impl = overrides.http2 ?? http2;
  if ("readFile" in overrides) readFileImpl = overrides.readFile ?? readFile;
  if ("profile" in overrides) profileOverride = overrides.profile ?? null;
  if ("streamTimeoutMs" in overrides) streamTimeoutMs = overrides.streamTimeoutMs ?? STREAM_TIMEOUT_MS;
}

/** @internal test-only: restore real impls and clear cached connection state. */
export function _resetTestHooks() {
  http2Impl = http2;
  readFileImpl = readFile;
  profileOverride = null;
  streamTimeoutMs = STREAM_TIMEOUT_MS;
  clientPromise = null;
}

let clientPromise = null;

function connect() {
  let myPromise;
  // The close/error handlers must only clear the cache if THIS connection is
  // still the cached one. An orphaned session (replaced by forceNewClient /
  // getLiveClient) fires its close/error late — without this identity guard it
  // would null out the live `clientPromise` and kill a healthy connection.
  const ownsCache = () => clientPromise === myPromise;
  myPromise = (async () => {
    try {
      const [cert, key] = await Promise.all([
        readFileImpl(join(env.certDir, "signerCert.pem")),
        readFileImpl(join(env.certDir, "signerKey.pem"))
      ]);
      const session = http2Impl.connect(`https://${APNS_HOST}:443`, { cert, key, passphrase: env.passphrase });
      session.on("error", err => { console.error("APNs session error:", err.message); if (ownsCache()) clientPromise = null; });
      session.on("close", () => { if (ownsCache()) clientPromise = null; });
      return session;
    } catch (err) {
      // Don't cache a rejected connect — otherwise every future push reuses the
      // rejected promise and push is dead until process restart.
      if (ownsCache()) clientPromise = null;
      throw err;
    }
  })();
  return myPromise;
}

async function getClient() {
  if (activeProfile() !== "prod") return null;
  if (!clientPromise) clientPromise = connect();
  return clientPromise;
}

/** Resolve true iff the session answers a PING within the timeout. */
function pingOk(session) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
    const t = setTimeout(() => done(false), PING_TIMEOUT_MS);
    t.unref?.();
    try { session.ping((err) => { clearTimeout(t); done(!err); }); }
    catch { clearTimeout(t); done(false); }
  });
}

// Exported for lifecycle unit tests; production callers reach these via pushUpdates.
export { getClient, getLiveClient, forceNewClient };

/** A live session, reconnecting if the cached one is destroyed or unresponsive. */
async function getLiveClient() {
  let session = await getClient();
  if (!session) return null;
  if (session.destroyed || session.closed || !(await pingOk(session))) {
    clientPromise = null;
    try { session.destroy(); } catch { /* already gone */ }
    session = await getClient();
  }
  return session;
}

/** Force a brand-new session — used to retry once after a transport failure. */
async function forceNewClient() {
  const old = clientPromise;
  clientPromise = null;
  const fresh = getClient(); // synchronously installs the new clientPromise
  if (old) {
    // Destroy the previous session so the socket doesn't leak. Its close/error
    // handlers fire late but the identity guard in connect() keeps them from
    // clobbering `fresh` (clientPromise is already the new promise by now).
    Promise.resolve(old).then(
      s => { try { s?.destroy(); } catch { /* already gone */ } },
      () => { /* old connect never resolved — nothing to destroy */ }
    );
  }
  return fresh;
}

/** Send one empty background push; resolve with a classified result (never rejects). */
function sendOne(session, device, { passTypeId, collapseId }) {
  const headers = {
    ":method": "POST",
    ":path": `/3/device/${device.pushToken}`,
    "apns-topic": passTypeId,
    "apns-push-type": "background",
    "apns-priority": "5",
    "apns-expiration": String(Math.floor(Date.now() / 1000) + EXPIRATION_WINDOW_S),
    ...(collapseId ? { "apns-collapse-id": String(collapseId).slice(0, 64) } : {})
  };
  return new Promise((resolve) => {
    let req;
    try { req = session.request(headers); }
    catch (err) { return resolve({ device, transportError: err.message }); }
    let status = 0, body = "", settled = false;
    // Settle exactly once and always clear the watchdog, so a late close/error
    // after a timeout (or vice-versa) can't double-resolve or leak the timer.
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    // Watchdog: a stalled stream that never emits response/end/error would leave
    // this promise pending forever and hang the Promise.all in deliver().
    const timer = setTimeout(() => {
      try { req.close?.(); } catch { /* already gone */ }
      try { req.destroy?.(); } catch { /* already gone */ }
      finish({ device, transportError: `stream timeout after ${streamTimeoutMs}ms` });
    }, streamTimeoutMs);
    timer.unref?.();
    req.setEncoding?.("utf8");
    req.on("response", h => { status = h[":status"]; });
    req.on("data", c => { body += c; });
    req.on("end", () => finish({ device, status, body }));
    req.on("error", err => finish({ device, transportError: err.message }));
    req.end("{}");
  });
}

const isTransportError = (r) => r.transportError != null;
const isUnregistered = (r) => r.status === 410 || /"reason"\s*:\s*"Unregistered"/.test(r.body || "");

/**
 * Deliver to each device, retrying transport failures once on a fresh session.
 * Kept free of connection/env concerns (takes session factories) so it is
 * unit-tested without mocking node:http2.
 * @param {{getSession: () => Promise<any>, reconnect: () => Promise<any>,
 *          passTypeId: string,
 *          devices: Array<{deviceLibraryIdentifier: string, pushToken: string}>,
 *          collapseId?: string}} args
 * @returns {Promise<{sent: number,
 *                    failures: Array<{token: string, status: number, reason: string}>,
 *                    unregistered: Array<{deviceLibraryIdentifier: string, pushToken: string}>}>}
 */
export async function deliver({ getSession, reconnect, passTypeId, devices, collapseId }) {
  const session = await getSession();
  let results = await Promise.all(devices.map(d => sendOne(session, d, { passTypeId, collapseId })));

  // Retry transport failures once on a fresh session (covers a half-open/GOAWAY
  // session that the ping-check raced past).
  const retryable = results.filter(isTransportError).map(r => r.device);
  if (retryable.length) {
    const fresh = await reconnect();
    const retried = await Promise.all(retryable.map(d => sendOne(fresh, d, { passTypeId, collapseId })));
    const byToken = new Map(retried.map(r => [r.device.pushToken, r]));
    results = results.map(r => isTransportError(r) ? (byToken.get(r.device.pushToken) ?? r) : r);
  }

  const failures = [];
  const unregistered = [];
  let sent = 0;
  for (const r of results) {
    const label = isTransportError(r) ? `ERR ${r.transportError}` : `${r.status}${r.body ? " " + r.body : ""}`;
    console.log(`[apns] ${r.device.pushToken.slice(0, 12)}… topic=${passTypeId} -> ${label}`);
    if (!isTransportError(r) && r.status >= 200 && r.status < 300) { sent++; continue; }
    if (isUnregistered(r)) { unregistered.push(r.device); continue; }
    failures.push({
      token: r.device.pushToken,
      status: r.status ?? 0,
      reason: r.transportError ?? `${r.status} ${r.body}`.trim()
    });
  }
  return { sent, failures, unregistered };
}

/**
 * Push an empty background notification to each registered device for one pass.
 * In dev mode, logs only. Returns delivery counts, plus the 410-"Unregistered"
 * devices the caller should prune from storage.
 *
 * @param {{ passTypeId: string,
 *           devices: Array<{deviceLibraryIdentifier: string, pushToken: string}>,
 *           collapseId?: string }} args
 * @returns {Promise<{sent: number, mode: "dev-log"|"prod-push",
 *                    failures: Array<{token: string, status: number, reason: string}>,
 *                    unregistered: Array<{deviceLibraryIdentifier: string, pushToken: string}>}>}
 */
export async function pushUpdates({ passTypeId, devices, collapseId }) {
  if (activeProfile() !== "prod") {
    for (const d of devices) {
      console.log(`[apns:dev-log] topic=${passTypeId} → device=${d.deviceLibraryIdentifier} token=${d.pushToken.slice(0, 12)}…`);
    }
    return { sent: devices.length, mode: "dev-log", failures: [], unregistered: [] };
  }
  if (!devices.length) return { sent: 0, mode: "prod-push", failures: [], unregistered: [] };
  const { sent, failures, unregistered } = await deliver({
    getSession: getLiveClient, reconnect: forceNewClient, passTypeId, devices, collapseId
  });
  return { sent, mode: "prod-push", failures, unregistered };
}

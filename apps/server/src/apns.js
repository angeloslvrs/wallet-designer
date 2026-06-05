// APNs HTTP/2 push for passes web service.
// Dev mode: logs what would be pushed.
// Prod mode: opens a real TLS HTTP/2 connection to api.push.apple.com using the
// Pass Type ID certificate (the SAME cert used to sign the pass) as the client
// TLS identity, and pushes an empty notification with topic = pass type id.

import http2 from "node:http2";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "./env.js";

const APNS_HOST = process.env.APNS_HOST ?? "api.push.apple.com";

let clientPromise = null;
async function getClient() {
  if (env.profile !== "prod") return null;
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const [cert, key] = await Promise.all([
      readFile(join(env.certDir, "signerCert.pem")),
      readFile(join(env.certDir, "signerKey.pem"))
    ]);
    const session = http2.connect(`https://${APNS_HOST}:443`, {
      cert, key,
      passphrase: env.passphrase
    });
    session.on("error", err => { console.error("APNs session error:", err.message); clientPromise = null; });
    session.on("close", () => { clientPromise = null; });
    return session;
  })();
  return clientPromise;
}

/**
 * Push an empty notification for each registered device.
 * In dev mode, logs only. In prod mode, makes real APNs calls.
 *
 * @param {{ passTypeId: string, devices: Array<{deviceLibraryIdentifier: string, pushToken: string}> }} args
 * @returns {Promise<{sent: number, mode: "dev-log"|"prod-push", failures: Array<{token: string, reason: string}>}>}
 */
export async function pushUpdates({ passTypeId, devices }) {
  if (env.profile !== "prod") {
    for (const d of devices) {
      console.log(`[apns:dev-log] topic=${passTypeId} → device=${d.deviceLibraryIdentifier} token=${d.pushToken.slice(0, 12)}…`);
    }
    return { sent: devices.length, mode: "dev-log", failures: [] };
  }
  const session = await getClient();
  /** @type {Array<{token: string, reason: string}>} */
  const failures = [];
  await Promise.all(devices.map(d => new Promise(resolve => {
    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${d.pushToken}`,
      "apns-topic": passTypeId,
      "apns-push-type": "background",
      "apns-priority": "5"
    });
    let status = 0;
    let body = "";
    req.on("response", h => { status = h[":status"]; });
    req.on("data", c => body += c);
    req.on("end", () => {
      console.log(`[apns] ${d.pushToken.slice(0, 12)}… topic=${passTypeId} -> ${status}${body ? " " + body : ""}`);
      if (status >= 200 && status < 300) resolve();
      else { failures.push({ token: d.pushToken, reason: `${status} ${body}` }); resolve(); }
    });
    req.on("error", err => { failures.push({ token: d.pushToken, reason: err.message }); resolve(); });
    req.end(JSON.stringify({}));
  })));
  return { sent: devices.length - failures.length, mode: "prod-push", failures };
}

// Tiny JSON-file-backed store for issued passes + device registrations.
// Production would use SQLite/Postgres; this is enough for a prototype.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

const PATH = "state/passes.json";
const EMPTY = { passes: {}, registrations: {}, log: [] };

let cache = null;
let writing = Promise.resolve();

async function load() {
  if (cache) return cache;
  if (existsSync(PATH)) {
    try { cache = JSON.parse(await readFile(PATH, "utf8")); }
    catch { cache = structuredClone(EMPTY); }
  } else {
    cache = structuredClone(EMPTY);
  }
  return cache;
}

async function persist() {
  writing = writing.then(async () => {
    await mkdir(dirname(PATH), { recursive: true });
    const tmp = `${PATH}.tmp`;
    await writeFile(tmp, JSON.stringify(cache, null, 2));
    await rename(tmp, PATH);
  });
  return writing;
}

export async function savePass(state) {
  const db = await load();
  const serial = state.meta.serialNumber;
  // Keep the auth token STABLE for a serial. Rotating it on re-issue would 401
  // the copy already installed on a device (its embedded token would no longer
  // match), so the device could never fetch updates.
  const existing = db.passes[serial];
  const token = state.meta.authenticationToken ?? existing?.authenticationToken ?? randomBytes(16).toString("hex");
  // Inject the passes-web-service URL from the environment so every issued pass
  // can register for push updates without the caller having to set it.
  const webServiceURL = state.meta.webServiceURL ?? process.env.WEB_SERVICE_URL;
  const meta = {
    ...state.meta,
    // Force the identifiers to match the signing cert, so EVERY pass installs on
    // a device (a mismatched passTypeId/teamId is silently rejected by iOS).
    ...(process.env.PASS_TYPE_ID ? { passTypeId: process.env.PASS_TYPE_ID } : {}),
    ...(process.env.TEAM_ID ? { teamId: process.env.TEAM_ID } : {}),
    authenticationToken: token,
    ...(webServiceURL ? { webServiceURL } : {})
  };
  db.passes[serial] = {
    passTypeIdentifier: meta.passTypeId,
    authenticationToken: token,
    groupId: deriveGroupId(state),   // all passengers on the same flight share this
    state: { ...state, meta },
    lastModified: new Date().toUTCString()
  };
  await persist();
  return db.passes[serial];
}

/** A trip is one flight on one day; every passenger's pass shares this id. */
export function deriveGroupId(state) {
  if (state.meta?.groupId) return state.meta.groupId;
  const f = state.flight ?? {};
  const date = (f.departure?.depart ?? "").slice(0, 10) || "nodate";
  return `${f.airlineCode ?? "?"}${f.flightNumber ?? "?"}@${date}`;
}

/** All issued passes belonging to a trip/group. */
export async function passesInGroup(groupId) {
  const db = await load();
  return Object.entries(db.passes)
    .filter(([, rec]) => rec.groupId === groupId)
    .map(([serial, rec]) => ({ serial, rec }));
}

export async function getPass(passTypeId, serial) {
  const db = await load();
  const rec = db.passes[serial];
  if (!rec || rec.passTypeIdentifier !== passTypeId) return null;
  return rec;
}

export async function updatePassState(serial, mutator) {
  const db = await load();
  const rec = db.passes[serial];
  if (!rec) return null;
  rec.state = mutator(rec.state);
  rec.lastModified = new Date().toUTCString();
  await persist();
  return rec;
}

export async function registerDevice({ deviceLibraryIdentifier, passTypeIdentifier, serialNumber, pushToken }) {
  const db = await load();
  db.registrations[deviceLibraryIdentifier] ??= {};
  db.registrations[deviceLibraryIdentifier][serialNumber] = {
    pushToken,
    passTypeIdentifier,
    registeredAt: new Date().toISOString()
  };
  await persist();
}

export async function unregisterDevice({ deviceLibraryIdentifier, serialNumber }) {
  const db = await load();
  if (db.registrations[deviceLibraryIdentifier]) {
    delete db.registrations[deviceLibraryIdentifier][serialNumber];
    if (Object.keys(db.registrations[deviceLibraryIdentifier]).length === 0) {
      delete db.registrations[deviceLibraryIdentifier];
    }
    await persist();
  }
}

export async function listUpdatedSerials({ deviceLibraryIdentifier, passTypeIdentifier, sinceTag }) {
  const db = await load();
  const subs = db.registrations[deviceLibraryIdentifier] ?? {};
  const sinceMs = sinceTag ? Date.parse(sinceTag) : 0;
  /** @type {string[]} */
  const serials = [];
  let maxModified = 0;
  for (const [serial, sub] of Object.entries(subs)) {
    if (sub.passTypeIdentifier !== passTypeIdentifier) continue;
    const rec = db.passes[serial];
    if (!rec) continue;
    const mt = Date.parse(rec.lastModified);
    if (mt > sinceMs) { serials.push(serial); }
    if (mt > maxModified) maxModified = mt;
  }
  return { serials, lastModified: maxModified ? new Date(maxModified).toUTCString() : null };
}

export async function devicesFor(passTypeId, serial) {
  const db = await load();
  /** @type {Array<{deviceLibraryIdentifier:string, pushToken:string}>} */
  const out = [];
  for (const [device, subs] of Object.entries(db.registrations)) {
    const sub = subs[serial];
    if (sub && sub.passTypeIdentifier === passTypeId) out.push({ deviceLibraryIdentifier: device, pushToken: sub.pushToken });
  }
  return out;
}

export async function logFromDevice(entries) {
  const db = await load();
  db.log.push({ at: new Date().toISOString(), entries });
  if (db.log.length > 1000) db.log = db.log.slice(-1000);
  await persist();
}

export async function snapshot() {
  return structuredClone(await load());
}

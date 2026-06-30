// SQLite-backed store for issued passes + device registrations (node:sqlite,
// no external driver). The public API and its semantics are identical to the
// JSON-file store this replaced — above all: the authenticationToken stays
// STABLE per serialNumber across re-issues (including FormState ↔ template
// shape changes), lastModified stays a toUTCString() string, and record
// shapes are unchanged ({state} for designer passes, {template, data} for
// template passes).
//
// Migration: on first boot, an existing legacy JSON file at STATE_PATH is
// imported one-shot into the DB (timestamped .bak copy written first; a meta
// flag makes the import idempotent). The SQLite file lives next to it and is
// the sole source of truth afterward.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { migrateFormState } from "@wpd/pass-builder";

// node:sqlite resolved at runtime via process.getBuiltinModule: vitest's Vite
// pipeline (v1.x) predates this builtin and cannot resolve the static import.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

// STATE_PATH override exists for tests, which must never touch the real store.
const PATH = process.env.STATE_PATH ?? "state/passes.json";
const DB_PATH = PATH.replace(/\.json$/, "") + ".sqlite";
const LOG_LIMIT = 1000;

let db = null;

function open() {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  // WAL + NORMAL: durable enough for a single pm2 process, no writer stalls.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS passes (
      serial               TEXT PRIMARY KEY,
      pass_type_identifier TEXT,
      authentication_token TEXT NOT NULL,
      group_id             TEXT,
      template             TEXT,
      state_json           TEXT,
      data_json            TEXT,
      last_modified        TEXT NOT NULL,
      update_tag           INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_passes_group ON passes(group_id);
    CREATE TABLE IF NOT EXISTS registrations (
      device_library_identifier TEXT NOT NULL,
      serial                    TEXT NOT NULL,
      pass_type_identifier      TEXT NOT NULL,
      push_token                TEXT NOT NULL,
      registered_at             TEXT NOT NULL,
      PRIMARY KEY (device_library_identifier, serial)
    );
    CREATE TABLE IF NOT EXISTS device_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      at           TEXT NOT NULL,
      entries_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS template_bindings (
      template_id   TEXT PRIMARY KEY,
      bindings_json TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `);
  ensureUpdateTagColumn();
  importLegacyJson();
  backfillUpdateTags();
  return db;
}

function ensureUpdateTagColumn() {
  const cols = new Set(db.prepare("PRAGMA table_info(passes)").all().map(c => c.name));
  if (!cols.has("update_tag")) db.exec("ALTER TABLE passes ADD COLUMN update_tag INTEGER");
}

function metaValue(key) {
  return db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value;
}

function setMetaValue(key, value) {
  db.prepare(`
    INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

const validUpdateTag = (value) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

function updateTagCounter() {
  return validUpdateTag(metaValue("update_tag_counter")) ?? 0;
}

function nextUpdateTag() {
  const next = updateTagCounter() + 1;
  setMetaValue("update_tag_counter", next);
  return next;
}

function backfillUpdateTags() {
  const rows = db.prepare("SELECT rowid, update_tag FROM passes ORDER BY rowid").all();
  let counter = updateTagCounter();
  for (const row of rows) counter = Math.max(counter, validUpdateTag(row.update_tag) ?? 0);
  const setTag = db.prepare("UPDATE passes SET update_tag = ? WHERE rowid = ?");
  for (const row of rows) {
    if (validUpdateTag(row.update_tag) != null) continue;
    counter += 1;
    setTag.run(counter, row.rowid);
  }
  setMetaValue("update_tag_counter", counter);
}

function nextLastModified(existing) {
  const now = new Date();
  const previousMs = Date.parse(existing?.lastModified ?? "");
  if (Number.isNaN(previousMs)) return now.toUTCString();
  const nowHttpMs = Date.parse(now.toUTCString());
  return new Date(nowHttpMs <= previousMs ? previousMs + 1000 : nowHttpMs).toUTCString();
}

function mutationStamp(existing) {
  return {
    lastModified: nextLastModified(existing),
    updateTag: nextUpdateTag()
  };
}

/**
 * One-shot import of the legacy JSON store. Idempotent via a meta flag, so
 * later boots never re-import (deletions/edits made since must survive). The
 * original file is backed up — never modified — and then ignored forever.
 */
function importLegacyJson() {
  const flag = db.prepare("SELECT value FROM meta WHERE key = 'imported_from_json_at'").get();
  if (flag || !existsSync(PATH)) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(PATH, `${PATH}.bak-${stamp}`);

  let legacy = null;
  try { legacy = JSON.parse(readFileSync(PATH, "utf8")); }
  catch { /* corrupt legacy file — same as the old store, start empty */ }

  db.exec("BEGIN");
  try {
    for (const [serial, rec] of Object.entries(legacy?.passes ?? {})) writePass(serial, rec);
    for (const [device, subs] of Object.entries(legacy?.registrations ?? {})) {
      for (const [serial, sub] of Object.entries(subs)) {
        db.prepare(`
          INSERT OR REPLACE INTO registrations
            (device_library_identifier, serial, pass_type_identifier, push_token, registered_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(device, serial, sub.passTypeIdentifier ?? null, sub.pushToken ?? null, sub.registeredAt ?? null);
      }
    }
    for (const entry of legacy?.log ?? []) {
      db.prepare("INSERT INTO device_log (at, entries_json) VALUES (?, ?)")
        .run(entry.at, JSON.stringify(entry.entries ?? []));
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('imported_from_json_at', ?)")
      .run(new Date().toISOString());
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Upsert a pass record. ON CONFLICT keeps the rowid, so insertion order — and
 *  with it snapshot()'s key order — survives re-issues like the JSON store. */
function writePass(serial, rec) {
  db.prepare(`
    INSERT INTO passes (serial, pass_type_identifier, authentication_token, group_id, template, state_json, data_json, last_modified, update_tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(serial) DO UPDATE SET
      pass_type_identifier = excluded.pass_type_identifier,
      authentication_token = excluded.authentication_token,
      group_id             = excluded.group_id,
      template             = excluded.template,
      state_json           = excluded.state_json,
      data_json            = excluded.data_json,
      last_modified        = excluded.last_modified,
      update_tag           = COALESCE(excluded.update_tag, passes.update_tag)
  `).run(
    serial,
    rec.passTypeIdentifier ?? null,
    rec.authenticationToken,
    rec.groupId ?? null,
    rec.template ?? null,
    rec.state !== undefined ? JSON.stringify(rec.state) : null,
    rec.data !== undefined ? JSON.stringify(rec.data) : null,
    rec.lastModified,
    rec.updateTag ?? null
  );
}

/** Row → the exact record shape the JSON store kept (absent keys stay absent). */
function rowToRec(row) {
  if (!row) return null;
  const rec = {};
  if (row.pass_type_identifier != null) rec.passTypeIdentifier = row.pass_type_identifier;
  rec.authenticationToken = row.authentication_token;
  if (row.group_id != null) rec.groupId = row.group_id;
  if (row.template != null) rec.template = row.template;
  if (row.state_json != null) rec.state = JSON.parse(row.state_json);
  if (row.data_json != null) rec.data = JSON.parse(row.data_json);
  rec.lastModified = row.last_modified;
  if (row.update_tag != null) rec.updateTag = Number(row.update_tag);
  return rec;
}

const getRow = (serial) => open().prepare("SELECT * FROM passes WHERE serial = ?").get(serial);

export async function savePass(state) {
  open();
  const serial = state.meta.serialNumber;
  // Keep the auth token STABLE for a serial. Rotating it on re-issue would 401
  // the copy already installed on a device (its embedded token would no longer
  // match), so the device could never fetch updates.
  const existing = rowToRec(getRow(serial));
  const token = existing?.authenticationToken ?? state.meta.authenticationToken ?? randomBytes(16).toString("hex");
  // Inject the passes-web-service URL from the environment so every issued pass
  // can register for push updates without the caller having to set it.
  const webServiceURL = process.env.WEB_SERVICE_URL ?? state.meta.webServiceURL;
  const meta = {
    ...state.meta,
    // Force the identifiers to match the signing cert, so EVERY pass installs on
    // a device (a mismatched passTypeId/teamId is silently rejected by iOS).
    ...(process.env.PASS_TYPE_ID ? { passTypeId: process.env.PASS_TYPE_ID } : {}),
    ...(process.env.TEAM_ID ? { teamId: process.env.TEAM_ID } : {}),
    authenticationToken: token,
    ...(webServiceURL ? { webServiceURL } : {})
  };
  const rec = {
    passTypeIdentifier: meta.passTypeId,
    authenticationToken: token,
    groupId: deriveGroupId(state),   // all passengers on the same flight share this
    state: { ...state, meta },
    ...mutationStamp(existing)
  };
  writePass(serial, rec);
  return rec;
}

/**
 * Issue (or re-issue) a pass backed by a .pkpasstemplate instead of a full
 * FormState: the record stores only the template id + per-pass field data.
 * The same stable-token rule as savePass applies — and holds across shapes,
 * so re-issuing a FormState serial as a template pass keeps its token.
 * groupId is explicit here: template data has no flight structure to derive it from.
 */
export async function saveTemplatePass({ serialNumber, template, data = {}, groupId, passTypeId }) {
  open();
  const existing = rowToRec(getRow(serialNumber));
  const token = existing?.authenticationToken ?? randomBytes(16).toString("hex");
  const rec = {
    // Same env forcing as savePass: the identifiers must match the signing cert.
    passTypeIdentifier: process.env.PASS_TYPE_ID ?? passTypeId ?? existing?.passTypeIdentifier,
    authenticationToken: token,
    groupId,
    template,
    data,
    ...mutationStamp(existing)
  };
  writePass(serialNumber, rec);
  return rec;
}

/** A trip is one flight on one day; every passenger's pass shares this id. */
export function deriveGroupId(state) {
  if (state.meta?.groupId) return state.meta.groupId;
  const sem = migrateFormState(state)?.semantics ?? {};
  const date = (sem.currentDepartureDate ?? sem.originalDepartureDate ?? "").slice(0, 10) || "nodate";
  return `${sem.airlineCode ?? "?"}${sem.flightNumber ?? "?"}@${date}`;
}

/** All issued passes belonging to a trip/group. */
export async function passesInGroup(groupId) {
  const rows = open().prepare("SELECT * FROM passes WHERE group_id = ? ORDER BY rowid").all(groupId);
  return rows.map(row => ({ serial: row.serial, rec: rowToRec(row) }));
}

/** Delete an issued pass and any device registrations for it. */
export async function deletePass(serial) {
  open();
  const gone = db.prepare("DELETE FROM passes WHERE serial = ?").run(serial);
  if (gone.changes === 0) return false;
  db.prepare("DELETE FROM registrations WHERE serial = ?").run(serial);
  return true;
}

/** Delete every pass in a trip/group. Returns how many were removed. */
export async function deleteGroup(groupId) {
  const members = await passesInGroup(groupId);
  for (const { serial } of members) await deletePass(serial);
  return members.length;
}

/** Admin-side lookup: any record by serial, no passTypeId filter. */
export async function getPassRecord(serial) {
  return rowToRec(getRow(serial));
}

export async function getPass(passTypeId, serial) {
  const rec = rowToRec(getRow(serial));
  if (!rec || rec.passTypeIdentifier !== passTypeId) return null;
  return rec;
}

export async function updatePassState(serial, mutator) {
  open();
  const rec = rowToRec(getRow(serial));
  if (!rec) return null;
  rec.state = mutator(rec.state);
  Object.assign(rec, mutationStamp(rec));
  writePass(serial, rec);
  return rec;
}

/** Template-pass twin of updatePassState: mutates rec.data instead of rec.state. */
export async function updatePassData(serial, mutator) {
  open();
  const rec = rowToRec(getRow(serial));
  if (!rec || rec.template == null) return null;
  rec.data = mutator(rec.data ?? {});
  Object.assign(rec, mutationStamp(rec));
  writePass(serial, rec);
  return rec;
}

/**
 * The stored semanticKey → fieldKey binding map for a template, or null when
 * none has been saved yet (caller discovers + saves on first use).
 * @returns {Promise<Record<string, {fieldKey: string, source: string, confidence: string}> | null>}
 */
export async function getTemplateBindings(templateId) {
  const row = open().prepare("SELECT bindings_json FROM template_bindings WHERE template_id = ?").get(templateId);
  return row ? JSON.parse(row.bindings_json) : null;
}

/** Upsert a template's binding map (replaces the whole map). */
export async function saveTemplateBindings(templateId, bindings) {
  open().prepare(`
    INSERT INTO template_bindings (template_id, bindings_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(template_id) DO UPDATE SET
      bindings_json = excluded.bindings_json,
      updated_at    = excluded.updated_at
  `).run(templateId, JSON.stringify(bindings ?? {}), new Date().toISOString());
}

/** Drop a template's stored bindings (template deleted, or force re-discovery). */
export async function deleteTemplateBindings(templateId) {
  open().prepare("DELETE FROM template_bindings WHERE template_id = ?").run(templateId);
}

export async function registerDevice({ deviceLibraryIdentifier, passTypeIdentifier, serialNumber, pushToken }) {
  open().prepare(`
    INSERT OR REPLACE INTO registrations
      (device_library_identifier, serial, pass_type_identifier, push_token, registered_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(deviceLibraryIdentifier, serialNumber, passTypeIdentifier, pushToken, new Date().toISOString());
}

export async function unregisterDevice({ deviceLibraryIdentifier, serialNumber }) {
  open().prepare("DELETE FROM registrations WHERE device_library_identifier = ? AND serial = ?")
    .run(deviceLibraryIdentifier, serialNumber);
}

export async function listUpdatedSerials({ deviceLibraryIdentifier, passTypeIdentifier, sinceTag }) {
  open();
  const subs = db.prepare(`
    SELECT r.serial, p.update_tag FROM registrations r
    JOIN passes p ON p.serial = r.serial
    WHERE r.device_library_identifier = ? AND r.pass_type_identifier = ?
  `).all(deviceLibraryIdentifier, passTypeIdentifier);
  const since = validUpdateTag(Array.isArray(sinceTag) ? sinceTag[0] : sinceTag) ?? 0;
  /** @type {string[]} */
  const serials = [];
  let maxTag = 0;
  for (const { serial, update_tag } of subs) {
    const tag = validUpdateTag(update_tag) ?? 0;
    if (tag > since) serials.push(serial);
    if (tag > maxTag) maxTag = tag;
  }
  return { serials, lastUpdated: maxTag ? String(maxTag) : null };
}

export async function devicesFor(passTypeId, serial) {
  const rows = open().prepare(`
    SELECT device_library_identifier, push_token FROM registrations
    WHERE serial = ? AND pass_type_identifier = ?
  `).all(serial, passTypeId);
  return rows.map(r => ({ deviceLibraryIdentifier: r.device_library_identifier, pushToken: r.push_token }));
}

export async function logFromDevice(entries) {
  // Diagnostic ring, bounded like the old store. /v1/log is public +
  // unauthenticated — a single bounded INSERT (vs the old rewrite-the-world
  // JSON persist) is why this can now be durable without being a DoS vector.
  open();
  db.prepare("INSERT INTO device_log (at, entries_json) VALUES (?, ?)")
    .run(new Date().toISOString(), JSON.stringify(entries));
  db.prepare(`
    DELETE FROM device_log WHERE id NOT IN (SELECT id FROM device_log ORDER BY id DESC LIMIT ?)
  `).run(LOG_LIMIT);
}

/** Whole-store view in the legacy JSON shape: {passes, registrations, log}. */
export async function snapshot() {
  open();
  const passes = {};
  for (const row of db.prepare("SELECT * FROM passes ORDER BY rowid").all()) {
    passes[row.serial] = rowToRec(row);
  }
  const registrations = {};
  for (const r of db.prepare("SELECT * FROM registrations ORDER BY rowid").all()) {
    registrations[r.device_library_identifier] ??= {};
    registrations[r.device_library_identifier][r.serial] = {
      pushToken: r.push_token,
      passTypeIdentifier: r.pass_type_identifier,
      registeredAt: r.registered_at
    };
  }
  const log = db.prepare("SELECT at, entries_json FROM device_log ORDER BY id").all()
    .map(r => ({ at: r.at, entries: JSON.parse(r.entries_json) }));
  return { passes, registrations, log };
}

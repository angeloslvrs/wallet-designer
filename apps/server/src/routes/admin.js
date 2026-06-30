// SPA-facing endpoints to drive the live-pass flow (issue, update status, push)
// for a single pass or for a whole trip (group of passes on one flight).

import { Router } from "express";
import {
  applyTemplateData, loadTemplate, migrateFormState, isSemanticDriven,
  templateFieldDescriptors, validateFieldValue, normalizeFieldValue, discoverBindings,
  BOARDING_SEMANTICS
} from "@wpd/pass-builder";
import {
  savePass, saveTemplatePass, updatePassState, updatePassData, getPassRecord,
  devicesFor, unregisterDevice, snapshot, passesInGroup, deletePass, deleteGroup
} from "../storage.js";
import { pushUpdates } from "../apns.js";
import {
  applyStatusToTemplateData, normalizeStatusBody, validateStatusBody,
  transitStatusDisplay, VOLATILE_ISSUE_SEMANTICS, changeMessageFor
} from "../template-status.js";
import { bindingsForTemplate } from "../template-bindings.js";
import { buildStoredPass, templateDir, TEMPLATE_ID_RE } from "../pass-build.js";

export const adminRouter = Router();

// Template data values may be plain ("B12") or field patches ({value: "B12", …}).
const fieldDataValue = v => (v !== null && typeof v === "object" && !Array.isArray(v)) ? v.value : v;

// A FormState's compact boardingPass field zones, as the schema stores them
// (displayFields.{header,…}).
const DISPLAY_ZONES = ["header", "primary", "secondary", "auxiliary", "back"];

/**
 * The minimal pass.json shape {@link discoverBindings} needs to propose
 * semanticKey → fieldKey bindings for a FormState: its compact fields under the
 * boardingPass style, plus the current semantics. Built straight from the stored
 * state (no `meta` required), so a status update can find which visible field
 * renders a given semantic.
 */
function stateDiscoveryJson(state) {
  const df = state.displayFields ?? {};
  return {
    boardingPass: {
      headerFields: df.header ?? [],
      primaryFields: df.primary ?? [],
      secondaryFields: df.secondary ?? [],
      auxiliaryFields: df.auxiliary ?? [],
      backFields: df.back ?? []
    },
    semantics: state.semantics ?? {}
  };
}

/**
 * Set the visible display field `fieldKey` (in place, on an already-cloned
 * state): its value, plus — for a non-empty value — a changeMessage so the
 * update raises a lock-screen banner. Returns true if a field was found.
 */
function setDisplayField(next, fieldKey, value, changeMessage) {
  const df = next.displayFields;
  if (!df) return false;
  for (const zone of DISPLAY_ZONES) {
    const arr = df[zone];
    if (!Array.isArray(arr)) continue;
    const idx = arr.findIndex(f => f && f.key === fieldKey);
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], value, ...(changeMessage !== undefined && { changeMessage }) };
      return true;
    }
  }
  return false;
}

/**
 * Apply a status change to a pass's FormState. Pure: returns { state, skipped }.
 * Semantics-first: the vocabulary is semantic keys (route layer normalizes the
 * legacy verbs); each updates a `semantics` entry ("" clears it). A generic
 * string/date semantic ALSO updates its bound visible display field — discovered
 * by value-match from the current, in-sync state — with a default changeMessage,
 * so the change shows on the pass face AND raises a lock-screen banner, and
 * display↔semantics stay in lockstep for the next update. Semantics whose value
 * can't be bound to a visible field (FormState times are pre-formatted strings,
 * unbindable) stay semantics-only and are reported in `skipped`. The visible
 * STATUS / DELAY rows (always shown, always bannered) live in
 * iOS26.additionalInfoFields. Object-form values ({value, changeMessage}) set
 * the semantic from .value and carry their changeMessage onto the bound field.
 * @returns {{state: object, skipped: string[]}}
 */
export function applyStatus(state, body = {}) {
  const {
    departureGate, currentBoardingDate, currentDepartureDate, currentArrivalDate,
    transitProvider, securityScreening, delayed, transitStatus, transitStatusReason
  } = body;
  const next = structuredClone(state);
  const sem = { ...(next.semantics ?? {}) };
  const skipped = [];
  // Discover bindings from the PRE-change state: the display value still equals
  // the semantic, so value-match binds; updating both together keeps it bound.
  const bindings = discoverBindings(stateDiscoveryJson(next));

  const set = (key, raw) => {
    const v = fieldDataValue(raw);
    if (v) sem[key] = v; else delete sem[key];
    const fieldKey = bindings[key]?.fieldKey;
    if (!fieldKey) { if (v) skipped.push(key); return; }
    const explicitCM = (raw !== null && typeof raw === "object" && !Array.isArray(raw)) ? raw.changeMessage : undefined;
    setDisplayField(next, fieldKey, v ?? "", v ? (explicitCM ?? changeMessageFor(key)) : undefined);
  };
  if (departureGate !== undefined)        set("departureGate", departureGate);
  if (currentBoardingDate !== undefined)  set("currentBoardingDate", currentBoardingDate);
  if (currentDepartureDate !== undefined) set("currentDepartureDate", currentDepartureDate);
  if (currentArrivalDate !== undefined)   set("currentArrivalDate", currentArrivalDate);
  if (transitProvider !== undefined)      set("transitProvider", transitProvider);
  if (securityScreening !== undefined)    set("securityScreening", securityScreening);

  next.iOS26 ??= {};
  const upsertInfoRow = (key, row) => {
    next.iOS26.additionalInfoFields = (next.iOS26.additionalInfoFields ?? []).filter(f => f.key !== key);
    if (row) next.iOS26.additionalInfoFields.push(row);
  };
  if (delayed !== undefined) {
    const v = fieldDataValue(delayed);
    upsertInfoRow("delay", v ? { key: "delay", label: "DELAY", value: v, changeMessage: "%@" } : null);
  }
  // Mirror of the template path: semantic status + a visible "status" row whose
  // changeMessage makes the push banner carry the why ("Delayed — crew availability").
  if (transitStatus !== undefined || transitStatusReason !== undefined) {
    if (transitStatus !== undefined) { const v = fieldDataValue(transitStatus); if (v) sem.transitStatus = v; else delete sem.transitStatus; }
    if (transitStatusReason !== undefined) { const v = fieldDataValue(transitStatusReason); if (v) sem.transitStatusReason = v; else delete sem.transitStatusReason; }
    const display = transitStatusDisplay(sem.transitStatus, sem.transitStatusReason);
    upsertInfoRow("status", display ? { key: "status", label: "STATUS", value: display, changeMessage: "%@" } : null);
  }
  next.semantics = sem;
  return { state: next, skipped };
}

async function pushPass(rec, serial) {
  const devices = await devicesFor(rec.passTypeIdentifier, serial);
  // collapseId = serial so a burst of updates to one pass coalesces on-device.
  const result = await pushUpdates({ passTypeId: rec.passTypeIdentifier, devices, collapseId: serial });
  // Prune devices APNs reported as 410 "Unregistered" (pass deleted off-device)
  // so we stop pushing to dead tokens and stop counting them as failures.
  for (const d of result.unregistered ?? []) {
    await unregisterDevice({ deviceLibraryIdentifier: d.deviceLibraryIdentifier, serialNumber: serial });
  }
  return result;
}

/**
 * Issue a pass from an installed .pkpasstemplate. Validates everything the
 * FormState path gets from schema validation: the template must exist, the
 * data keys must match the fields it declares (checked by a dry-run merge so a
 * typo fails at issue time, not at device fetch time), and the caller must
 * name the group — template data has no flight structure to derive one from.
 */
export async function issueTemplatePass({ template, serialNumber, data = {}, groupId }) {
  if (!TEMPLATE_ID_RE.test(template)) throw new Error("invalid template id");
  if (typeof serialNumber !== "string" || !serialNumber.trim()) throw new Error("serialNumber is required");
  if (typeof groupId !== "string" || !groupId.trim()) {
    throw new Error('groupId is required for template passes (e.g. "RP247@2026-06-01")');
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("data must be an object of fieldKey → value");
  }
  const { passJson } = await loadTemplate(templateDir(template));
  applyTemplateData(passJson, data);   // dry-run merge: unknown field keys fail here

  // Defense in depth: validate every PROVIDED field value against its
  // descriptor kind (resolved from the template's bindings → semantics), so a
  // malformed value (bad airport code, non-numeric sequence, non-ISO date) is
  // rejected at issue time rather than shipping a broken pass. Empty/absent
  // values fall back to the template default, so only non-empty values are
  // checked here (required-ness is the UI's submit gate). Valid values are
  // normalized (IATA codes uppercased) before storage.
  const bindings = await bindingsForTemplate(template, passJson);
  const descByKey = Object.fromEntries(templateFieldDescriptors(passJson, bindings).map(d => [d.key, d]));
  const errors = [];
  const normalizedData = {};
  for (const [key, raw] of Object.entries(data)) {
    const d = descByKey[key];
    if (!d) { normalizedData[key] = raw; continue; }   // reserved/non-field keys pass through
    const msg = validateFieldValue({ kind: d.kind, required: false }, fieldDataValue(raw));
    if (msg) { errors.push(`${key}: ${msg}`); continue; }
    normalizedData[key] = typeof raw === "string" ? normalizeFieldValue(d.kind, raw) : raw;
  }

  // Semantics-first: the client sends explicit `data.semantics` (filled-only,
  // typed via SEMANTIC_CATALOG). The server NEVER derives semantics from display
  // fields — that mis-mapped time fields onto airport codes and shipped non-ISO
  // dates. Volatile placeholders the user left unset are cleared (null deletes at
  // merge), so the template's sample values never ship.
  const explicit = (normalizedData.semantics && typeof normalizedData.semantics === "object" && !Array.isArray(normalizedData.semantics))
    ? normalizedData.semantics
    : {};
  const expMsg = validateFieldValue({ kind: "date", required: false }, normalizedData.expirationDate);
  if (expMsg) errors.push(`expirationDate: ${expMsg}`);
  for (const [key, raw] of Object.entries(explicit)) {
    if (BOARDING_SEMANTICS[key] !== "date") continue;
    const msg = validateFieldValue({ kind: "date", required: false }, fieldDataValue(raw));
    if (msg) errors.push(`semantics.${key}: ${msg}`);
  }
  if (errors.length) throw new Error(errors.join("; "));

  const clears = {};
  for (const k of VOLATILE_ISSUE_SEMANTICS) {
    if (passJson.semantics?.[k] !== undefined && explicit[k] === undefined) clears[k] = null;
  }
  const semantics = { ...clears, ...explicit };
  const stored = Object.keys(semantics).length ? { ...normalizedData, semantics } : normalizedData;
  return saveTemplatePass({ serialNumber, template, data: stored, groupId, passTypeId: passJson.passTypeIdentifier });
}

/**
 * Core of POST /api/passes for both body shapes. Reports `created` — false when
 * a pass with this serial already existed and was OVERWRITTEN. Apple keys a
 * pass by serialNumber + passTypeId, so re-posting a serial UPDATES that pass
 * rather than creating a second one; surfacing created:false lets the issue UI
 * flag an accidental clobber instead of it passing silently. The existence
 * check must run BEFORE the save.
 * @param {object} body full FormState, or { template, serialNumber, data, groupId }
 */
export async function registerPass(body = {}) {
  const isTemplate = typeof body?.template === "string";
  const serialNumber = isTemplate ? body.serialNumber : body?.meta?.serialNumber;
  const created = serialNumber ? !(await getPassRecord(serialNumber)) : true;
  const rec = isTemplate ? await issueTemplatePass(body) : await savePass(body);
  return {
    serialNumber: isTemplate ? body.serialNumber : body.meta.serialNumber,
    authenticationToken: rec.authenticationToken,
    groupId: rec.groupId,
    lastModified: rec.lastModified,
    created,
    ...(rec.template && { template: rec.template })
  };
}

// POST /api/passes  →  registers a "live" pass. Two body shapes:
//   full FormState                                  (designer flow)
//   { template, serialNumber, data, groupId }       (template flow)
adminRouter.post("/passes", async (req, res) => {
  try {
    res.status(201).json(await registerPass(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Display readouts for the passes list. FormState rows migrate on the fly so a
// pre-Phase-3 row (old shape) and a new-shape row both resolve to semantics.
const passengerOf = (rec) => {
  if (rec.data) return fieldDataValue(rec.data.passenger);
  const pn = migrateFormState(rec.state)?.semantics?.passengerName;
  return pn ? [pn.givenName, pn.familyName].filter(Boolean).join(" ") : undefined;
};
const seatOf = (rec) => {
  if (rec.data) return fieldDataValue(rec.data.seat);
  const s = migrateFormState(rec.state)?.semantics?.seats?.[0];
  return s ? (`${s.seatRow ?? ""}${s.seatNumber ?? ""}` || undefined) : undefined;
};
// Current trip status for the Manage chip: the pushed transitStatus semantic
// (both shapes store it in semantics; may be a {value} patch), else "On Time".
export const statusOf = (rec) => {
  const sem = rec.data ? rec.data.semantics : migrateFormState(rec.state)?.semantics;
  const ts = sem?.transitStatus;
  const v = (ts !== null && typeof ts === "object") ? ts.value : ts;
  return (v ?? "").toString().trim() || "On Time";
};

// GET /api/passes  →  all issued passes, with their group + device count
adminRouter.get("/passes", async (_req, res) => {
  const snap = await snapshot();
  res.json(Object.entries(snap.passes).map(([serial, rec]) => ({
    serial,
    groupId: rec.groupId,
    passTypeIdentifier: rec.passTypeIdentifier,
    passenger: passengerOf(rec),
    seat: seatOf(rec),
    status: statusOf(rec),
    lastModified: rec.lastModified,
    deviceCount: Object.values(snap.registrations).filter(d => d[serial]).length,
    ...(rec.template && { template: rec.template })
  })));
});

/**
 * Apply a status body to a stored pass of either shape. The body vocabulary
 * is semantic keys; the legacy verbs (gate, boarding, …) are normalized here
 * so both spellings keep working. Template passes also report semantic keys
 * with no bound visible field (semantics still update for those). Returns
 * null when the serial is unknown.
 */
async function applyStatusToStoredPass(serial, body) {
  const rec = await getPassRecord(serial);
  if (!rec) return null;
  const normalized = normalizeStatusBody(body);
  if (rec.template) {
    const { passJson } = await loadTemplate(templateDir(rec.template));
    const bindings = await bindingsForTemplate(rec.template, passJson);
    let skipped = [];
    const updated = await updatePassData(serial, data => {
      const result = applyStatusToTemplateData(data, normalized, bindings);
      skipped = result.skipped;
      return result.data;
    });
    // On a semanticBoardingPass, an unbound semantic (e.g. departureGate) still
    // renders on the device straight from semantics — that's the whole point of
    // the scheme — so it is NOT "skipped". Only flag unbound semantics for
    // classic templates whose display comes solely from bound visible fields.
    return { rec: updated, skipped: isSemanticDriven(passJson) ? [] : skipped };
  }
  // FormState: applyStatus now updates bound visible fields too and reports the
  // semantics it could not bind to a visible field (so the console can say
  // "not on pass face: …" — honest, since FormState times are unbindable).
  let skipped = [];
  const updated = await updatePassState(serial, state => {
    const r = applyStatus(migrateFormState(state), normalized);
    skipped = r.skipped;
    return r.state;
  });
  return { rec: updated, skipped };
}

// POST /api/passes/:serial/status  →  update one pass + push its devices
adminRouter.post("/passes/:serial/status", async (req, res) => {
  const invalid = validateStatusBody(req.body ?? {});
  if (invalid.length) return res.status(400).json({ error: invalid.join("; "), fields: invalid });
  try {
    const result = await applyStatusToStoredPass(req.params.serial, req.body ?? {});
    if (!result) return res.status(404).json({ error: "pass not registered — POST /api/passes first" });
    const push = await pushPass(result.rec, req.params.serial);
    res.json({
      ok: true, lastModified: result.rec.lastModified, push,
      ...(result.skipped.length && { skippedFields: result.skipped })
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:groupId/status  →  update EVERY pass on the flight + push all devices
adminRouter.post("/groups/:groupId/status", async (req, res) => {
  const invalid = validateStatusBody(req.body ?? {});
  if (invalid.length) return res.status(400).json({ error: invalid.join("; "), fields: invalid });
  const members = await passesInGroup(req.params.groupId);
  if (!members.length) return res.status(404).json({ error: "no passes in this group" });
  try {
    const results = [];
    for (const { serial } of members) {
      const { rec, skipped } = await applyStatusToStoredPass(serial, req.body ?? {});
      const push = await pushPass(rec, serial);
      results.push({
        serial, passenger: passengerOf(rec), push,
        ...(skipped.length && { skippedFields: skipped })
      });
    }
    const sent = results.reduce((n, r) => n + r.push.sent, 0);
    res.json({ ok: true, count: members.length, sent, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/passes/:serial/pkpass  →  download the signed .pkpass for a stored pass
adminRouter.get("/passes/:serial/pkpass", async (req, res) => {
  const snap = await snapshot();
  const rec = snap.passes[req.params.serial];
  if (!rec) return res.status(404).json({ error: "not found" });
  try {
    const buf = await buildStoredPass(rec, req.params.serial);
    const name = req.params.serial.replace(/[^a-zA-Z0-9._-]/g, "_");
    res.setHeader("Content-Type", "application/vnd.apple.pkpass");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.pkpass"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message, details: err.details });
  }
});

// DELETE /api/passes/:serial  →  remove one pass + its registrations
adminRouter.delete("/passes/:serial", async (req, res) => {
  const ok = await deletePass(req.params.serial);
  if (!ok) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

// DELETE /api/groups/:groupId  →  remove every pass in the trip
adminRouter.delete("/groups/:groupId", async (req, res) => {
  const count = await deleteGroup(req.params.groupId);
  if (!count) return res.status(404).json({ error: "no passes in this group" });
  res.json({ ok: true, count });
});

// GET /api/log  →  recent device-reported PassKit logs (newest first).
// Devices write via the public POST /v1/log; this is the admin read side.
adminRouter.get("/log", async (req, res) => {
  const snap = await snapshot();
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  res.json(snap.log.slice(-limit).reverse());
});

// GET /api/passes/:serial
adminRouter.get("/passes/:serial", async (req, res) => {
  const snap = await snapshot();
  const rec = snap.passes[req.params.serial];
  if (!rec) return res.status(404).json({ error: "not found" });
  const devices = Object.entries(snap.registrations).flatMap(([dev, subs]) =>
    subs[req.params.serial] ? [{ device: dev, pushToken: subs[req.params.serial].pushToken.slice(0, 8) + "…" }] : []
  );
  res.json({ ...rec, devices });
});

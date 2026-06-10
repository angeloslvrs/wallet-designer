// SPA-facing endpoints to drive the live-pass flow (issue, update status, push)
// for a single pass or for a whole trip (group of passes on one flight).

import { Router } from "express";
import { applyTemplateData, loadTemplate, templateFieldKeys } from "@wpd/pass-builder";
import {
  savePass, saveTemplatePass, updatePassState, updatePassData, getPassRecord,
  devicesFor, snapshot, passesInGroup, deletePass, deleteGroup
} from "../storage.js";
import { pushUpdates } from "../apns.js";
import { applyStatusToTemplateData } from "../template-status.js";
import { buildStoredPass, templateDir, TEMPLATE_ID_RE } from "../pass-build.js";

export const adminRouter = Router();

/**
 * Apply a status change to a pass's FormState. Pure: returns a new state.
 * Recognized fields: gate, boarding, depart, arrive, transitInfo,
 * securityScreening, delayed ("" clears the delay).
 */
function applyStatus(state, body = {}) {
  const { gate, boarding, depart, arrive, transitInfo, securityScreening, delayed } = body;
  const next = structuredClone(state);
  if (gate !== undefined)     next.flight.departure.gate = gate;
  if (boarding !== undefined) next.flight.departure.boarding = boarding;
  if (depart !== undefined)   next.flight.departure.depart = depart;
  if (arrive !== undefined)   next.flight.arrival.arrive = arrive;
  next.iOS26 ??= {};
  if (transitInfo !== undefined)       next.iOS26.transitInfo = transitInfo;
  if (securityScreening !== undefined) next.iOS26.securityScreening = securityScreening;
  if (delayed !== undefined) {
    next.iOS26.additionalInfoFields ??= [];
    next.iOS26.additionalInfoFields = next.iOS26.additionalInfoFields.filter(f => f.key !== "delay");
    if (delayed) next.iOS26.additionalInfoFields.push({ key: "delay", label: "DELAY", value: delayed });
  }
  return next;
}

async function pushPass(rec, serial) {
  const devices = await devicesFor(rec.passTypeIdentifier, serial);
  return pushUpdates({ passTypeId: rec.passTypeIdentifier, devices });
}

/**
 * Issue a pass from an installed .pkpasstemplate. Validates everything the
 * FormState path gets from schema validation: the template must exist, the
 * data keys must match the fields it declares (checked by a dry-run merge so a
 * typo fails at issue time, not at device fetch time), and the caller must
 * name the group — template data has no flight structure to derive one from.
 */
async function issueTemplatePass({ template, serialNumber, data = {}, groupId }) {
  if (!TEMPLATE_ID_RE.test(template)) throw new Error("invalid template id");
  if (typeof serialNumber !== "string" || !serialNumber.trim()) throw new Error("serialNumber is required");
  if (typeof groupId !== "string" || !groupId.trim()) {
    throw new Error('groupId is required for template passes (e.g. "RP247@2026-06-01")');
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("data must be an object of fieldKey → value");
  }
  const { passJson } = await loadTemplate(templateDir(template));
  applyTemplateData(passJson, data);
  return saveTemplatePass({ serialNumber, template, data, groupId, passTypeId: passJson.passTypeIdentifier });
}

// POST /api/passes  →  registers a "live" pass. Two body shapes:
//   full FormState                                  (designer flow)
//   { template, serialNumber, data, groupId }       (template flow)
adminRouter.post("/passes", async (req, res) => {
  try {
    const isTemplate = typeof req.body?.template === "string";
    const rec = isTemplate ? await issueTemplatePass(req.body) : await savePass(req.body);
    res.status(201).json({
      serialNumber: isTemplate ? req.body.serialNumber : req.body.meta.serialNumber,
      authenticationToken: rec.authenticationToken,
      groupId: rec.groupId,
      lastModified: rec.lastModified,
      ...(rec.template && { template: rec.template })
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Template data values may be plain ("B12") or field patches ({value: "B12", …}).
const fieldDataValue = v => (v !== null && typeof v === "object" && !Array.isArray(v)) ? v.value : v;
const passengerOf = rec => rec.state?.passenger?.name ?? fieldDataValue(rec.data?.passenger);

// GET /api/passes  →  all issued passes, with their group + device count
adminRouter.get("/passes", async (_req, res) => {
  const snap = await snapshot();
  res.json(Object.entries(snap.passes).map(([serial, rec]) => ({
    serial,
    groupId: rec.groupId,
    passTypeIdentifier: rec.passTypeIdentifier,
    passenger: passengerOf(rec),
    seat: rec.state?.passenger?.seats?.[0]?.number ?? fieldDataValue(rec.data?.seat),
    lastModified: rec.lastModified,
    deviceCount: Object.values(snap.registrations).filter(d => d[serial]).length,
    ...(rec.template && { template: rec.template })
  })));
});

/**
 * Apply a status body to a stored pass of either shape. Template passes also
 * report which visible-field keys their template doesn't declare (semantics
 * still update for those). Returns null when the serial is unknown.
 */
async function applyStatusToStoredPass(serial, body) {
  const rec = await getPassRecord(serial);
  if (!rec) return null;
  if (rec.template) {
    const { passJson } = await loadTemplate(templateDir(rec.template));
    const fieldKeys = templateFieldKeys(passJson);
    let skipped = [];
    const updated = await updatePassData(serial, data => {
      const result = applyStatusToTemplateData(data, body, fieldKeys);
      skipped = result.skipped;
      return result.data;
    });
    return { rec: updated, skipped };
  }
  return { rec: await updatePassState(serial, state => applyStatus(state, body)), skipped: [] };
}

// POST /api/passes/:serial/status  →  update one pass + push its devices
adminRouter.post("/passes/:serial/status", async (req, res) => {
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

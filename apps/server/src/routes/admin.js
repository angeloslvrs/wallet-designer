// SPA-facing endpoints to drive the live-pass flow (issue, update status, push)
// for a single pass or for a whole trip (group of passes on one flight).

import { Router } from "express";
import { buildPkpass } from "@wpd/pass-builder";
import { env } from "../env.js";
import { savePass, updatePassState, devicesFor, snapshot, passesInGroup, deletePass, deleteGroup } from "../storage.js";
import { pushUpdates } from "../apns.js";

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

// POST /api/passes  body: full FormState  →  registers it as a "live" pass
adminRouter.post("/passes", async (req, res) => {
  try {
    const rec = await savePass(req.body);
    res.status(201).json({
      serialNumber: req.body.meta.serialNumber,
      authenticationToken: rec.authenticationToken,
      groupId: rec.groupId,
      lastModified: rec.lastModified
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/passes  →  all issued passes, with their group + device count
adminRouter.get("/passes", async (_req, res) => {
  const snap = await snapshot();
  res.json(Object.entries(snap.passes).map(([serial, rec]) => ({
    serial,
    groupId: rec.groupId,
    passTypeIdentifier: rec.passTypeIdentifier,
    passenger: rec.state?.passenger?.name,
    seat: rec.state?.passenger?.seats?.[0]?.number,
    lastModified: rec.lastModified,
    deviceCount: Object.values(snap.registrations).filter(d => d[serial]).length
  })));
});

// POST /api/passes/:serial/status  →  update one pass + push its devices
adminRouter.post("/passes/:serial/status", async (req, res) => {
  const rec = await updatePassState(req.params.serial, state => applyStatus(state, req.body ?? {}));
  if (!rec) return res.status(404).json({ error: "pass not registered — POST /api/passes first" });
  const push = await pushPass(rec, req.params.serial);
  res.json({ ok: true, lastModified: rec.lastModified, push });
});

// POST /api/groups/:groupId/status  →  update EVERY pass on the flight + push all devices
adminRouter.post("/groups/:groupId/status", async (req, res) => {
  const members = await passesInGroup(req.params.groupId);
  if (!members.length) return res.status(404).json({ error: "no passes in this group" });
  const results = [];
  for (const { serial } of members) {
    const rec = await updatePassState(serial, state => applyStatus(state, req.body ?? {}));
    const push = await pushPass(rec, serial);
    results.push({ serial, passenger: rec.state?.passenger?.name, push });
  }
  const sent = results.reduce((n, r) => n + r.push.sent, 0);
  res.json({ ok: true, count: members.length, sent, results });
});

// GET /api/passes/:serial/pkpass  →  download the signed .pkpass for a stored pass
adminRouter.get("/passes/:serial/pkpass", async (req, res) => {
  const snap = await snapshot();
  const rec = snap.passes[req.params.serial];
  if (!rec) return res.status(404).json({ error: "not found" });
  try {
    const buf = await buildPkpass({ state: rec.state, certDir: env.certDir, passphrase: env.passphrase });
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

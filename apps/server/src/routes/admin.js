// SPA-facing endpoints to drive the live-pass flow (issue, update status, push).

import { Router } from "express";
import { savePass, getPass, updatePassState, devicesFor, snapshot } from "../storage.js";
import { pushUpdates } from "../apns.js";

export const adminRouter = Router();

// POST /api/passes        body: full FormState  →  registers it as a "live" pass
adminRouter.post("/passes", async (req, res) => {
  try {
    const rec = await savePass(req.body);
    res.status(201).json({
      serialNumber: req.body.meta.serialNumber,
      authenticationToken: rec.authenticationToken,
      lastModified: rec.lastModified
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/passes
adminRouter.get("/passes", async (_req, res) => {
  const snap = await snapshot();
  res.json(Object.entries(snap.passes).map(([serial, rec]) => ({
    serial,
    passTypeIdentifier: rec.passTypeIdentifier,
    lastModified: rec.lastModified,
    deviceCount: Object.values(snap.registrations).filter(d => d[serial]).length
  })));
});

// POST /api/passes/:serial/status  body: { gate?, boarding?, depart?, arrive?, transitInfo?, delayed? }
// Mutates the live pass and fires APNs pushes to registered devices.
adminRouter.post("/passes/:serial/status", async (req, res) => {
  const { serial } = req.params;
  const { gate, boarding, depart, arrive, transitInfo, securityScreening, delayed } = req.body ?? {};

  const rec = await updatePassState(serial, state => {
    const next = structuredClone(state);
    if (gate !== undefined)      next.flight.departure.gate = gate;
    if (boarding !== undefined)  next.flight.departure.boarding = boarding;
    if (depart !== undefined)    next.flight.departure.depart = depart;
    if (arrive !== undefined)    next.flight.arrival.arrive = arrive;
    next.iOS26 ??= {};
    if (transitInfo !== undefined)        next.iOS26.transitInfo = transitInfo;
    if (securityScreening !== undefined)  next.iOS26.securityScreening = securityScreening;
    if (delayed) {
      next.iOS26.additionalInfoFields ??= [];
      const idx = next.iOS26.additionalInfoFields.findIndex(f => f.key === "delay");
      const entry = { key: "delay", label: "DELAY", value: delayed };
      if (idx >= 0) next.iOS26.additionalInfoFields[idx] = entry;
      else next.iOS26.additionalInfoFields.push(entry);
    }
    return next;
  });

  if (!rec) return res.status(404).json({ error: "pass not registered — POST /api/passes first" });

  const devices = await devicesFor(rec.passTypeIdentifier, serial);
  const push = await pushUpdates({ passTypeId: rec.passTypeIdentifier, devices });

  res.json({ ok: true, lastModified: rec.lastModified, push });
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

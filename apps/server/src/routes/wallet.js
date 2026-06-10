// Apple PassKit Web Service endpoints. Mounted at `/api/wallet` so that the
// pass.json's webServiceURL = http://localhost:4317/api/wallet works.
//
// Spec: https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes

import { Router } from "express";
import { buildPkpass } from "@wpd/pass-builder";
import { env } from "../env.js";
import { timingSafeStrEqual } from "../util/timing-safe.js";
import {
  getPass, registerDevice, unregisterDevice,
  listUpdatedSerials, logFromDevice
} from "../storage.js";

export const walletRouter = Router();

function auth(req, res, pass) {
  const h = req.header("Authorization") ?? "";
  const want = `ApplePass ${pass.authenticationToken}`;
  if (!timingSafeStrEqual(h, want)) { res.status(401).send(); return false; }
  return true;
}

// POST /v1/devices/{device}/registrations/{passType}/{serial}  body: {pushToken}
walletRouter.post("/v1/devices/:device/registrations/:passType/:serial", async (req, res) => {
  const pass = await getPass(req.params.passType, req.params.serial);
  if (!pass) return res.status(404).send();
  if (!auth(req, res, pass)) return;
  const pushToken = req.body?.pushToken;
  if (!pushToken) return res.status(400).send();
  await registerDevice({
    deviceLibraryIdentifier: req.params.device,
    passTypeIdentifier: req.params.passType,
    serialNumber: req.params.serial,
    pushToken
  });
  res.status(201).send();
});

// DELETE /v1/devices/{device}/registrations/{passType}/{serial}
walletRouter.delete("/v1/devices/:device/registrations/:passType/:serial", async (req, res) => {
  const pass = await getPass(req.params.passType, req.params.serial);
  if (!pass) return res.status(404).send();
  if (!auth(req, res, pass)) return;
  await unregisterDevice({
    deviceLibraryIdentifier: req.params.device,
    serialNumber: req.params.serial
  });
  res.status(200).send();
});

// GET /v1/devices/{device}/registrations/{passType}?passesUpdatedSince=tag
walletRouter.get("/v1/devices/:device/registrations/:passType", async (req, res) => {
  const { serials, lastModified } = await listUpdatedSerials({
    deviceLibraryIdentifier: req.params.device,
    passTypeIdentifier: req.params.passType,
    sinceTag: req.query.passesUpdatedSince
  });
  if (!serials.length) return res.status(204).send();
  res.json({ serialNumbers: serials, lastUpdated: lastModified ?? new Date().toUTCString() });
});

// GET /v1/passes/{passType}/{serial}   (If-Modified-Since header optional)
walletRouter.get("/v1/passes/:passType/:serial", async (req, res) => {
  const pass = await getPass(req.params.passType, req.params.serial);
  if (!pass) return res.status(404).send();
  if (!auth(req, res, pass)) return;

  const ims = req.header("If-Modified-Since");
  if (ims && Date.parse(ims) >= Date.parse(pass.lastModified)) {
    return res.status(304).send();
  }

  try {
    const buf = await buildPkpass({
      state: pass.state,
      certDir: env.certDir,
      passphrase: env.passphrase
    });
    res.setHeader("Content-Type", "application/vnd.apple.pkpass");
    res.setHeader("Last-Modified", pass.lastModified);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /v1/log  body: {logs: [...]}
walletRouter.post("/v1/log", async (req, res) => {
  await logFromDevice(req.body?.logs ?? []);
  res.status(200).send();
});

// Apple PassKit Web Service endpoints. Mounted at `/api/wallet` so that the
// pass.json's webServiceURL = http://localhost:4317/api/wallet works.
//
// Spec: https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes

import { Router } from "express";
import { buildStoredPass } from "../pass-build.js";
import { asyncHandler } from "../util/async-handler.js";
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

// APNs device tokens are 32 bytes rendered as 64 hex chars; deviceLibraryIdentifier
// is a UUID-ish opaque string. Bound both before they hit the (public) store so a
// leaked pass token can't seed unbounded or malformed registration rows.
const APNS_TOKEN_RE = /^[0-9a-f]{64}$/i;
const MAX_DEVICE_ID_LEN = 128;

// POST /v1/devices/{device}/registrations/{passType}/{serial}  body: {pushToken}
walletRouter.post("/v1/devices/:device/registrations/:passType/:serial", asyncHandler(async (req, res) => {
  const pass = await getPass(req.params.passType, req.params.serial);
  if (!pass) return res.status(404).send();
  if (!auth(req, res, pass)) return;
  const pushToken = req.body?.pushToken;
  const device = req.params.device;
  if (typeof pushToken !== "string" || !APNS_TOKEN_RE.test(pushToken)) return res.status(400).send();
  if (typeof device !== "string" || device.length === 0 || device.length > MAX_DEVICE_ID_LEN) {
    return res.status(400).send();
  }
  const { created } = await registerDevice({
    deviceLibraryIdentifier: device,
    passTypeIdentifier: req.params.passType,
    serialNumber: req.params.serial,
    pushToken
  });
  // Apple spec: 201 for a new registration, 200 if the device was already registered.
  res.status(created ? 201 : 200).send();
}));

// DELETE /v1/devices/{device}/registrations/{passType}/{serial}
walletRouter.delete("/v1/devices/:device/registrations/:passType/:serial", asyncHandler(async (req, res) => {
  const pass = await getPass(req.params.passType, req.params.serial);
  if (!pass) return res.status(404).send();
  if (!auth(req, res, pass)) return;
  await unregisterDevice({
    deviceLibraryIdentifier: req.params.device,
    serialNumber: req.params.serial
  });
  res.status(200).send();
}));

// GET /v1/devices/{device}/registrations/{passType}?passesUpdatedSince=tag
walletRouter.get("/v1/devices/:device/registrations/:passType", asyncHandler(async (req, res) => {
  const { serials, lastUpdated } = await listUpdatedSerials({
    deviceLibraryIdentifier: req.params.device,
    passTypeIdentifier: req.params.passType,
    sinceTag: req.query.passesUpdatedSince
  });
  if (!serials.length) return res.status(204).send();
  res.json({ serialNumbers: serials, lastUpdated: lastUpdated ?? "0" });
}));

// GET /v1/passes/{passType}/{serial}   (If-Modified-Since header optional)
walletRouter.get("/v1/passes/:passType/:serial", asyncHandler(async (req, res) => {
  const pass = await getPass(req.params.passType, req.params.serial);
  if (!pass) return res.status(404).send();
  if (!auth(req, res, pass)) return;

  const ims = req.header("If-Modified-Since");
  const imsMs = Date.parse(ims ?? "");
  const passMs = Date.parse(pass.lastModified);
  if (ims && !Number.isNaN(imsMs) && !Number.isNaN(passMs) && imsMs >= passMs) {
    return res.status(304).send();
  }

  // Rebuilds from stored state at fetch time — FormState- or template-backed. A
  // build failure (e.g. a corrupt stored row) rejects and is handled by the
  // central errorHandler: this route is PUBLIC, so err.message must NOT be
  // returned to the caller — it logs server-side and answers a generic 500.
  const buf = await buildStoredPass(pass, req.params.serial);
  res.setHeader("Content-Type", "application/vnd.apple.pkpass");
  res.setHeader("Last-Modified", pass.lastModified);
  res.send(buf);
}));

// POST /v1/log  body: {logs: [...]}
walletRouter.post("/v1/log", asyncHandler(async (req, res) => {
  await logFromDevice(req.body?.logs ?? []);
  res.status(200).send();
}));

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGINAL_ENV = {
  CERT_PROFILE: process.env.CERT_PROFILE,
  STATE_PATH: process.env.STATE_PATH,
  WEB_SERVICE_URL: process.env.WEB_SERVICE_URL,
  PASS_TYPE_ID: process.env.PASS_TYPE_ID,
  TEAM_ID: process.env.TEAM_ID
};

function restoreEnv() {
  for (const key of Object.keys(ORIGINAL_ENV)) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
}

async function boot() {
  vi.resetModules();
  process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-wallet-")), "passes.json");
  delete process.env.WEB_SERVICE_URL;
  process.env.CERT_PROFILE = "dev";
  delete process.env.PASS_TYPE_ID;
  delete process.env.TEAM_ID;
  const storage = await import("../apps/server/src/storage.js");
  const { walletRouter } = await import("../apps/server/src/routes/wallet.js");
  return { walletRouter, storage };
}

async function minimalState(serial) {
  const state = JSON.parse(await readFile("fixtures/minimal.json", "utf8"));
  state.meta.serialNumber = serial;
  return state;
}

function routeHandler(router, path, method) {
  const layer = router.stack.find(l => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`missing ${method.toUpperCase()} ${path}`);
  return layer.route.stack.at(-1).handle;
}

async function callRoute(handler, { params = {}, query = {}, headers = {}, body } = {}) {
  const res = {
    statusCode: 200,
    headers: new Map(),
    setHeader(name, value) { this.headers.set(name, value); return this; },
    status(code) { this.statusCode = code; return this; },
    send(payload = "") { this.body = payload; return this; },
    json(payload) { this.jsonBody = payload; this.body = JSON.stringify(payload); return this; }
  };
  const req = {
    params,
    query,
    body,
    header(name) {
      return headers[name] ?? headers[name.toLowerCase()];
    }
  };
  await handler(req, res);
  return res;
}

describe("Wallet web service update correctness", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    restoreEnv();
    vi.resetModules();
  });

  it("returns same-second updates from the serial list using numeric update tags", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-30T00:00:00.500Z"));
    try {
      const { walletRouter, storage } = await boot();
      const first = await storage.savePass(await minimalState("WALLET-LIST-1"));
      await storage.registerDevice({
        deviceLibraryIdentifier: "DEVICE-1",
        passTypeIdentifier: first.passTypeIdentifier,
        serialNumber: "WALLET-LIST-1",
        pushToken: "push-token"
      });
      const updated = await storage.updatePassState("WALLET-LIST-1", state => ({
        ...state,
        semantics: { ...state.semantics, departureGate: "C3" }
      }));

      const handler = routeHandler(walletRouter, "/v1/devices/:device/registrations/:passType", "get");
      const res = await callRoute(handler, {
        params: { device: "DEVICE-1", passType: first.passTypeIdentifier },
        query: { passesUpdatedSince: String(first.updateTag) }
      });
      expect(res.statusCode).toBe(200);
      expect(res.jsonBody).toEqual({
        serialNumbers: ["WALLET-LIST-1"],
        lastUpdated: String(updated.updateTag)
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 201 for a new device registration and 200 when already registered", async () => {
    const { walletRouter, storage } = await boot();
    const first = await storage.savePass(await minimalState("WALLET-REG-1"));
    const handler = routeHandler(
      walletRouter,
      "/v1/devices/:device/registrations/:passType/:serial",
      "post"
    );
    const params = {
      device: "DEVICE-REG",
      passType: first.passTypeIdentifier,
      serial: "WALLET-REG-1"
    };
    const headers = { Authorization: `ApplePass ${first.authenticationToken}` };

    const created = await callRoute(handler, { params, headers, body: { pushToken: "tok-a" } });
    expect(created.statusCode).toBe(201);

    // Re-registering the same device+serial is a 200 (Apple spec) but must still
    // refresh the push token so a rotated APNs token is not dropped.
    const again = await callRoute(handler, { params, headers, body: { pushToken: "tok-b" } });
    expect(again.statusCode).toBe(200);

    const devices = await storage.devicesFor(first.passTypeIdentifier, "WALLET-REG-1");
    expect(devices).toEqual([{ deviceLibraryIdentifier: "DEVICE-REG", pushToken: "tok-b" }]);
  });

  it("does not return a false 304 after a same-second pass update", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-30T00:00:00.500Z"));
    try {
      const { walletRouter, storage } = await boot();
      const first = await storage.savePass(await minimalState("WALLET-PASS-1"));
      const updated = await storage.updatePassState("WALLET-PASS-1", state => ({
        ...state,
        semantics: { ...state.semantics, departureGate: "D4" }
      }));

      const handler = routeHandler(walletRouter, "/v1/passes/:passType/:serial", "get");
      const res = await callRoute(handler, {
        params: { passType: first.passTypeIdentifier, serial: "WALLET-PASS-1" },
        headers: {
          Authorization: `ApplePass ${first.authenticationToken}`,
          "If-Modified-Since": first.lastModified
        }
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers.get("Last-Modified")).toBe(updated.lastModified);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Regression guard for the async-crash / error-leak audit findings (T1 + T5).
// Express 4 does not await route handlers, so before asyncHandler + a central
// errorHandler, one corrupt stored row would (a) crash the whole process on the
// next request and (b) leak err.message to the caller — including on the PUBLIC
// /api/wallet/* routes. These tests exercise a real Express app end to end.

import { describe, it, expect, afterEach, vi } from "vitest";
import express from "express";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

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
  const statePath = join(await mkdtemp(join(tmpdir(), "wpd-err-")), "passes.json");
  process.env.STATE_PATH = statePath;
  process.env.CERT_PROFILE = "dev";
  delete process.env.WEB_SERVICE_URL;
  delete process.env.PASS_TYPE_ID;
  delete process.env.TEAM_ID;
  const storage = await import("../apps/server/src/storage.js");
  const { adminRouter } = await import("../apps/server/src/routes/admin.js");
  const { walletRouter } = await import("../apps/server/src/routes/wallet.js");
  const { errorHandler } = await import("../apps/server/src/middleware/error-handler.js");
  return { statePath, storage, adminRouter, walletRouter, errorHandler };
}

// A live app + listener so requests flow through Express's real dispatch (which
// is what makes an unhandled rejection fatal without asyncHandler).
function makeApp(mounts, errorHandler) {
  const app = express();
  app.use(express.json());
  for (const [mount, router] of mounts) app.use(mount, router);
  app.use(errorHandler);   // must be last, mirroring index.js
  return app;
}

async function listen(app) {
  const server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function minimalState(serial) {
  const state = JSON.parse(await readFile("fixtures/minimal.json", "utf8"));
  state.meta.serialNumber = serial;
  return state;
}

/** Overwrite a pass row's state_json with invalid JSON via a second connection. */
function corruptStateJson(statePath, serial) {
  const dbPath = statePath.replace(/\.json$/, "") + ".sqlite";
  const raw = new DatabaseSync(dbPath);
  raw.exec("PRAGMA journal_mode = WAL");
  raw.prepare("UPDATE passes SET state_json = ? WHERE serial = ?").run("{ this is not json", serial);
  raw.close();
}

describe("async crash guard + generic error body (T1 / T5)", () => {
  let server;
  let errSpy;

  afterEach(() => {
    server?.close();
    server = undefined;
    errSpy?.mockRestore();
    restoreEnv();
    vi.resetModules();
  });

  it("returns a generic 500 (not a stack/err.message) and survives a corrupt state_json row", async () => {
    const { statePath, storage, adminRouter, errorHandler } = await boot();
    await storage.savePass(await minimalState("CORRUPT-1"));
    corruptStateJson(statePath, "CORRUPT-1");
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const app = makeApp([["/api", adminRouter]], errorHandler);
    let base;
    ({ server, base } = await listen(app));

    // GET /api/passes reads every row via snapshot(); the corrupt one throws a
    // JSON.parse SyntaxError inside the async handler.
    const res = await fetch(`${base}/api/passes`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "internal error" });
    // No implementation detail leaks to the caller.
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/SyntaxError|JSON|state_json|Unexpected|passes\.sqlite|\/Users\//);
    // The real error WAS logged server-side (backstop for operators).
    expect(errSpy).toHaveBeenCalled();

    // Process survived: an unrelated route still answers on the same server.
    const alive = await fetch(`${base}/api/roster`);
    expect(alive.status).toBe(200);
    expect(await alive.json()).toEqual([]);
  });

  it("does NOT leak err.message from the public GET /v1/passes build path", async () => {
    const { storage, walletRouter, errorHandler } = await boot();
    // A template pass whose bundle does not exist: buildStoredPass rejects with
    // an ENOENT whose message contains a filesystem path — exactly the leak T5
    // flagged at wallet.js:83.
    const rec = await storage.saveTemplatePass({
      serialNumber: "TPL-MISSING",
      template: "nope-missing",
      data: {},
      groupId: "RP1@2026-07-04",
      passTypeId: "pass.test"
    });
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const app = makeApp([["/api/wallet", walletRouter]], errorHandler);
    let base;
    ({ server, base } = await listen(app));

    const res = await fetch(`${base}/api/wallet/v1/passes/pass.test/TPL-MISSING`, {
      headers: { Authorization: `ApplePass ${rec.authenticationToken}` }
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "internal error" });
    // The raw ENOENT/path/template id must not cross the wire.
    expect(JSON.stringify(body)).not.toMatch(/ENOENT|nope-missing|pkpasstemplate|\/Users\/|no such file/);
    expect(errSpy).toHaveBeenCalled();
  });
});

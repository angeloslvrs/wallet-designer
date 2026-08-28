// A status update whose values already match what's stored (resubmitting the
// same status, or clicking "Update · push" twice) must not bump lastModified/
// updateTag or push devices — pushing "changes" that didn't happen is what
// produced the "the pass was unchanged" / "ignored if-modified-since" entries
// in the device log. Exercises a real Express app end to end, same pattern as
// admin-group-status.test.js.

import { describe, it, expect, afterEach, vi } from "vitest";
import express from "express";
import { mkdtemp } from "node:fs/promises";
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
  const statePath = join(await mkdtemp(join(tmpdir(), "wpd-noop-")), "passes.json");
  process.env.STATE_PATH = statePath;
  process.env.CERT_PROFILE = "dev";       // dev profile → APNs logs instead of pushing
  delete process.env.WEB_SERVICE_URL;
  // Pin (don't delete): admin.js pulls in env.js's `dotenv/config`, which fills an
  // unset PASS_TYPE_ID back in from this machine's real .env — silently mismatching
  // the "pass.test" passType this test registers its device under.
  process.env.PASS_TYPE_ID = "pass.test";
  delete process.env.TEAM_ID;
  const storage = await import("../apps/server/src/storage.js");
  const { adminRouter } = await import("../apps/server/src/routes/admin.js");
  const { errorHandler } = await import("../apps/server/src/middleware/error-handler.js");
  return { statePath, storage, adminRouter, errorHandler };
}

function makeApp(mounts, errorHandler) {
  const app = express();
  app.use(express.json());
  for (const [mount, router] of mounts) app.use(mount, router);
  app.use(errorHandler);
  return app;
}

async function listen(app) {
  const server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

describe("POST /api/passes/:serial/status — no-op resubmit skips the push", () => {
  let server;

  afterEach(() => {
    server?.close();
    server = undefined;
    restoreEnv();
    vi.resetModules();
  });

  it("pushes on a real change, but not on an identical resubmit", async () => {
    const { storage, adminRouter, errorHandler } = await boot();
    const serial = "NOOP-PUSH-1";
    const rec = await storage.saveTemplatePass({
      serialNumber: serial, template: "dev-sample", data: {}, groupId: "G@1", passTypeId: "pass.test"
    });
    await storage.registerDevice({
      deviceLibraryIdentifier: "dev-1",
      passTypeIdentifier: "pass.test",
      serialNumber: serial,
      pushToken: "a".repeat(64)
    });

    const app = makeApp([["/api", adminRouter]], errorHandler);
    let base;
    ({ server, base } = await listen(app));

    const post = (body) => fetch(`${base}/api/passes/${encodeURIComponent(serial)}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(r => r.json());

    const first = await post({ departureGate: "B12" });
    expect(first.ok).toBe(true);
    expect(first.push.sent).toBe(1);   // real change → device pushed

    const resubmit = await post({ departureGate: "B12" });
    expect(resubmit.ok).toBe(true);
    expect(resubmit.push.sent).toBe(0);                       // no-op → not pushed
    expect(resubmit.lastModified).toBe(first.lastModified);   // and not re-stamped

    const real = await post({ departureGate: "C3" });
    expect(real.push.sent).toBe(1);
    expect(real.lastModified).not.toBe(first.lastModified);
  });
});

// Regression guard for T11: the group-status route must apply per-member, so one
// corrupt member (e.g. a pass pointing at a template bundle that no longer
// exists) cannot abort the whole trip. Before the fix, a mid-loop throw meant
// earlier members were updated + pushed, later members were silently skipped,
// and the caller got a bare 500 with no idea which passes were touched. Now a
// partial failure is HTTP 200 with the touched passes in `results` and the
// failed ones in `errors`. Exercises a real Express app end to end.

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
  const statePath = join(await mkdtemp(join(tmpdir(), "wpd-grp-")), "passes.json");
  process.env.STATE_PATH = statePath;
  process.env.CERT_PROFILE = "dev";       // dev profile → APNs logs instead of pushing
  delete process.env.WEB_SERVICE_URL;
  delete process.env.PASS_TYPE_ID;
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

describe("POST /api/groups/:groupId/status — partial-apply reporting (T11)", () => {
  let server;
  let errSpy;

  afterEach(() => {
    server?.close();
    server = undefined;
    errSpy?.mockRestore();
    restoreEnv();
    vi.resetModules();
  });

  it("updates the healthy members and reports the corrupt one instead of aborting the trip", async () => {
    const { storage, adminRouter, errorHandler } = await boot();
    const groupId = "RP247@2026-07-04";
    // Three template passes on one trip. The middle one references a bundle that
    // does not exist on disk, so its apply throws (loadTemplate ENOENT) AFTER the
    // group has been enumerated — exactly a mid-loop failure.
    await storage.saveTemplatePass({ serialNumber: "GOOD-1", template: "dev-sample", data: {}, groupId, passTypeId: "pass.test" });
    await storage.saveTemplatePass({ serialNumber: "BAD-2", template: "nope-missing", data: {}, groupId, passTypeId: "pass.test" });
    await storage.saveTemplatePass({ serialNumber: "GOOD-3", template: "dev-sample", data: {}, groupId, passTypeId: "pass.test" });
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const app = makeApp([["/api", adminRouter]], errorHandler);
    let base;
    ({ server, base } = await listen(app));

    const res = await fetch(`${base}/api/groups/${encodeURIComponent(groupId)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departureGate: "B12" })
    });

    // Partial failure is still 200 so the caller learns the partial outcome.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // The two healthy passes updated; count reflects successes only.
    expect(body.count).toBe(2);
    expect(body.results.map(r => r.serial).sort()).toEqual(["GOOD-1", "GOOD-3"]);

    // The corrupt member is reported (serial + a message), not swallowed.
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].serial).toBe("BAD-2");
    expect(typeof body.errors[0].error).toBe("string");
    expect(body.errors[0].error.length).toBeGreaterThan(0);

    // And the healthy members really were mutated (lastModified bumped from the
    // freshly-saved value): confirm the status edit reached the store.
    const good1 = await storage.getPassRecord("GOOD-1");
    expect(good1.data.semantics.departureGate).toBe("B12");
    const bad2 = await storage.getPassRecord("BAD-2");
    expect(bad2.data.semantics?.departureGate).not.toBe("B12"); // untouched
  });
});

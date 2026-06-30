import { describe, it, expect, afterEach, vi } from "vitest";
import AdmZip from "adm-zip";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGINAL_ENV = {
  CERT_PROFILE: process.env.CERT_PROFILE,
  DOTENV_CONFIG_PATH: process.env.DOTENV_CONFIG_PATH,
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

function routeHandler(router, path, method) {
  const layer = router.stack.find(l => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`missing ${method.toUpperCase()} ${path}`);
  return layer.route.stack.at(-1).handle;
}

async function callRoute(handler, { body } = {}) {
  const res = {
    statusCode: 200,
    headers: new Map(),
    setHeader(name, value) { this.headers.set(name, value); return this; },
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.body = payload; return this; },
    json(payload) { this.body = JSON.stringify(payload); this.jsonBody = payload; return this; }
  };
  await handler({ body }, res);
  return res;
}

describe("/api/build identity overrides", () => {
  afterEach(() => {
    restoreEnv();
    vi.resetModules();
  });

  it("uses WEB_SERVICE_URL over a submitted FormState localhost URL", async () => {
    vi.resetModules();
    process.env.CERT_PROFILE = "dev";
    process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-build-")), "passes.json");
    process.env.WEB_SERVICE_URL = "https://wallet.example.test/api/wallet";
    delete process.env.PASS_TYPE_ID;
    delete process.env.TEAM_ID;

    const { buildRouter } = await import("../apps/server/src/routes/build.js");
    const handler = routeHandler(buildRouter, "/build", "post");

    const state = JSON.parse(await readFile("fixtures/minimal.json", "utf8"));
    state.meta.serialNumber = "BUILD-URL-1";
    state.meta.webServiceURL = "http://localhost:4317/api/wallet";

    const res = await callRoute(handler, { body: state });
    expect(res.statusCode).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/application\/vnd\.apple\.pkpass/);
    const pass = JSON.parse(new AdmZip(res.body).getEntry("pass.json").getData().toString("utf8"));
    expect(pass.webServiceURL).toBe("https://wallet.example.test/api/wallet");
  });
});

describe("server env production WEB_SERVICE_URL guard", () => {
  afterEach(() => {
    restoreEnv();
    vi.resetModules();
  });

  it("rejects prod profile without WEB_SERVICE_URL", async () => {
    const { validateProdWebServiceURL } = await import("../apps/server/src/env-validate.js");
    expect(() => validateProdWebServiceURL("prod")).toThrow(/WEB_SERVICE_URL/);
  });

  it("rejects prod profile with a non-HTTPS WEB_SERVICE_URL", async () => {
    const { validateProdWebServiceURL } = await import("../apps/server/src/env-validate.js");
    expect(() => validateProdWebServiceURL("prod", "http://wallet.example.test/api/wallet")).toThrow(/https/);
  });

  it("accepts prod profile with an HTTPS WEB_SERVICE_URL", async () => {
    const { validateProdWebServiceURL } = await import("../apps/server/src/env-validate.js");
    expect(() => validateProdWebServiceURL("prod", "https://wallet.example.test/api/wallet")).not.toThrow();
  });
});

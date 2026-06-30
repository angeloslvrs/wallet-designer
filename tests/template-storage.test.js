import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// storage.js resolves STATE_PATH at import time, so set it before the dynamic
// import — these tests must never touch the real state/passes.json.
let storage;
const ORIG_PASS_TYPE_ID = process.env.PASS_TYPE_ID;

beforeAll(async () => {
  process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-state-")), "passes.json");
  delete process.env.PASS_TYPE_ID;
  storage = await import("../apps/server/src/storage.js");
});

afterAll(() => {
  process.env.PASS_TYPE_ID = ORIG_PASS_TYPE_ID;
});

function minimalFormState(serial) {
  return {
    meta: { serialNumber: serial, passTypeId: "pass.dev.local", teamId: "DEV0000000" },
    flight: { airlineCode: "RP", flightNumber: "247", departure: { depart: "2026-06-01T08:15:00-07:00" } },
    passenger: { name: "ANGELO SOLIVERES", seats: [{ number: "14A" }] }
  };
}

describe("saveTemplatePass", () => {
  it("stores a template-backed record with an explicit groupId and a generated token", async () => {
    const rec = await storage.saveTemplatePass({
      serialNumber: "TPL-100",
      template: "dev-sample",
      data: { gate: "B12" },
      groupId: "RP247@2026-06-01",
      passTypeId: "pass.dev.placeholder"
    });
    expect(rec.template).toBe("dev-sample");
    expect(rec.data).toEqual({ gate: "B12" });
    expect(rec.groupId).toBe("RP247@2026-06-01");
    expect(rec.passTypeIdentifier).toBe("pass.dev.placeholder");
    expect(rec.authenticationToken).toMatch(/^[0-9a-f]{32}$/);
    expect(rec.state).toBeUndefined();
  });

  it("keeps the authenticationToken stable when the same serial is re-issued", async () => {
    const first = await storage.saveTemplatePass({
      serialNumber: "TPL-101", template: "dev-sample", data: { gate: "A1" },
      groupId: "g1", passTypeId: "pass.dev.placeholder"
    });
    const second = await storage.saveTemplatePass({
      serialNumber: "TPL-101", template: "dev-sample", data: { gate: "A2" },
      groupId: "g1", passTypeId: "pass.dev.placeholder"
    });
    expect(second.authenticationToken).toBe(first.authenticationToken);
    expect(second.data.gate).toBe("A2");
  });

  it("keeps the token stable when a FormState pass is re-issued as a template pass", async () => {
    const formRec = await storage.savePass(minimalFormState("MIX-1"));
    const tplRec = await storage.saveTemplatePass({
      serialNumber: "MIX-1", template: "dev-sample", data: {},
      groupId: "g2", passTypeId: "pass.dev.placeholder"
    });
    expect(tplRec.authenticationToken).toBe(formRec.authenticationToken);
    expect(tplRec.template).toBe("dev-sample");
    expect(tplRec.state).toBeUndefined();
  });

  it("keeps the authenticationToken stable when a FormState pass is re-issued with a submitted token", async () => {
    const first = await storage.savePass({
      ...minimalFormState("FORM-STABLE-1"),
      meta: { ...minimalFormState("FORM-STABLE-1").meta, authenticationToken: "11111111111111111111111111111111" }
    });
    const second = await storage.savePass({
      ...minimalFormState("FORM-STABLE-1"),
      meta: { ...minimalFormState("FORM-STABLE-1").meta, authenticationToken: "22222222222222222222222222222222" }
    });
    expect(second.authenticationToken).toBe(first.authenticationToken);
    expect(second.state.meta.authenticationToken).toBe(first.authenticationToken);
  });

  it("forces the env WEB_SERVICE_URL over a submitted localhost URL, and keeps the submitted one when env is unset", async () => {
    const original = process.env.WEB_SERVICE_URL;
    try {
      process.env.WEB_SERVICE_URL = "https://wallet.example.test/api/wallet";
      const forced = await storage.savePass({
        ...minimalFormState("URL-FORCED-1"),
        meta: { ...minimalFormState("URL-FORCED-1").meta, webServiceURL: "http://localhost:4317/api/wallet" }
      });
      expect(forced.state.meta.webServiceURL).toBe("https://wallet.example.test/api/wallet");

      delete process.env.WEB_SERVICE_URL;
      const fallback = await storage.savePass({
        ...minimalFormState("URL-FALLBACK-1"),
        meta: { ...minimalFormState("URL-FALLBACK-1").meta, webServiceURL: "http://localhost:4317/api/wallet" }
      });
      expect(fallback.state.meta.webServiceURL).toBe("http://localhost:4317/api/wallet");
    } finally {
      if (original === undefined) delete process.env.WEB_SERVICE_URL;
      else process.env.WEB_SERVICE_URL = original;
    }
  });

  it("lets PASS_TYPE_ID force the stored pass type identifier", async () => {
    process.env.PASS_TYPE_ID = "pass.com.example.forced";
    try {
      const rec = await storage.saveTemplatePass({
        serialNumber: "TPL-102", template: "dev-sample", data: {},
        groupId: "g3", passTypeId: "pass.dev.placeholder"
      });
      expect(rec.passTypeIdentifier).toBe("pass.com.example.forced");
    } finally {
      delete process.env.PASS_TYPE_ID;
    }
  });

  it("is retrievable through getPass like any other pass", async () => {
    await storage.saveTemplatePass({
      serialNumber: "TPL-103", template: "dev-sample", data: { gate: "C3" },
      groupId: "g4", passTypeId: "pass.dev.placeholder"
    });
    const rec = await storage.getPass("pass.dev.placeholder", "TPL-103");
    expect(rec?.template).toBe("dev-sample");
  });
});

describe("getPassRecord", () => {
  it("returns any stored record by serial, regardless of shape, and null when missing", async () => {
    await storage.saveTemplatePass({
      serialNumber: "TPL-120", template: "dev-sample", data: {},
      groupId: "g6", passTypeId: "pass.dev.placeholder"
    });
    expect((await storage.getPassRecord("TPL-120"))?.template).toBe("dev-sample");
    expect(await storage.getPassRecord("MISSING")).toBeNull();
  });
});

describe("updatePassData", () => {
  it("applies the mutator to rec.data and refreshes lastModified", async () => {
    const before = await storage.saveTemplatePass({
      serialNumber: "TPL-110", template: "dev-sample", data: { gate: "A1" },
      groupId: "g5", passTypeId: "pass.dev.placeholder"
    });
    const after = await storage.updatePassData("TPL-110", data => ({ ...data, gate: "B9" }));
    expect(after.data).toEqual({ gate: "B9" });
    expect(Date.parse(after.lastModified)).toBeGreaterThanOrEqual(Date.parse(before.lastModified));
  });

  it("returns null for an unknown serial", async () => {
    expect(await storage.updatePassData("NOPE", d => d)).toBeNull();
  });

  it("returns null for a FormState-backed pass (use updatePassState for those)", async () => {
    await storage.savePass(minimalFormState("FORM-1"));
    expect(await storage.updatePassData("FORM-1", d => d)).toBeNull();
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Issuing from a saved Studio design posts a FormState body with an envelope
// `designName`; the store records it (passes.design_name) so the Templates
// shelf can count issues per design. meta.groupId pins the trip id explicitly.
let registerPass, getPassRecord, snapshot, applyStatusPatch;
const fixture = async () => JSON.parse(await readFile("fixtures/fully-loaded.json", "utf8"));

beforeAll(async () => {
  process.env.TEMPLATES_DIR = "templates";
  process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-state-dn-")), "passes.json");
  ({ registerPass } = await import("../apps/server/src/routes/admin.js"));
  ({ getPassRecord, snapshot } = await import("../apps/server/src/storage.js"));
});

describe("designName on FormState passes", () => {
  it("is stored, echoed, and never leaks into the stored FormState", async () => {
    const st = await fixture();
    st.meta = { ...st.meta, serialNumber: "DN-1", groupId: "RP247@2026-06-01" };
    const res = await registerPass({ ...st, designName: "rocket" });
    expect(res).toMatchObject({ serialNumber: "DN-1", designName: "rocket", groupId: "RP247@2026-06-01", created: true });
    const rec = await getPassRecord("DN-1");
    expect(rec.designName).toBe("rocket");
    expect(rec.state.designName).toBeUndefined();
    expect((await snapshot()).passes["DN-1"].designName).toBe("rocket");
  });

  it("is cleared when the serial is re-issued without one; the token stays stable", async () => {
    const st = await fixture();
    st.meta = { ...st.meta, serialNumber: "DN-2" };
    const first = await registerPass({ ...st, designName: "rocket" });
    const second = await registerPass(st);
    expect(second.authenticationToken).toBe(first.authenticationToken);
    expect((await getPassRecord("DN-2")).designName).toBeUndefined();
  });

  it("rejects a designName that isn't a design-name slug", async () => {
    const st = await fixture();
    st.meta = { ...st.meta, serialNumber: "DN-3" };
    await expect(registerPass({ ...st, designName: "../etc" })).rejects.toThrow(/designName/);
    await expect(registerPass({ ...st, designName: 7 })).rejects.toThrow(/designName/);
  });
});

describe("status updates on a pass issued from a design with confirmed bindings", () => {
  it("use the design's stored map (by designName); a pass without one falls back to discovery", async () => {
    const { applyStatusToStoredPass } = await import("../apps/server/src/routes/admin.js");
    const { saveTemplateBindings } = await import("../apps/server/src/storage.js");
    await saveTemplateBindings("studio:pal", { currentBoardingDate: { fieldKey: "boarding", source: "manual", confidence: "high" } });
    const st = await fixture();
    // Drifted face: the time field doesn't match the semantic, so discovery can't bind it.
    st.displayFields.auxiliary = [{ key: "boarding", label: "BOARDING", value: "", timeFormat: "24h" }];
    const next = "2026-06-01T08:00:00-07:00";

    st.meta = { ...st.meta, serialNumber: "DN-B1" };
    await registerPass({ ...st, designName: "pal" });
    const bound = await applyStatusToStoredPass("DN-B1", { currentBoardingDate: next });
    expect(bound.rec.state.displayFields.auxiliary[0].value).toBe(next);
    expect(bound.skipped).toEqual([]);

    st.meta = { ...st.meta, serialNumber: "DN-B2" };
    await registerPass(st);
    const unbound = await applyStatusToStoredPass("DN-B2", { currentBoardingDate: next });
    expect(unbound.rec.state.displayFields.auxiliary[0].value).toBe("");
    expect(unbound.skipped).toContain("currentBoardingDate");
  });
});

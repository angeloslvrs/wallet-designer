import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Saved Studio designs live in designs/ (gitignored user data), not fixtures/
// (CI's tracked regression fixtures, now read-only). The shelf lists them as
// kind=studio via /api/studio-templates.
let designs, handleStudioTemplateList, fixturesRouter, dir;
function mkRes() { return { statusCode: 200, payload: null, status(c){this.statusCode=c;return this;}, json(o){this.payload=o;return this;} }; }
const call = async (h, req) => { const res = mkRes(); await h(req, res); return res; };

beforeAll(async () => {
  dir = join(await mkdtemp(join(tmpdir(), "wpd-designs-")), "designs"); // not created yet: first PUT makes it
  process.env.DESIGNS_DIR = dir;
  process.env.TEMPLATES_DIR = await mkdtemp(join(tmpdir(), "wpd-tpl-designs-"));
  process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-state-designs-")), "passes.json");
  designs = await import("../apps/server/src/routes/designs.js");
  ({ handleStudioTemplateList } = await import("../apps/server/src/routes/templates.js"));
  ({ fixturesRouter } = await import("../apps/server/src/routes/fixtures.js"));
});

describe("/api/designs", () => {
  it("lists nothing when designs/ doesn't exist yet", async () => {
    expect((await call(designs.handleDesignList, {})).payload).toEqual([]);
  });

  it("PUT creates (201), then overwrites (200); GET returns it; list is sorted", async () => {
    const fl = JSON.parse(await (await import("node:fs/promises")).readFile("fixtures/fully-loaded.json", "utf8"));
    let r = await call(designs.handleDesignPut, { params: { name: "rocket" }, body: fl });
    expect(r.statusCode).toBe(201);
    expect(r.payload).toMatchObject({ ok: true, name: "rocket", created: true });
    r = await call(designs.handleDesignPut, { params: { name: "rocket" }, body: { ...fl, meta: { ...fl.meta, description: "v2" } } });
    expect(r.statusCode).toBe(200);
    expect(r.payload.created).toBe(false);
    await call(designs.handleDesignPut, { params: { name: "alpha" }, body: fl });
    expect((await call(designs.handleDesignList, {})).payload).toEqual(["alpha", "rocket"]);
    expect((await call(designs.handleDesignGet, { params: { name: "rocket" } })).payload.meta.description).toBe("v2");
    // atomic write leaves no temp files behind
    expect((await readdir(dir)).filter(f => f.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects path-ish or empty names and non-object bodies", async () => {
    for (const name of ["../x", ".hidden", "", "a/b", "x".repeat(65)]) {
      expect((await call(designs.handleDesignPut, { params: { name }, body: {} })).statusCode).toBe(400);
      expect((await call(designs.handleDesignGet, { params: { name } })).statusCode).toBe(400);
    }
    expect((await call(designs.handleDesignPut, { params: { name: "ok" }, body: [1] })).statusCode).toBe(400);
  });

  it("404s a missing design on GET and DELETE; DELETE removes it", async () => {
    expect((await call(designs.handleDesignGet, { params: { name: "nope" } })).statusCode).toBe(404);
    expect((await call(designs.handleDesignDelete, { params: { name: "nope" } })).statusCode).toBe(404);
    expect((await call(designs.handleDesignDelete, { params: { name: "alpha" } })).payload).toEqual({ ok: true });
    expect((await call(designs.handleDesignList, {})).payload).toEqual(["rocket"]);
  });

  it("feeds /api/studio-templates; a design that won't build is listed with an error", async () => {
    await writeFile(join(dir, "broken.json"), "{not json");
    const list = (await call(handleStudioTemplateList, {})).payload;
    expect(list.map(x => x.id)).toEqual(["broken", "rocket"]);
    expect(list[0].error).toBeTruthy();
    expect(list[1]).toMatchObject({ kind: "studio", description: "v2" });
    expect(list[1].preview.boardingPass).toBeTruthy();
    expect(list.some(x => x.id === "fully-loaded")).toBe(false); // CI fixtures stay off the shelf
  });
});

describe("/api/fixtures is read-only", () => {
  it("exposes only GET routes", () => {
    const methods = fixturesRouter.stack.flatMap(l => Object.keys(l.route?.methods ?? {}));
    expect(methods.every(m => m === "get")).toBe(true);
  });
});

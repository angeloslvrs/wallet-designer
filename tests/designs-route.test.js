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

describe("studio templates share the designer merge surface", () => {
  it("ships fieldKeys, descriptors, discovered bindings and semantics", async () => {
    const list = (await call(handleStudioTemplateList, {})).payload;
    const t = list.find(x => x.id === "rocket");
    expect(t.fieldKeys).toContain("passenger");
    expect(t.bindings.passengerName.fieldKey).toBe("passenger");
    expect(t.bindings.seats.fieldKey).toBe("seat");
    expect(t.fields.find(f => f.key === "boarding")).toMatchObject({ kind: "date", boundSemantic: "currentBoardingDate" });
    expect(t.semantics.airlineCode).toBe("RP");
  });
});

describe("persisted studio bindings (/api/designs/:name/bindings)", () => {
  // An airline-style design: no sample values to discover from, a 24h time
  // field and a token label — what conversion will produce.
  let airline;
  const listed = async (id) => (await call(handleStudioTemplateList, {})).payload.find(x => x.id === id);
  const put = (name, body) => call(designs.handleDesignBindingsPut, { params: { name }, body });

  beforeAll(async () => {
    const fl = JSON.parse(await (await import("node:fs/promises")).readFile("fixtures/fully-loaded.json", "utf8"));
    airline = {
      ...fl,
      semantics: { airlineCode: "PR" },
      displayFields: {
        header: [{ key: "gate", label: "GATE", value: "" }],
        primary: [{ key: "depart", label: "{departureCityName:upper}", value: "" }],
        secondary: [],
        auxiliary: [{ key: "boarding", label: "BOARDING", value: "", timeFormat: "24h" }],
        back: []
      }
    };
    await call(designs.handleDesignPut, { params: { name: "pal" }, body: airline });
  });

  it("a value-less design has nothing to discover and nothing saved", async () => {
    const t = await listed("pal");
    expect(t.bindingsSaved).toBe(false);
    expect(t.bindings.currentBoardingDate).toBeUndefined();
  });

  it("PUT stores confirmed bindings; the shelf entry uses them", async () => {
    const r = await put("pal", { currentBoardingDate: "boarding", departureGate: "gate" });
    expect(r.statusCode).toBe(200);
    expect(r.payload.bindings.currentBoardingDate).toEqual({ fieldKey: "boarding", source: "manual", confidence: "high" });
    const t = await listed("pal");
    expect(t.bindingsSaved).toBe(true);
    expect(t.bindings.currentBoardingDate.fieldKey).toBe("boarding");
    expect(t.fields.find(f => f.key === "boarding")).toMatchObject({ kind: "date", boundSemantic: "currentBoardingDate" });
  });

  it("validates: undeclared field 400, unknown semantic 400, missing design 404, bad name 400", async () => {
    expect((await put("pal", { currentBoardingDate: "nope" })).statusCode).toBe(400);
    expect((await put("pal", { notASemantic: "boarding" })).statusCode).toBe(400);
    expect((await put("ghost", { currentBoardingDate: "boarding" })).statusCode).toBe(404);
    expect((await put("../x", {})).statusCode).toBe(400);
    expect((await put("pal", [1])).statusCode).toBe(400);
  });

  it("re-saving the design keeps them; a removed field's binding is filtered, not lost", async () => {
    const noGate = { ...airline, displayFields: { ...airline.displayFields, header: [] } };
    await call(designs.handleDesignPut, { params: { name: "pal" }, body: noGate });
    let t = await listed("pal");
    expect(t.bindingsSaved).toBe(true);
    expect(t.bindings.departureGate).toBeUndefined();
    expect(t.bindings.currentBoardingDate.fieldKey).toBe("boarding");
    await call(designs.handleDesignPut, { params: { name: "pal" }, body: airline });
    t = await listed("pal");
    expect(t.bindings.departureGate.fieldKey).toBe("gate");
  });

  it("ships the unresolved surface as preview (tokens + ISO time fields intact)", async () => {
    const t = await listed("pal");
    expect(t.preview.boardingPass.primaryFields[0].label).toBe("{departureCityName:upper}");
    expect(t.preview.boardingPass.auxiliaryFields[0].timeFormat).toBe("24h");
  });

  it("DELETE resets to live discovery; deleting the design drops its bindings", async () => {
    expect((await call(designs.handleDesignBindingsDelete, { params: { name: "pal" } })).payload).toEqual({ ok: true });
    expect((await listed("pal")).bindingsSaved).toBe(false);
    await put("pal", { currentBoardingDate: "boarding" });
    await call(designs.handleDesignDelete, { params: { name: "pal" } });
    await call(designs.handleDesignPut, { params: { name: "pal" }, body: airline });
    expect((await listed("pal")).bindingsSaved).toBe(false);
  });
});

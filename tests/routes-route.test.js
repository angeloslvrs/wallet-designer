import { describe, it, expect, beforeAll } from "vitest";
import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// /api/routes: saved routes in routes/ (gitignored user data). A route attaches
// to a template that must exist; a template or design with routes can't be
// deleted out from under them.
let R, designs, handleTemplateDelete, dir;
function mkRes() { return { statusCode: 200, payload: null, status(c){this.statusCode=c;return this;}, json(o){this.payload=o;return this;} }; }
const call = async (h, req) => { const res = mkRes(); await h(req, res); return res; };
const route = (over = {}) => ({
  template: { kind: "studio", id: "pal" },
  values: { flightCode: "PR2987", departureAirportCode: "MNL", destinationAirportCode: "TAC" },
  schedule: { boarding: "16:05", departure: "16:35", arrival: "17:55", arrivalDayOffset: 0 },
  ...over
});

beforeAll(async () => {
  dir = join(await mkdtemp(join(tmpdir(), "wpd-routes-")), "routes");
  process.env.ROUTES_DIR = dir;
  process.env.DESIGNS_DIR = await mkdtemp(join(tmpdir(), "wpd-routes-designs-"));
  // A temp copy: a regressed 409 must never delete the tracked bundle.
  const tpl = await mkdtemp(join(tmpdir(), "wpd-routes-tpl-"));
  await cp("templates/cebpac.pkpasstemplate", join(tpl, "cebpac.pkpasstemplate"), { recursive: true });
  process.env.TEMPLATES_DIR = tpl;
  process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-routes-state-")), "passes.json");
  R = await import("../apps/server/src/routes/flight-routes.js");
  designs = await import("../apps/server/src/routes/designs.js");
  ({ handleTemplateDelete } = await import("../apps/server/src/routes/templates.js"));
  const fl = JSON.parse(await readFile("fixtures/fully-loaded.json", "utf8"));
  await call(designs.handleDesignPut, { params: { name: "pal" }, body: fl });
});

describe("/api/routes", () => {
  it("lists nothing before the first save", async () => {
    expect((await call(R.handleRouteList, {})).payload).toEqual([]);
  });

  it("PUT creates (201) then overwrites (200); GET and list return it with its id", async () => {
    let r = await call(R.handleRoutePut, { params: { id: "PR2987-MNL-TAC" }, body: route() });
    expect(r.statusCode).toBe(201);
    r = await call(R.handleRoutePut, { params: { id: "PR2987-MNL-TAC" }, body: route({ fields: { note: "T3" } }) });
    expect(r.statusCode).toBe(200);
    const got = (await call(R.handleRouteGet, { params: { id: "PR2987-MNL-TAC" } })).payload;
    expect(got).toMatchObject({ id: "PR2987-MNL-TAC", template: { kind: "studio", id: "pal" }, fields: { note: "T3" } });
    expect((await call(R.handleRouteList, {})).payload.map(x => x.id)).toEqual(["PR2987-MNL-TAC"]);
    expect((await readdir(dir)).filter(f => f.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects invalid bodies, bad ids and missing templates", async () => {
    expect((await call(R.handleRoutePut, { params: { id: "x" }, body: route({ values: { departureGate: "12" } }) })).statusCode).toBe(400);
    expect((await call(R.handleRoutePut, { params: { id: "../x" }, body: route() })).statusCode).toBe(400);
    const missing = await call(R.handleRoutePut, { params: { id: "x" }, body: route({ template: { kind: "studio", id: "ghost" } }) });
    expect(missing.statusCode).toBe(400);
    expect(missing.payload.error).toContain("ghost");
    expect((await call(R.handleRoutePut, { params: { id: "x" }, body: route({ template: { kind: "designer", id: "ghost" } }) })).statusCode).toBe(400);
    expect((await call(R.handleRoutePut, { params: { id: "5J" }, body: route({ template: { kind: "designer", id: "cebpac" } }) })).statusCode).toBe(201);
  });

  it("a design or bundle with routes can't be deleted (409 names them)", async () => {
    const d = await call(designs.handleDesignDelete, { params: { name: "pal" } });
    expect(d.statusCode).toBe(409);
    expect(d.payload.routes).toEqual(["PR2987-MNL-TAC"]);
    const t = await call(handleTemplateDelete, { params: { id: "cebpac" } });
    expect(t.statusCode).toBe(409);
    expect(t.payload.routes).toEqual(["5J"]);
  });

  it("DELETE removes a route (404 when gone), freeing its template", async () => {
    expect((await call(R.handleRouteDelete, { params: { id: "PR2987-MNL-TAC" } })).payload).toEqual({ ok: true });
    expect((await call(R.handleRouteDelete, { params: { id: "PR2987-MNL-TAC" } })).statusCode).toBe(404);
    expect((await call(R.handleRouteGet, { params: { id: "PR2987-MNL-TAC" } })).statusCode).toBe(404);
    expect((await call(designs.handleDesignDelete, { params: { name: "pal" } })).payload).toEqual({ ok: true });
    await call(R.handleRouteDelete, { params: { id: "5J" } });
  });
});

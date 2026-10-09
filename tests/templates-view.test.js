// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountTemplates, templateIdFromFile, fieldSamples, guessCount, needsReview, airlineGroups } from "../apps/designer/src/templates.js";

// Templates shelf: Pass Designer bundles and Studio designs on one shelf, plus
// the Bindings review screen. Studio designs (designs/) delete via
// /api/designs/:name; a refused template delete (409 while
// passes still rebuild from it) surfaces the server's reason; uploading a
// bundle lands on its Bindings screen; confirming PUTs the edited map.
const flush = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await flush(); };

const PREVIEW = { logoText: "Odyssey Air", backgroundColor: "rgb(15,91,90)", boardingPass: {
  headerFields: [{ key: "gate", label: "GATE", value: "C4" }],
  primaryFields: [{ key: "origin", label: "TAIPEI", value: "TPE" }, { key: "dest", label: "MANILA", value: "MNL" }],
  secondaryFields: [{ key: "passenger", label: "PASSENGER", value: "SURNAME/GIVEN" }]
}, barcodes: [{ format: "PKBarcodeFormatQR", message: "x", altText: "OD118" }] };

let root, calls, designer, studioList, routesList, deleteResp;
beforeEach(() => {
  calls = [];
  deleteResp = { ok: false, status: 409, body: { error: 'template "odyssey" is referenced by 2 issued pass(es) — delete those passes first' } };
  designer = [
    { id: "odyssey", kind: "designer", organizationName: "Odyssey Air", fieldKeys: ["gate", "origin", "dest", "passenger"], assets: ["icon@2x.png"],
      bindings: { departureGate: { fieldKey: "gate", source: "value-match", confidence: "medium" }, currentBoardingDate: { fieldKey: "boardingTime", source: "date-proximity", confidence: "medium" }, passengerName: { fieldKey: "passenger", source: "manual", confidence: "high" } },
      preview: PREVIEW, logo: null }
  ];
  routesList = [];
  studioList = [{ id: "fully-loaded", kind: "studio", organizationName: "Rocket Partners Airlines", preview: { ...PREVIEW, logoText: "Rocket Partners" } }];
  globalThis.confirm = () => true;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method ?? "GET", body: opts.body });
    const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
    if (u === "/api/templates") return json(designer);
    if (u === "/api/studio-templates") return json(studioList);
    if (u === "/api/routes") return json(routesList);
    if (u.startsWith("/api/routes/")) return json({ ok: true });
    if (opts.method === "DELETE" && u.endsWith("/bindings")) return json({ ok: true });
    if (u === "/api/passes") return json([{ serial: "a", template: "odyssey" }, { serial: "b", template: "odyssey" }, { serial: "c", designName: "fully-loaded" }]);
    if (opts.method === "DELETE" && u.startsWith("/api/designs/")) return json({ ok: true });
    if (opts.method === "DELETE") return json(deleteResp.body, deleteResp.ok, deleteResp.status);
    if (opts.method === "PUT" && u.endsWith("/bindings")) return json({ id: "odyssey", bindings: JSON.parse(opts.body) });
    if (opts.method === "POST" && u.startsWith("/api/templates/")) {
      designer = [...designer, { id: "summer-air", kind: "designer", fieldKeys: ["gate"], assets: [], bindings: { departureGate: { fieldKey: "gate", source: "value-match", confidence: "medium" } }, preview: PREVIEW }];
      return json({ id: "summer-air", fieldKeys: ["gate"] }, true, 201);
    }
    throw new Error(`unexpected fetch: ${opts.method ?? "GET"} ${u}`);
  };
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { root._mountAbort?.abort(); root.remove(); delete globalThis.fetch; delete globalThis.confirm; });

describe("pure helpers", () => {
  it("slugs a dropped bundle file name into a template id", () => {
    expect(templateIdFromFile("Odyssey Air.pkpasstemplate.zip")).toBe("odyssey-air");
    expect(templateIdFromFile("cebpac.zip")).toBe("cebpac");
  });
  it("collects sample values by field key and counts only bindings that need a human look", () => {
    expect(fieldSamples(PREVIEW)).toMatchObject({ gate: "C4", origin: "TPE", passenger: "SURNAME/GIVEN" });
    // departureGate → gate shares a word: matched. currentBoardingDate → boardingTime by timing: check.
    expect(needsReview("departureGate", { fieldKey: "gate", source: "value-match", confidence: "medium" })).toBe(false);
    expect(needsReview("flightCode", { fieldKey: "flight", source: "value-match", confidence: "medium" })).toBe(false);
    expect(needsReview("seats", { fieldKey: "seat", source: "seat-composite", confidence: "medium" })).toBe(true);
    expect(needsReview("destinationAirportCode", { fieldKey: "arrive", source: "value-match", confidence: "medium" })).toBe(true);
    expect(needsReview("passengerName", { fieldKey: "x", source: "manual", confidence: "high" })).toBe(false);
    expect(guessCount(designer[0].bindings)).toBe(1);
  });
});

describe("Templates shelf", () => {
  it("renders both kinds with thumbnails, kind chips, issued counts and a guess badge", async () => {
    mountTemplates(root, {});
    await settle();
    const od = root.querySelector('.tpl-card[data-tpl="odyssey"]');
    expect(od.dataset.kind).toBe("designer");
    expect(od.textContent).toContain("2 issued");
    expect(od.textContent).toMatch(/1 binding to check/);
    expect(od.querySelector(".wallet-card")).toBeTruthy();     // Apple-faithful thumbnail
    const fl = root.querySelector('.tpl-card[data-tpl="fully-loaded"]');
    expect(fl.dataset.kind).toBe("studio");
    expect(fl.querySelector(".wallet-card")).toBeTruthy();
  });

  it("counts studio issues by designName and keeps Issue as the only primary", async () => {
    mountTemplates(root, {});
    await settle();
    expect(root.querySelector('.tpl-card[data-tpl="fully-loaded"]').textContent).toContain("1 issued");
    expect(root.querySelector('.tpl-card[data-tpl="odyssey"] [data-act="tpl-del"]')).toBeTruthy();
    const primaries = [...root.querySelectorAll(".btn-primary:not([disabled])")];
    expect(primaries.every(b => b.dataset.act === "issue")).toBe(true);
  });

  it("deletes a studio design through /api/designs after a confirm that says issued passes keep working", async () => {
    let asked = "";
    globalThis.confirm = (msg) => { asked = msg; return true; };
    mountTemplates(root, {});
    await settle();
    root.querySelector('.tpl-card[data-tpl="fully-loaded"] [data-act="design-del"]').click();
    await settle();
    expect(asked).toMatch(/1 pass already issued from it keep working/);
    expect(calls.some(c => c.method === "DELETE" && c.url === "/api/designs/fully-loaded")).toBe(true);
    expect(calls.some(c => c.method === "DELETE" && c.url.startsWith("/api/templates/"))).toBe(false);
  });

  it("surfaces the server's reason when a template delete is refused", async () => {
    mountTemplates(root, {});
    await settle();
    root.querySelector('.tpl-card[data-tpl="odyssey"] [data-act="tpl-del"]').click();
    await settle();
    expect(root.querySelector('[data-tpl-status="odyssey"]').textContent).toMatch(/referenced by 2 issued pass/);
    expect(root.querySelector('.tpl-card[data-tpl="odyssey"]')).toBeTruthy();
  });

  it("routes Issue and Edit design to the host callbacks", async () => {
    const seen = [];
    mountTemplates(root, { onIssue: (id, kind) => seen.push(["issue", id, kind]), onEditDesign: (id) => seen.push(["edit", id]) });
    await settle();
    root.querySelector('.tpl-card[data-tpl="odyssey"] [data-act="issue"]').click();
    root.querySelector('.tpl-card[data-tpl="fully-loaded"] [data-act="issue"]').click();
    root.querySelector('.tpl-card[data-tpl="fully-loaded"] [data-act="edit-design"]').click();
    expect(seen).toEqual([["issue", "odyssey", "designer"], ["issue", "fully-loaded", "studio"], ["edit", "fully-loaded"]]);
  });

  it("uploading a bundle lands on its Bindings screen", async () => {
    mountTemplates(root, {});
    await settle();
    const input = root.querySelector("#tpl-file");
    const file = new File(["zip-bytes"], "Summer Air.zip", { type: "application/zip" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(calls.some(c => c.method === "POST" && c.url === "/api/templates/summer-air")).toBe(true);
    expect(root.querySelector("h1").textContent).toContain("summer-air · bindings");
  });
});

describe("Bindings screen", () => {
  it("shows bound semantics with confidence + sample, and Confirm PUTs the edited map", async () => {
    mountTemplates(root, { bindingsFor: "odyssey" });
    await settle();
    const gateRow = root.querySelector('[data-sem-row="departureGate"]');
    expect(gateRow.textContent).toMatch(/matched/i);
    expect(gateRow.querySelector(".bind-sample").textContent).toBe("C4");
    expect(root.querySelector('[data-sem-row="currentBoardingDate"]').textContent).toMatch(/check/i);
    expect(gateRow.querySelector("select").getAttribute("aria-labelledby")).toBe("sem-departureGate");
    expect(root.querySelector('[data-sem-row="passengerName"]').textContent).toMatch(/confirmed/i);
    // Add a binding, then confirm.
    root.querySelector("select[data-add-sem]").value = "destinationAirportCode";
    root.querySelector("select[data-add-field]").value = "dest";
    root.querySelector('[data-act="bind-add"]').click();
    root.querySelector('[data-act="bind-save"]').click();
    await settle();
    const put = calls.find(c => c.method === "PUT");
    expect(JSON.parse(put.body)).toEqual({ departureGate: "gate", currentBoardingDate: "boardingTime", passengerName: "passenger", destinationAirportCode: "dest" });
    expect(root.querySelector("#tpl-flash").textContent).toMatch(/Saved 4 binding/);
  });
});

describe("Bindings for Studio designs", () => {
  const PAL = (saved) => ({
    id: "pal", kind: "studio", organizationName: "Philippine Airlines", bindingsSaved: saved,
    fieldKeys: ["gate", "boarding", "depart"],
    bindings: saved
      ? { currentBoardingDate: { fieldKey: "boarding", source: "manual", confidence: "high" } }
      : { departureAirportCode: { fieldKey: "depart", source: "value-match", confidence: "medium" }, destinationAirportCode: { fieldKey: "gate", source: "value-match", confidence: "medium" } },
    preview: PREVIEW, logo: null
  });

  it("a studio card offers Bindings, flags guesses only while nothing is confirmed", async () => {
    studioList = [PAL(false)];
    mountTemplates(root, {});
    await settle();
    const card = root.querySelector('.tpl-card[data-tpl="pal"]');
    expect(card.querySelector('[data-act="bindings"][data-kind="studio"]')).toBeTruthy();
    expect(card.textContent).toMatch(/1 binding to check/);
    root._mountAbort.abort();
    studioList = [PAL(true)];
    mountTemplates(root, {});
    await settle();
    expect(root.querySelector('.tpl-card[data-tpl="pal"]').textContent).not.toMatch(/to check/);
  });

  it("opens the design's bindings and Confirm PUTs /api/designs/:name/bindings", async () => {
    studioList = [PAL(false)];
    mountTemplates(root, {});
    await settle();
    root.querySelector('.tpl-card[data-tpl="pal"] [data-act="bindings"]').click();
    expect(root.querySelector("h1").textContent).toContain("pal · bindings");
    expect(root.textContent).toContain("Studio design");
    const opts = [...root.querySelector('select[data-add-field]').options].map(o => o.value);
    expect(opts).toEqual(["", "gate", "boarding", "depart"]);
    root.querySelector("select[data-add-sem]").value = "currentBoardingDate";
    root.querySelector("select[data-add-field]").value = "boarding";
    root.querySelector('[data-act="bind-add"]').click();
    root.querySelector('[data-act="bind-save"]').click();
    await settle();
    const put = calls.find(c => c.method === "PUT");
    expect(put.url).toBe("/api/designs/pal/bindings");
    expect(JSON.parse(put.body)).toEqual({ departureAirportCode: "depart", destinationAirportCode: "gate", currentBoardingDate: "boarding" });
  });

  it("Reset to automatic DELETEs the confirmed map (only offered once saved)", async () => {
    studioList = [PAL(true)];
    mountTemplates(root, {});
    await settle();
    root.querySelector('.tpl-card[data-tpl="pal"] [data-act="bindings"]').click();
    root.querySelector('[data-act="bind-reset"]').click();
    await settle();
    expect(calls.some(c => c.method === "DELETE" && c.url === "/api/designs/pal/bindings")).toBe(true);
  });

  it("designer bindings still PUT /api/templates/:id/bindings and have no reset", async () => {
    mountTemplates(root, {});
    await settle();
    root.querySelector('.tpl-card[data-tpl="odyssey"] [data-act="bindings"]').click();
    expect(root.querySelector('[data-act="bind-reset"]')).toBeNull();
    root.querySelector('[data-act="bind-save"]').click();
    await settle();
    expect(calls.find(c => c.method === "PUT").url).toBe("/api/templates/odyssey/bindings");
  });
});


describe("Shelf grouped by airline, with routes under their template", () => {
  const PR = (id, kind, extra = {}) => ({ id, kind, organizationName: "Philippine Airlines", semantics: { airlineCode: "PR" }, fieldKeys: [], bindings: {}, preview: PREVIEW, logo: null, ...extra });
  const route = (id, tplId, kind = "studio", over = {}) => ({ id, template: { kind, id: tplId }, values: { flightCode: "PR2987", departureAirportCode: "MNL", destinationAirportCode: "TAC" }, schedule: { departure: "16:35" }, fields: {}, ...over });

  it("groups by airline code; the name is the first non-generic organization name, else the code", () => {
    const g = airlineGroups(
      [{ id: "cebpac", kind: "designer", organizationName: "Airline", semantics: { airlineCode: "5J" } }, { id: "odyssey", kind: "designer", organizationName: "SM Tickets", semantics: {} }],
      [PR("pal", "studio"), PR("pal-intl", "studio", { organizationName: "Airline" })]
    );
    expect(g.map(x => [x.name, x.code, x.templates.map(t => t.t.id)])).toEqual([
      ["5J", "5J", ["cebpac"]],
      ["Philippine Airlines", "PR", ["pal", "pal-intl"]],
      ["SM Tickets", "", ["odyssey"]]
    ]);
  });

  it("renders a section per airline and each template's routes with counts", async () => {
    studioList = [PR("pal", "studio")];
    routesList = [route("PR2987-MNL-TAC", "pal"), route("PR2988-TAC-MNL", "pal", "studio", { values: { flightCode: "PR2988", departureAirportCode: "TAC", destinationAirportCode: "MNL" }, schedule: { departure: "18:30" } })];
    mountTemplates(root, {});
    await settle();
    const heads = [...root.querySelectorAll(".tpl-section > .eyebrow")].map(e => e.textContent);
    expect(heads.some(h => /Philippine Airlines/.test(h))).toBe(true);
    const rows = [...root.querySelectorAll('.tpl-card[data-tpl="pal"] [data-route]')];
    expect(rows.map(r => r.dataset.route)).toEqual(["PR2987-MNL-TAC", "PR2988-TAC-MNL"]);
    expect(rows[0].textContent).toMatch(/PR2987.*MNL → TAC.*16:35/s);
  });

  it("route actions: Issue/Edit/+ Route call back with the route; Delete and Move hit /api/routes", async () => {
    studioList = [PR("pal", "studio"), PR("pal-intl", "studio")];
    routesList = [route("PR2987-MNL-TAC", "pal")];
    const seen = [];
    let asked = "";
    globalThis.confirm = (m) => { asked = m; return true; };
    mountTemplates(root, { onIssue: (...a) => seen.push(["issue", ...a]), onRoute: (...a) => seen.push(["route", ...a]) });
    await settle();
    const row = root.querySelector('[data-route="PR2987-MNL-TAC"]');
    row.querySelector('[data-act="route-issue"]').click();
    row.querySelector('[data-act="route-edit"]').click();
    root.querySelector('.tpl-card[data-tpl="pal-intl"] [data-act="route-new"]').click();
    expect(seen).toEqual([["issue", "pal", "studio", "PR2987-MNL-TAC"], ["route", "pal", "studio", "PR2987-MNL-TAC"], ["route", "pal-intl", "studio"]]);
    const move = row.querySelector("select[data-route-move]");
    expect([...move.options].map(o => o.value)).toEqual(["", "studio:pal-intl"]);
    move.value = "studio:pal-intl"; move.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    const put = calls.find(c => c.method === "PUT" && c.url === "/api/routes/PR2987-MNL-TAC");
    expect(JSON.parse(put.body)).toMatchObject({ template: { kind: "studio", id: "pal-intl" }, values: { flightCode: "PR2987" } });
    expect(JSON.parse(put.body).id).toBeUndefined();
    root.querySelector('[data-route="PR2987-MNL-TAC"] [data-act="route-del"]').click();
    await settle();
    expect(asked).toMatch(/PR2987-MNL-TAC/);
    expect(calls.some(c => c.method === "DELETE" && c.url === "/api/routes/PR2987-MNL-TAC")).toBe(true);
  });
});

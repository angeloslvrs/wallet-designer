// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountTemplates, templateIdFromFile, fieldSamples, guessCount, needsReview } from "../apps/designer/src/templates.js";

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

let root, calls, designer, deleteResp;
beforeEach(() => {
  calls = [];
  deleteResp = { ok: false, status: 409, body: { error: 'template "odyssey" is referenced by 2 issued pass(es) — delete those passes first' } };
  designer = [
    { id: "odyssey", kind: "designer", organizationName: "Odyssey Air", fieldKeys: ["gate", "origin", "dest", "passenger"], assets: ["icon@2x.png"],
      bindings: { departureGate: { fieldKey: "gate", source: "value-match", confidence: "medium" }, currentBoardingDate: { fieldKey: "boardingTime", source: "date-proximity", confidence: "medium" }, passengerName: { fieldKey: "passenger", source: "manual", confidence: "high" } },
      preview: PREVIEW, logo: null }
  ];
  globalThis.confirm = () => true;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method ?? "GET", body: opts.body });
    const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
    if (u === "/api/templates") return json(designer);
    if (u === "/api/studio-templates") return json([{ id: "fully-loaded", kind: "studio", organizationName: "Rocket Partners Airlines", preview: { ...PREVIEW, logoText: "Rocket Partners" } }]);
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

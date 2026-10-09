// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";

// Design workspace: Save template writes designs/ (never fixtures/), a fixture
// opens as an unsaved copy, "Issue passes →" saves first and hands the design
// name to Issue, and the title says whether the editor matches what's saved.
let design, calls, issued, fixture;
const flush = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await flush(); };

beforeAll(async () => {
  fixture = JSON.parse(await readFile("fixtures/fully-loaded.json", "utf8"));
  document.body.innerHTML = `
    <main>
      <button data-design-act="back"></button>
      <b id="design-title"></b><small id="design-sub"></small>
      <div id="design-tabs"></div>
      <section id="form-pane"></section>
      <div id="preview-stage"></div>
      <aside id="design-side"></aside>
      <span id="build-status"></span>
      <button data-design-act="reset"></button>
      <input id="design-name" />
      <button data-design-act="issue"></button>
      <button data-design-act="save"></button>
    </main>`;
  globalThis.confirm = () => true;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method ?? "GET", body: opts.body });
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (u === "/api/fixtures/fully-loaded") return json(fixture);
    if (u === "/api/designs") return json(["taken"]);
    if (u.startsWith("/api/designs/") && opts.method === "PUT") return json({ ok: true }, 201);
    throw new Error(`unexpected fetch ${u}`);
  };
  design = await import("../apps/designer/src/design.js");
  design.initDesign({ onBack() {}, onIssue: (n) => issued.push(n), listDesigns: async () => ["taken"] });
});
beforeEach(() => { calls = []; issued = []; design.newDesign(); document.getElementById("design-name").value = ""; });

const click = (act) => document.querySelector(`[data-design-act="${act}"]`).click();

describe("Design workspace", () => {
  it("slugs a typed name into a design name", () => {
    expect(design.designNameFrom("Rocket Partners!")).toBe("rocket-partners");
    expect(design.designNameFrom("  ")).toBe("");
  });

  it("asks for a name instead of saving anonymously", async () => {
    click("save");
    await settle();
    expect(calls.some(c => c.method === "PUT")).toBe(false);
    expect(document.getElementById("build-status").textContent).toMatch(/Name the template/);
  });

  it("saves to /api/designs and reports saved / unsaved changes", async () => {
    document.getElementById("design-name").value = "Rocket Air";
    click("save");
    await settle();
    expect(calls.find(c => c.method === "PUT").url).toBe("/api/designs/rocket-air");
    expect(document.getElementById("design-sub").textContent).toMatch(/saved$/);
    expect(design.isDirty()).toBe(false);
  });

  it("opens a CI fixture as an unsaved copy (saving never targets fixtures/)", async () => {
    await design.openDesign("fully-loaded", { fixture: true });
    expect(document.getElementById("design-name").value).toBe("");
    expect(document.getElementById("design-sub").textContent).toMatch(/not saved yet/);
    document.getElementById("design-name").value = "rocket-copy";
    click("save");
    await settle();
    expect(calls.filter(c => c.method === "PUT").map(c => c.url)).toEqual(["/api/designs/rocket-copy"]);
  });

  it("Issue passes saves first, then hands the design name to Issue", async () => {
    document.getElementById("design-name").value = "to-issue";
    click("issue");
    await settle();
    expect(calls.some(c => c.method === "PUT" && c.url === "/api/designs/to-issue")).toBe(true);
    expect(issued).toEqual(["to-issue"]);
  });

  it("edits made while a save is in flight stay unsaved", async () => {
    const { setPath } = await import("../apps/designer/src/state.js");
    const real = globalThis.fetch;
    let release;
    globalThis.fetch = (url, opts = {}) => (opts.method === "PUT" ? new Promise(r => { release = () => r(real(url, opts)); }) : real(url, opts));
    document.getElementById("design-name").value = "slow";
    click("save");
    await settle();
    setPath("meta.description", "edited mid-save");
    release(); await settle();
    globalThis.fetch = real;
    expect(design.isDirty()).toBe(true);
    expect(document.getElementById("design-sub").textContent).toMatch(/unsaved changes/);
  });

  it("Issue saves under a newly typed name instead of reusing the loaded one", async () => {
    document.getElementById("design-name").value = "first";
    click("save"); await settle();
    calls = [];
    document.getElementById("design-name").value = "second";
    click("issue"); await settle();
    expect(calls.some(c => c.method === "PUT" && c.url === "/api/designs/second")).toBe(true);
    expect(issued).toEqual(["second"]);
  });

  it("hashes state compactly for the persisted identity", () => {
    expect(design.stateHash({ a: 1 })).toMatch(/^[0-9a-f]{1,8}$/);
    expect(design.stateHash({ a: 1 })).not.toBe(design.stateHash({ a: 2 }));
  });

  it("lists Apple's missing boarding tags on the right", () => {
    const side = document.getElementById("design-side").textContent;
    expect(side).toMatch(/Apple’s boarding tags/);
    expect(side).toMatch(/of 12 present/);
  });
});

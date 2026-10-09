// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { mountIssue } from "../apps/designer/src/issue/index.js";
import { loadTemplate, templateFieldDescriptors, templateFieldKeys, discoverBindings, formStateToPassJson } from "../packages/pass-builder/index.js";

// Issue workspace (DOM): Flight → Passengers → Issued over both template kinds.
// Errors wait for blur/submit; the footer always says what's ready; the Issue
// label is honest about updates; in-batch duplicate serials block; issuing a
// studio design posts a FormState with designName; Open flight hands over the
// server's groupId.

const flush = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };
const bcbp = (name, seat, seq) => ["M", "1", name.padEnd(20), "E", "ABC123".padEnd(7), "SFO", "JFK", "RP ", "0248 ", "306", "Y", seat, seq.padEnd(5), "1", "00"].join("");

let root, posts, designer, studio, design, existing;
const ok = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

beforeEach(async () => {
  const { passJson } = await loadTemplate("templates/dev-sample.pkpasstemplate");
  const b = discoverBindings(passJson);
  designer = { id: "dev-sample", kind: "designer", fieldKeys: templateFieldKeys(passJson), fields: templateFieldDescriptors(passJson, b), bindings: b, semantics: passJson.semantics, preview: passJson };
  design = JSON.parse(await readFile("fixtures/fully-loaded.json", "utf8"));
  const sp = formStateToPassJson(design), sb = discoverBindings(sp);
  studio = { id: "rocket", kind: "studio", fieldKeys: templateFieldKeys(sp), fields: templateFieldDescriptors(sp, sb), bindings: sb, semantics: design.semantics, preview: sp };
  posts = [];
  existing = [{ serial: "RP248@2026-11-02-001" }];
  globalThis.confirm = () => true;
  globalThis.fetch = (url, opts = {}) => {
    const u = String(url);
    if (u === "/api/templates") return ok([designer]);
    if (u === "/api/studio-templates") return ok([studio]);
    if (u === "/api/designs/rocket") return ok(design);
    if (u === "/api/passes" && opts.method === "POST") {
      const body = JSON.parse(opts.body);
      posts.push(body);
      const serial = body.serialNumber ?? body.meta.serialNumber;
      return ok({ serialNumber: serial, groupId: body.groupId ?? body.meta.groupId, created: !existing.some(p => p.serial === serial) }, 201);
    }
    if (u === "/api/passes") return ok(existing);
    if (u === "/api/roster") return ok([]);
    throw new Error(`unexpected fetch: ${opts.method ?? "GET"} ${u}`);
  };
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { root._mountAbort?.abort(); root.remove(); delete globalThis.fetch; delete globalThis.confirm; });

const type = (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
function fillFlight() {
  type(root.querySelector('[data-slot-input="sem:flightNumber"] input'), "248");
  for (const [sid, t] of [["sem:currentBoardingDate", "07:30"], ["sem:currentDepartureDate", "08:00"], ["sem:currentArrivalDate", "16:30"]]) {
    type(root.querySelector(`[data-slot-input="${sid}"] input[type=date]`), "2026-11-02");
    type(root.querySelector(`[data-slot-input="${sid}"] input[type=time]`), t);
  }
}
const click = (sel) => root.querySelector(sel).click();

describe("Flight step", () => {
  it("shows no errors before anything is touched; the footer names what's missing", async () => {
    mountIssue(root, { template: "dev-sample" });
    await settle();
    expect(root.querySelector("h1").textContent).toBe("Flight");
    expect([...root.querySelectorAll(".iw-err")].some(e => e.textContent)).toBe(false);
    expect(root.querySelector("[data-ready]").textContent).toMatch(/Still needed: Boarding, Departure, Arrival/);
    // template defaults are offered, not demanded
    expect(root.querySelector('[data-slot-input="sem:airlineCode"] input').placeholder).toBe("RP");
  });

  it("reveals a field's error on blur and composes the trip id from the flight", async () => {
    mountIssue(root, { template: "dev-sample" });
    await settle();
    const dep = root.querySelector('[data-slot-input="sem:departureAirportCode"] input');
    type(dep, "mn");
    dep.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(root.querySelector('[data-field="sem:departureAirportCode"] .iw-err').textContent).not.toBe("");
    fillFlight();
    expect(root.querySelector("#iw-trip").value).toBe("RP248@2026-11-02");
  });
});

describe("Passengers step", () => {
  it("adds one passenger per pasted line, reports bad lines, and suggests serials past issued ones", async () => {
    mountIssue(root, { template: "dev-sample" });
    await settle();
    fillFlight();
    click('[data-act="to-passengers"]');
    root.querySelector("#iw-paste").value = `${bcbp("SOLIVERES/ANGELO", "014A", "0042")}\nnope\n${bcbp("SOLIVERES/MARIA", "014B", "0043")}`;
    click('[data-act="paste-add"]');
    expect(root.querySelectorAll(".iw-p").length).toBe(2);
    expect(root.querySelector(".iw-paste-errs").textContent).toMatch(/Line 2/);
    expect(root.querySelector("#iw-serial").value).toBe("RP248@2026-11-02-002");   // -001 is already issued
    expect(root.querySelector("[data-primary]").textContent).toBe("Issue 2 passes");
  });

  it("a flight-only blocker reads 'needs flight' and the footer offers the fix", async () => {
    mountIssue(root, { template: "dev-sample" });
    await settle();
    click('[data-act="to-passengers"]');
    root.querySelector("#iw-paste").value = bcbp("SOLIVERES/ANGELO", "014A", "0042");
    click('[data-act="paste-add"]');
    expect(root.querySelector(".iw-st").textContent).toBe("needs flight");
    expect(root.querySelector("[data-ready-fix]").textContent).toMatch(/Fix flight: Boarding, Departure, Arrival/);
    click('[data-act="fix-flight"]');
    expect(root.querySelector("h1").textContent).toBe("Flight");
    expect(root.querySelector('[data-field="sem:currentBoardingDate"] .iw-err').textContent).toBe("Required");
  });

  it("says when a serial will update an existing pass, and blocks in-batch duplicates", async () => {
    mountIssue(root, { template: "dev-sample" });
    await settle();
    fillFlight();
    click('[data-act="to-passengers"]');
    root.querySelector("#iw-paste").value = `${bcbp("SOLIVERES/ANGELO", "014A", "0042")}\n${bcbp("SOLIVERES/MARIA", "014B", "0043")}`;
    click('[data-act="paste-add"]');
    type(root.querySelector("#iw-serial"), "RP248@2026-11-02-001");
    expect(root.querySelector("[data-serial-note]").textContent).toMatch(/updates that pass/);
    expect(root.querySelector("[data-primary]").textContent).toBe("Issue 1 · update 1");
    // make passenger 2 collide with passenger 1
    click('[data-act="pax"][data-i="1"]');
    type(root.querySelector("#iw-serial"), "RP248@2026-11-02-001");
    click('[data-act="issue"]');
    await settle();
    expect(posts).toEqual([]);
    expect(root.querySelector("[data-serial-note]").textContent).toMatch(/each pass needs its own/);
  });

  it("holds a duplicate-serial error until blur, and snapshots bodies so edits mid-batch can't change what's issued", async () => {
    mountIssue(root, { template: "dev-sample" });
    await settle();
    fillFlight();
    click('[data-act="to-passengers"]');
    root.querySelector("#iw-paste").value = `${bcbp("SOLIVERES/ANGELO", "014A", "0042")}\n${bcbp("SOLIVERES/MARIA", "014B", "0043")}`;
    click('[data-act="paste-add"]');
    click('[data-act="pax"][data-i="1"]');
    const serial = root.querySelector("#iw-serial");
    type(serial, "RP248@2026-11-02-002");
    // fresh duplicate (passenger 1 has -002): no error until blur
    expect(root.querySelector("[data-serial-note]").textContent).toBe("");
    serial.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(root.querySelector("[data-serial-note]").textContent).toMatch(/each pass needs its own/);
    type(root.querySelector("#iw-serial"), "MINE-2");
    // a slow server: edits during the batch are ignored
    const realFetch = globalThis.fetch;
    let release;
    globalThis.fetch = (url, opts = {}) => (opts.method === "POST" ? new Promise(r => { release = () => r(realFetch(url, opts)); }) : realFetch(url, opts));
    click('[data-act="issue"]');
    await settle();
    expect(root.querySelector(".iw").hasAttribute("inert")).toBe(true);
    type(root.querySelector("#iw-serial"), "RP248@2026-11-02-002");   // mid-batch edit: must not leak in
    release(); await settle(); release(); await settle();
    expect(posts.map(p => p.serialNumber)).toEqual(["RP248@2026-11-02-002", "MINE-2"]);
  });

  it("issues template bodies and lands on Issued with QR, badge, Copy all links first and Open flight", async () => {
    const opened = [];
    mountIssue(root, { template: "dev-sample", openFlight: (g) => opened.push(g) });
    await settle();
    fillFlight();
    click('[data-act="to-passengers"]');
    root.querySelector("#iw-paste").value = `${bcbp("SOLIVERES/ANGELO", "014A", "0042")}\n${bcbp("SOLIVERES/MARIA", "014B", "0043")}`;
    click('[data-act="paste-add"]');
    click('[data-act="issue"]');
    await settle();
    expect(posts.map(p => p.template)).toEqual(["dev-sample", "dev-sample"]);
    expect(posts[0].data.semantics.passengerName).toEqual({ givenName: "ANGELO", familyName: "SOLIVERES" });
    expect(posts[0].data.seat).toBe("14A");
    expect(posts[0].data.barcodeMessage).toMatch(/^M1SOLIVERES/);
    expect(root.querySelector("h1").textContent).toBe("2 passes issued");
    expect(root.querySelectorAll("canvas.iw-qr").length).toBe(2);
    expect(root.querySelectorAll('.iw-card-badge img[alt="Add to Apple Wallet"]').length).toBe(2);
    expect(root.querySelector(".iw-done-acts .btn").dataset.act).toBe("copy-all");
    expect(root.querySelectorAll(".btn-primary").length).toBe(1);
    click('[data-act="open-flight"]');
    expect(opened).toEqual(["RP248@2026-11-02"]);
  });
});

describe("Studio design", () => {
  it("issues a FormState body carrying designName and the trip id", async () => {
    mountIssue(root, { template: "rocket", kind: "studio" });
    await settle();
    fillFlight();
    type(root.querySelector('[data-slot-input="sem:departureAirportTimeZone"] input'), "America/Los_Angeles");
    click('[data-act="to-passengers"]');
    root.querySelector("#iw-paste").value = bcbp("TAN/LEA", "022C", "0007");
    click('[data-act="paste-add"]');
    click('[data-act="issue"]');
    await settle();
    expect(posts).toHaveLength(1);
    expect(posts[0].designName).toBe("rocket");
    expect(posts[0].meta.groupId).toBe("RP248@2026-11-02");
    expect(posts[0].semantics.passengerName).toEqual({ givenName: "LEA", familyName: "TAN" });
    expect(posts[0].semantics.currentBoardingDate).toBe("2026-11-02T07:30:00-08:00");   // the airport's zone, not the browser's
    expect(JSON.stringify(posts[0])).not.toMatch(/ANGELO/);
  });
});

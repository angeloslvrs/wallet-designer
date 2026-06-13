// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountIssue } from "../apps/designer/src/issue.js";

// depart (iata, required, shared) + gate (text, shared) + sequence (number,
// bound to boardingSequenceNumber so it defaults per-passenger). The server
// sends these descriptors; the issue UI must render the right inputs, validate
// on blur/submit, and gate the Issue button.
const TEMPLATE = {
  id: "t1",
  fieldKeys: ["depart", "gate", "sequence"],
  fields: [
    { key: "depart", kind: "iata", required: true, maxLength: 3, pattern: "[A-Z]{3}", boundSemantic: "departureAirportCode" },
    { key: "gate", kind: "text", required: false, boundSemantic: null },
    { key: "sequence", kind: "number", required: false, pattern: "[0-9]+([.][0-9]+)?", boundSemantic: "boardingSequenceNumber" }
  ],
  bindings: { boardingSequenceNumber: { fieldKey: "sequence" } },
  semantics: {},
  assets: []
};

const flush = () => new Promise(r => setTimeout(r, 0));
const ev = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

let root, posted, existing, createdFlag;
beforeEach(() => {
  posted = [];
  existing = [];          // GET /api/passes — serials already issued
  createdFlag = true;     // POST /api/passes response: newly created vs overwrote
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.endsWith("/api/templates")) return { json: async () => [TEMPLATE] };
    if (u === "/api/passes" && opts?.method === "POST") {
      const body = JSON.parse(opts.body); posted.push(body);
      return { ok: true, json: async () => ({ serialNumber: body.serialNumber, created: createdFlag }) };
    }
    if (u === "/api/passes") return { ok: true, json: async () => existing };   // GET list
    throw new Error(`unexpected fetch: ${url}`);
  };
  globalThis.confirm = () => true;   // default: accept overwrite confirmations
  globalThis.location = { origin: "http://localhost" };
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { root.remove(); delete globalThis.fetch; delete globalThis.confirm; });

describe("Issue tab — typed inputs, inline errors, submit gate", () => {
  it("renders an IATA input capped at 3 chars and a numeric sequence input", async () => {
    mountIssue(root, () => {});
    await flush();
    const depart = root.querySelector('input[data-shared-key="depart"]');
    expect(depart).toBeTruthy();
    expect(depart.maxLength).toBe(3);
    const seq = root.querySelector('.iss-row[data-i="0"] input[data-key="sequence"]');
    expect(seq.getAttribute("inputmode")).toBe("numeric");
  });

  it("shows an inline error and disables Issue for a bad airport code", async () => {
    mountIssue(root, () => {});
    await flush();
    const depart = root.querySelector('input[data-shared-key="depart"]');
    depart.value = "Manilla";
    ev(depart, "input");
    ev(depart, "focusout");
    await flush();
    expect(root.querySelector('[data-err-shared="depart"]').textContent).toMatch(/3 letters/i);
    expect(root.querySelector('button[data-act="issue"]').disabled).toBe(true);
  });

  it("auto-uppercases an airport code and clears the error once valid", async () => {
    mountIssue(root, () => {});
    await flush();
    const depart = root.querySelector('input[data-shared-key="depart"]');
    depart.value = "mnl";
    ev(depart, "input");
    expect(depart.value).toBe("MNL");
    ev(depart, "focusout");
    await flush();
    expect(root.querySelector('[data-err-shared="depart"]').textContent).toBe("");
    expect(root.querySelector('button[data-act="issue"]').disabled).toBe(false);
  });

  it("flags a non-numeric sequence in a passenger row and disables Issue", async () => {
    mountIssue(root, () => {});
    await flush();
    const depart = root.querySelector('input[data-shared-key="depart"]');
    depart.value = "MNL"; ev(depart, "input");
    const seq = root.querySelector('.iss-row[data-i="0"] input[data-key="sequence"]');
    seq.value = "x"; ev(seq, "input"); ev(seq, "focusout");
    await flush();
    expect(root.querySelector('.iss-row[data-i="0"] [data-err-key="sequence"]').textContent).toMatch(/number/i);
    expect(root.querySelector('button[data-act="issue"]').disabled).toBe(true);
  });

  it("does not POST while any field is invalid", async () => {
    mountIssue(root, () => {});
    await flush();
    root.querySelector("#iss-group").value = "RP1@2026-08-01"; ev(root.querySelector("#iss-group"), "input");
    const depart = root.querySelector('input[data-shared-key="depart"]');
    depart.value = "Manilla"; ev(depart, "input"); ev(depart, "focusout");
    await flush();
    root.querySelector('button[data-act="issue"]').click();
    await flush();
    expect(posted).toEqual([]);
  });

  it("issues when everything is valid", async () => {
    mountIssue(root, () => {});
    await flush();
    root.querySelector("#iss-group").value = "RP1@2026-08-01"; ev(root.querySelector("#iss-group"), "input");
    const depart = root.querySelector('input[data-shared-key="depart"]');
    depart.value = "MNL"; ev(depart, "input"); ev(depart, "focusout");
    const seq = root.querySelector('.iss-row[data-i="0"] input[data-key="sequence"]');
    seq.value = "12"; ev(seq, "input");
    await flush();
    expect(root.querySelector('button[data-act="issue"]').disabled).toBe(false);
    root.querySelector('button[data-act="issue"]').click();
    await flush();
    expect(posted.length).toBe(1);
    expect(posted[0].data.depart).toBe("MNL");
  });
});

describe("Issue tab — unique serials (Apple: serialNumber must be unique per pass)", () => {
  const setGroup = (g) => { const el = root.querySelector("#iss-group"); el.value = g; ev(el, "input"); };
  const setDepart = () => { const d = root.querySelector('input[data-shared-key="depart"]'); d.value = "MNL"; ev(d, "input"); };
  const addPassenger = () => root.querySelector('button[data-act="add"]').click();
  const collideRow1WithRow0 = () => {
    const s0 = root.querySelector('.iss-row[data-i="0"] input[data-serial]').value;
    const s1 = root.querySelector('.iss-row[data-i="1"] input[data-serial]');
    s1.value = s0; ev(s1, "input");
  };

  it("flags two passenger rows that share a serial and disables Issue", async () => {
    mountIssue(root, () => {}); await flush();
    setGroup("RP1@2026-08-01"); setDepart();
    addPassenger(); await flush();
    collideRow1WithRow0(); await flush();
    expect(root.querySelector('.iss-row[data-i="1"] [data-err-serial]').textContent).toMatch(/unique|duplicate/i);
    expect(root.querySelector('button[data-act="issue"]').disabled).toBe(true);
  });

  it("does not POST while two rows share a serial", async () => {
    mountIssue(root, () => {}); await flush();
    setGroup("RP1@2026-08-01"); setDepart();
    addPassenger(); await flush();
    collideRow1WithRow0(); await flush();
    root.querySelector('button[data-act="issue"]').click(); await flush();
    expect(posted).toEqual([]);
  });

  it("asks before overwriting an existing serial and skips the POST when cancelled", async () => {
    existing = [{ serial: "RP1@2026-08-01-001" }];
    globalThis.confirm = () => false;
    mountIssue(root, () => {}); await flush();
    setGroup("RP1@2026-08-01"); setDepart(); await flush();
    root.querySelector('button[data-act="issue"]').click(); await flush();
    expect(posted).toEqual([]);
  });

  it("overwrites an existing serial when confirmed and labels it as updated", async () => {
    existing = [{ serial: "RP1@2026-08-01-001" }];
    createdFlag = false;   // server reports it overwrote an existing pass
    globalThis.confirm = () => true;
    mountIssue(root, () => {}); await flush();
    setGroup("RP1@2026-08-01"); setDepart(); await flush();
    root.querySelector('button[data-act="issue"]').click(); await flush();
    expect(posted.length).toBe(1);
    expect(root.querySelector('[data-row-status="0"]').textContent).toMatch(/updated/i);
  });
});

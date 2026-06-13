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

let root, posted;
beforeEach(() => {
  posted = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).endsWith("/api/templates")) return { json: async () => [TEMPLATE] };
    if (String(url) === "/api/passes") { posted.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ serialNumber: JSON.parse(opts.body).serialNumber }) }; }
    throw new Error(`unexpected fetch: ${url}`);
  };
  globalThis.location = { origin: "http://localhost" };
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { root.remove(); delete globalThis.fetch; });

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

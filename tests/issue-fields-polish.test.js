// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountIssue } from "../apps/designer/src/issue.js";

// gate (text, unbound, shared) + tz (bound to departureAirportTimeZone, required)
// + depart (iata, required). The server sends these descriptors in `fields`.
const TEMPLATE = {
  id: "t1",
  fieldKeys: ["gate", "tz", "depart"],
  fields: [
    { key: "gate", label: "Gate", kind: "text", required: false, boundSemantic: null },
    { key: "tz", label: "TZ", kind: "text", required: true, boundSemantic: "departureAirportTimeZone" },
    { key: "depart", label: "From", kind: "iata", required: true, maxLength: 3, pattern: "[A-Z]{3}", boundSemantic: "departureAirportCode" }
  ],
  bindings: {
    departureAirportTimeZone: { fieldKey: "tz" },
    departureAirportCode: { fieldKey: "depart" }
  },
  semantics: {},
  assets: []
};

const flush = () => new Promise(r => setTimeout(r, 0));

let root;
beforeEach(() => {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/api/templates")) return { json: async () => [TEMPLATE] };
    if (u === "/api/passes") return { ok: true, json: async () => [] };
    throw new Error(`unexpected fetch: ${url}`);
  };
  globalThis.location = { origin: "http://localhost" };
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { root.remove(); delete globalThis.fetch; });

describe("Issue tab — display-field polish", () => {
  it("renders an IANA timezone picker for a *TimeZone-bound field", async () => {
    mountIssue(root, () => {});
    await flush();
    const tz = root.querySelector('[data-typed-shared="tz"][data-tw="timezone"] input[list]');
    expect(tz).toBeTruthy();
    expect(root.querySelector('input[data-shared-key="tz"]')).toBeNull();
  });

  it("shows a format hint for a bound field", async () => {
    mountIssue(root, () => {});
    await flush();
    const hints = [...root.querySelectorAll(".iss-shared-row .iss-hint")].map(e => e.textContent);
    expect(hints.some(h => /IANA/.test(h))).toBe(true);
    expect(hints.some(h => /IATA/.test(h))).toBe(true);
  });

  it("orders required fields before optional ones in the shared list", async () => {
    mountIssue(root, () => {});
    await flush();
    const labels = [...root.querySelectorAll(".iss-shared-row label")].map(l => l.textContent);
    const firstOptional = labels.findIndex(l => !l.includes("*"));
    const lastRequired = labels.map(l => l.includes("*")).lastIndexOf(true);
    expect(lastRequired).toBeLessThan(firstOptional);   // all required precede the first optional
  });

  it("collapses each passenger's semantic tags into an Advanced disclosure", async () => {
    mountIssue(root, () => {});
    await flush();
    const details = root.querySelector('.iss-row[data-i="0"] details.iss-adv');
    expect(details).toBeTruthy();
    expect(details.querySelector('[data-sem-row="0"] .sem-editor')).toBeTruthy();
  });
});

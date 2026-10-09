// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountIssue } from "../apps/designer/src/issue/index.js";
import { mountFlights } from "../apps/designer/src/flights.js";

// Stale-mount race: each view mounts into the SAME reused pane element and aborts
// the previous mount's AbortController on re-mount. A data-load fetch started by
// the first mount can still resolve AFTER the user has switched away and back
// (re-mount) — its late resolve must NOT re-render/blank the new mount's DOM and
// wipe whatever the user has since typed. The fix threads the mount's { signal }
// through every fetch and guards every post-await DOM write with signal.aborted.

const flush = () => new Promise((r) => setTimeout(r, 0));

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const TEMPLATE = {
  id: "t1", kind: "designer",
  fieldKeys: ["gate"],
  fields: [{ key: "gate", label: "Gate", kind: "text", boundSemantic: "departureGate" }],
  bindings: { departureGate: { fieldKey: "gate", source: "manual", confidence: "high" } },
  semantics: {},
  preview: { boardingPass: { headerFields: [{ key: "gate", label: "GATE", value: "C4" }] } }
};

const LIST = [{
  serial: "5J-1", groupId: "5J@2026-06-14",
  passenger: "SOLIVERES/ANGELO", seat: "14A",
  lastModified: "Sat, 14 Jun 2026 00:00:00 GMT", deviceCount: 0, template: "cebpac"
}];

let root;
beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { root.remove(); delete globalThis.fetch; });

describe("Issue — stale mount's load() must not blank the new mount", () => {
  const ok = (body) => Promise.resolve({ ok: true, json: async () => body });
  function stubFetch(first) {
    let templatesCalls = 0;
    globalThis.fetch = (url) => {
      const u = String(url);
      if (u.endsWith("/api/templates")) {
        templatesCalls++;
        // The first mount's fetch hangs until we release it after the re-mount.
        return templatesCalls === 1 ? first.promise : ok([TEMPLATE]);
      }
      if (u === "/api/passes") return ok([]);
      if (u.endsWith("/api/roster")) return ok([]);
      throw new Error(`unexpected fetch: ${u}`);
    };
  }

  it("a late-resolving templates fetch from the aborted mount does not re-render over typed input", async () => {
    const first = deferred();
    stubFetch(first);
    mountIssue(root, { template: "t1" });
    await flush();
    expect(root.textContent).toMatch(/Loading/);

    // Re-mount (user left Issue and came back) — aborts the first mount's signal.
    mountIssue(root, { template: "t1" });
    await flush(); await flush();

    const trip = root.querySelector("#iw-trip");
    expect(trip).toBeTruthy();
    trip.value = "MYTRIP";
    const gate = root.querySelector('[data-slot-input="sem:departureGate"] input');
    gate.value = "B12";

    first.resolve({ ok: true, json: async () => [TEMPLATE] });
    await flush(); await flush();

    // Same input nodes (no re-render) and the typed values survive.
    expect(root.querySelector("#iw-trip")).toBe(trip);
    expect(trip.value).toBe("MYTRIP");
    expect(root.querySelector('[data-slot-input="sem:departureGate"] input').value).toBe("B12");
  });

  it("an AbortError-rejecting stale fetch is swallowed (no error screen, input intact)", async () => {
    const first = deferred();
    stubFetch(first);
    mountIssue(root, { template: "t1" });
    await flush();
    mountIssue(root, { template: "t1" });
    await flush(); await flush();

    const trip = root.querySelector("#iw-trip");
    trip.value = "KEEP";
    first.reject(new DOMException("Aborted", "AbortError"));
    await flush(); await flush();

    expect(root.querySelector("#iw-trip")).toBe(trip);
    expect(trip.value).toBe("KEEP");
    expect(root.textContent).not.toMatch(/Couldn’t load/);
  });
});

describe("Flights — stale mount's load() must not blank the new mount", () => {
  it("a late-resolving passes fetch from the aborted mount does not re-render over typed input", async () => {
    const firstPasses = deferred();
    let passesCalls = 0;
    globalThis.fetch = (url) => {
      const u = String(url);
      if (u === "/api/passes") {
        passesCalls++;
        return passesCalls === 1 ? firstPasses.promise : Promise.resolve({ json: async () => LIST });
      }
      throw new Error(`unexpected fetch: ${u}`);
    };

    // First mount — stuck on the deferred passes fetch.
    mountFlights(root, {});
    await flush();
    expect(root.textContent).toMatch(/Loading…/);

    // Re-mount — aborts the first mount's signal.
    mountFlights(root, {});
    await flush();

    // The user types into the freshly-rendered status editor.
    const gate = root.querySelector('input[data-f="departureGate"]');
    expect(gate).toBeTruthy();
    gate.value = "56";

    // The stale first fetch finally resolves.
    firstPasses.resolve({ json: async () => LIST });
    await flush();
    await flush();

    // Same node (no re-render) and the typed value survives; the card is intact.
    expect(root.querySelector('input[data-f="departureGate"]')).toBe(gate);
    expect(gate.value).toBe("56");
    expect(root.querySelector('.fl-panel[data-panel="5J@2026-06-14"]')).toBeTruthy();
  });
});

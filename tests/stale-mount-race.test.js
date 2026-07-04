// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountIssue } from "../apps/designer/src/issue.js";
import { mountManage } from "../apps/designer/src/manage.js";

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
  id: "t1",
  fieldKeys: ["gate"],
  fields: [{ key: "gate", label: "Gate", kind: "text" }],
  bindings: {},
  semantics: {},
  assets: []
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
  it("a late-resolving templates fetch from the aborted mount does not re-render over typed input", async () => {
    const firstTemplates = deferred();
    let templatesCalls = 0;
    globalThis.fetch = (url) => {
      const u = String(url);
      if (u.endsWith("/api/templates")) {
        templatesCalls++;
        // The first mount's fetch hangs until we release it after the re-mount.
        return templatesCalls === 1 ? firstTemplates.promise : Promise.resolve({ json: async () => [TEMPLATE] });
      }
      if (u === "/api/passes") return Promise.resolve({ json: async () => [] });
      if (u.endsWith("/api/roster")) return Promise.resolve({ json: async () => [] });
      throw new Error(`unexpected fetch: ${u}`);
    };

    // First mount — stuck on the deferred templates fetch.
    mountIssue(root, () => {});
    await flush();
    expect(root.textContent).toMatch(/Loading templates/);

    // Re-mount (user left Issue and came back) — aborts the first mount's signal.
    mountIssue(root, () => {});
    await flush();

    // The user types into the freshly-rendered new mount.
    const serial = root.querySelector('.iss-row[data-i="0"] input[data-serial]');
    expect(serial).toBeTruthy();
    serial.value = "MYTRIP-001";
    const gate = root.querySelector('input[data-shared-key="gate"]');
    expect(gate).toBeTruthy();
    gate.value = "B12";

    // The stale first fetch finally resolves.
    firstTemplates.resolve({ json: async () => [TEMPLATE] });
    await flush();
    await flush();

    // Same input nodes (no re-render) and the typed values survive.
    expect(root.querySelector('.iss-row[data-i="0"] input[data-serial]')).toBe(serial);
    expect(serial.value).toBe("MYTRIP-001");
    expect(root.querySelector('input[data-shared-key="gate"]').value).toBe("B12");
  });

  it("an AbortError-rejecting stale fetch is swallowed (no 'API offline', input intact)", async () => {
    const firstTemplates = deferred();
    let templatesCalls = 0;
    globalThis.fetch = (url) => {
      const u = String(url);
      if (u.endsWith("/api/templates")) {
        templatesCalls++;
        return templatesCalls === 1 ? firstTemplates.promise : Promise.resolve({ json: async () => [TEMPLATE] });
      }
      if (u === "/api/passes") return Promise.resolve({ json: async () => [] });
      if (u.endsWith("/api/roster")) return Promise.resolve({ json: async () => [] });
      throw new Error(`unexpected fetch: ${u}`);
    };

    mountIssue(root, () => {});
    await flush();
    mountIssue(root, () => {});
    await flush();

    const serial = root.querySelector('.iss-row[data-i="0"] input[data-serial]');
    serial.value = "KEEP-001";

    // A real aborted fetch rejects with an AbortError — must be swallowed silently.
    firstTemplates.reject(new DOMException("Aborted", "AbortError"));
    await flush();
    await flush();

    expect(root.querySelector('.iss-row[data-i="0"] input[data-serial]')).toBe(serial);
    expect(serial.value).toBe("KEEP-001");
    expect(root.textContent).not.toMatch(/API offline/);
  });
});

describe("Manage — stale mount's load() must not blank the new mount", () => {
  it("a late-resolving passes fetch from the aborted mount does not re-render over typed input", async () => {
    const firstPasses = deferred();
    let passesCalls = 0;
    globalThis.fetch = (url) => {
      const u = String(url);
      if (u === "/api/passes") {
        passesCalls++;
        return passesCalls === 1 ? firstPasses.promise : Promise.resolve({ json: async () => LIST });
      }
      if (u.startsWith("/api/log")) return Promise.resolve({ json: async () => [] });
      throw new Error(`unexpected fetch: ${u}`);
    };

    // First mount — stuck on the deferred passes fetch.
    mountManage(root, () => {});
    await flush();
    expect(root.textContent).toMatch(/Loading…/);

    // Re-mount — aborts the first mount's signal.
    mountManage(root, () => {});
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
    expect(root.querySelector('.mg-card[data-card="5J@2026-06-14"]')).toBeTruthy();
  });
});

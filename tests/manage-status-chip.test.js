// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountManage } from "../apps/designer/src/manage.js";

// The Manage view shows a single status vocabulary as colored chips
// (On Time / Boarding / Delayed / Cancelled / Diverted), derived from each
// pass's transitStatus (surfaced by GET /api/passes as `status`), and updates
// them optimistically after a push.
const flush = () => new Promise(r => setTimeout(r, 0));
const ev = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

let root, pushed;
beforeEach(() => {
  pushed = [];
  const listResp = [
    { serial: "RP247@2026-06-20-001", groupId: "RP247@2026-06-20", passenger: "A. SOLIVERES", seat: "14A", status: "Delayed", lastModified: "Sat, 20 Jun 2026 00:00:00 GMT", deviceCount: 1, template: "cebpac" },
    { serial: "RP247@2026-06-20-002", groupId: "RP247@2026-06-20", passenger: "M. CHEN", seat: "14B", status: "On Time", lastModified: "Sat, 20 Jun 2026 00:00:00 GMT", deviceCount: 0, template: "cebpac" }
  ];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u === "/api/passes") return { json: async () => listResp };
    if (u.startsWith("/api/log")) return { json: async () => [] };
    if (u.includes("/api/groups/") && u.endsWith("/status")) {
      pushed.push(JSON.parse(opts.body));
      return { json: async () => ({ ok: true, count: 2, sent: 1, results: [] }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { root.remove(); delete globalThis.fetch; });

describe("Manage — status chips + single vocabulary", () => {
  it("renders a trip chip (most severe) and a per-pass chip from each pass status", async () => {
    mountManage(root, () => {});
    await flush();
    const trip = root.querySelector('[data-chip-trip="RP247@2026-06-20"]');
    expect(trip).toBeTruthy();
    expect(trip.textContent.trim()).toBe("Delayed");   // most severe of {Delayed, On Time}
    expect(trip.className).toContain("mg-chip--delayed");
    expect(root.querySelector('[data-chip-pass="RP247@2026-06-20-001"]').textContent.trim()).toBe("Delayed");
    expect(root.querySelector('[data-chip-pass="RP247@2026-06-20-002"]').textContent.trim()).toBe("On Time");
  });

  it("offers Boarding in the status select (single vocabulary)", async () => {
    mountManage(root, () => {});
    await flush();
    const opts = [...root.querySelectorAll('.mg-editor[data-scope="grp"] select[data-f="transitStatus"] option')].map(o => o.value);
    expect(opts).toEqual(["", "On Time", "Boarding", "Delayed", "Cancelled", "Diverted"]);
  });

  it("updates the chips optimistically after a trip status push", async () => {
    mountManage(root, () => {});
    await flush();
    const card = root.querySelector('.mg-card[data-card="RP247@2026-06-20"]');
    const sel = card.querySelector('.mg-editor[data-scope="grp"] select[data-f="transitStatus"]');
    sel.value = "Boarding"; ev(sel, "input");
    card.querySelector('button[data-act="grp-update"]').click();
    await flush();
    expect(pushed).toEqual([{ transitStatus: "Boarding" }]);
    expect(card.querySelector('[data-chip-trip="RP247@2026-06-20"]').textContent.trim()).toBe("Boarding");
    expect(card.querySelector('[data-chip-pass="RP247@2026-06-20-001"]').textContent.trim()).toBe("Boarding");
    expect(card.querySelector('[data-chip-pass="RP247@2026-06-20-002"]').textContent.trim()).toBe("Boarding");
  });
});

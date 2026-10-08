// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountFlights } from "../apps/designer/src/flights.js";

// One status vocabulary (On Time / Boarding / Delayed / Cancelled / Diverted)
// rendered as .st-pill--<slug> pills: the board row shows the flight's most
// severe pass status, each passenger shows its own, and both update
// optimistically after a push. Status is chosen with a row of keys that write
// into the hidden transitStatus input (same data-f contract as every field).
const flush = () => new Promise(r => setTimeout(r, 0));

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
    if (u.includes("/api/groups/") && u.endsWith("/status")) {
      pushed.push(JSON.parse(opts.body));
      return { json: async () => ({ ok: true, count: 2, sent: 1, results: [] }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { root.remove(); delete globalThis.fetch; root._mountAbort?.abort(); });

describe("Flights — status pills + single vocabulary", () => {
  it("renders a flight pill (most severe) and a per-pass pill from each pass status", async () => {
    mountFlights(root, {});
    await flush();
    const trip = root.querySelector('[data-chip-trip="RP247@2026-06-20"]');
    expect(trip).toBeTruthy();
    expect(trip.textContent.trim()).toBe("Delayed");
    expect(trip.className).toContain("st-pill--delayed");
    expect(root.querySelector('[data-chip-pass="RP247@2026-06-20-001"]').textContent.trim()).toBe("Delayed");
    expect(root.querySelector('[data-chip-pass="RP247@2026-06-20-002"]').textContent.trim()).toBe("On Time");
  });

  it("offers the full vocabulary as status keys (single vocabulary)", async () => {
    mountFlights(root, {});
    await flush();
    const keys = [...root.querySelectorAll('.fl-editor[data-scope="grp"] [data-status-key]')].map(b => b.dataset.statusKey);
    expect(keys).toEqual(["", "On Time", "Boarding", "Delayed", "Cancelled", "Diverted"]);
  });

  it("updates the pills optimistically after a flight-wide status push", async () => {
    mountFlights(root, {});
    await flush();
    const panel = root.querySelector('.fl-panel[data-panel="RP247@2026-06-20"]');
    panel.querySelector('.fl-editor[data-scope="grp"] [data-status-key="Boarding"]').click();
    expect(panel.querySelector('input[data-f="transitStatus"]').value).toBe("Boarding");
    panel.querySelector('button[data-act="grp-update"]').click();
    await flush();
    expect(pushed).toEqual([{ transitStatus: "Boarding" }]);
    expect(root.querySelector('[data-chip-trip="RP247@2026-06-20"]').textContent.trim()).toBe("Boarding");
    expect(root.querySelector('[data-chip-pass="RP247@2026-06-20-001"]').textContent.trim()).toBe("Boarding");
    expect(root.querySelector('[data-chip-pass="RP247@2026-06-20-002"]').textContent.trim()).toBe("Boarding");
  });
});

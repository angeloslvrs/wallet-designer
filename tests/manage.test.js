// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountManage } from "../apps/designer/src/manage.js";

// Manage status editor: the schedule fields (currentBoardingDate/DepartureDate/
// ArrivalDate) are ISO-8601 — iOS rejects a pass whose date isn't. They must
// use the same typed datetime-local + offset picker the Issue view uses, so an
// operator can't hand-type a malformed value into a group push.
const flush = () => new Promise(r => setTimeout(r, 0));
const ev = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

let root, pushed, listResp;
beforeEach(() => {
  pushed = [];
  listResp = [{
    serial: "5J5057@2026-06-14-001", groupId: "5J5057@2026-06-14",
    passenger: "SOLIVERES/ANGELO", seat: "14A",
    lastModified: "Sat, 14 Jun 2026 00:00:00 GMT", deviceCount: 0, template: "cebpac"
  }];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u === "/api/passes") return { json: async () => listResp };
    if (u.startsWith("/api/log")) return { json: async () => [] };
    if (u.includes("/api/groups/") && u.endsWith("/status")) {
      pushed.push(JSON.parse(opts.body));
      return { json: async () => ({ ok: true, count: 1, sent: 0, results: [] }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { root.remove(); delete globalThis.fetch; });

describe("Manage status editor — typed ISO-8601 date inputs", () => {
  it("renders the schedule fields as datetime-local pickers, not free text", async () => {
    mountManage(root, () => {});
    await flush();
    const ph = root.querySelector('[data-typed-status="currentBoardingDate"]');
    expect(ph).toBeTruthy();
    expect(ph.querySelector('input[type="datetime-local"]')).toBeTruthy();
    // The date key must no longer be a raw text field that accepts any string.
    expect(root.querySelector('input[data-f="currentBoardingDate"]')).toBeNull();
  });

  it("pushes a well-formed ISO-8601 date (wall-clock + offset) plus a plain field", async () => {
    mountManage(root, () => {});
    await flush();
    const card = root.querySelector('.mg-card[data-card="5J5057@2026-06-14"]');
    const typed = card.querySelector('[data-typed-status="currentBoardingDate"]');
    const dt = typed.querySelector('input[type="datetime-local"]');
    const off = typed.querySelector('input[type="text"]');
    dt.value = "2026-06-14T15:10"; off.value = "+09:00"; ev(off, "input");
    const gate = card.querySelector('input[data-f="departureGate"]');
    gate.value = "56"; ev(gate, "input");
    card.querySelector('button[data-act="grp-update"]').click();
    await flush();
    expect(pushed).toEqual([{ currentBoardingDate: "2026-06-14T15:10:00+09:00", departureGate: "56" }]);
  });
});

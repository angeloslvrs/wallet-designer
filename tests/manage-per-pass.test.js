// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountManage } from "../apps/designer/src/manage.js";

// Per-pass status updates used to use window.prompt(); they now use the same
// typed, validated inline editor as the trip-level push, scoped to one serial.
const flush = () => new Promise(r => setTimeout(r, 0));
const ev = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
const SERIAL = "5J5057@2026-06-14-001";

let root, pushedTo;
beforeEach(() => {
  pushedTo = [];
  const listResp = [{
    serial: SERIAL, groupId: "5J5057@2026-06-14",
    passenger: "SOLIVERES/ANGELO", seat: "14A",
    lastModified: "Sat, 14 Jun 2026 00:00:00 GMT", deviceCount: 1, template: "cebpac"
  }];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u === "/api/passes") return { json: async () => listResp };
    if (u.startsWith("/api/log")) return { json: async () => [] };
    if (u.includes("/api/passes/") && u.endsWith("/status")) {
      pushedTo.push({ url: u, body: JSON.parse(opts.body) });
      return { json: async () => ({ ok: true, push: { sent: 1, failures: [], unregistered: [] } }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  // A prompt() call would throw, failing any test that regressed to the old flow.
  globalThis.prompt = () => { throw new Error("prompt() should not be used"); };
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { root.remove(); delete globalThis.fetch; delete globalThis.prompt; });

describe("Manage — per-pass inline status editor", () => {
  it("drops the prompt-based gate/delay/status buttons for an inline editor", async () => {
    mountManage(root, () => {});
    await flush();
    expect(root.querySelector('button[data-act="gate"]')).toBeNull();
    expect(root.querySelector('button[data-act="delay"]')).toBeNull();
    expect(root.querySelector('button[data-act="status"]')).toBeNull();
    expect(root.querySelector('.mg-row .mg-editor[data-scope="pass"]')).toBeTruthy();
  });

  it("pushes a single-pass update from the inline editor", async () => {
    mountManage(root, () => {});
    await flush();
    const row = root.querySelector(`.mg-row[data-row="${SERIAL}"]`);
    const gate = row.querySelector('.mg-editor[data-scope="pass"] input[data-f="departureGate"]');
    gate.value = "C12"; ev(gate, "input");
    row.querySelector('button[data-act="pass-update"]').click();
    await flush();
    expect(pushedTo).toHaveLength(1);
    expect(pushedTo[0].url).toContain(encodeURIComponent(SERIAL));
    expect(pushedTo[0].body).toEqual({ departureGate: "C12" });
  });
});

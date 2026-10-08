// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountFlights } from "../apps/designer/src/flights.js";

// Per-pass status updates live inside the flight panel's passenger list: the
// same typed, validated editor as the flight-wide push, scoped to one serial.
const flush = () => new Promise(r => setTimeout(r, 0));
const ev = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
const SERIAL = "5J5057@2026-06-14-001";

let root, pushedTo;
beforeEach(() => {
  pushedTo = [];
  const listResp = [{
    serial: SERIAL, groupId: "5J5057@2026-06-14",
    passenger: "SOLIVERES/ANGELO", seat: "14A",
    lastModified: "Sat, 14 Jun 2026 00:00:00 GMT", deviceCount: 1, template: "cebpac",
    current: { departureGate: "B9", currentBoardingDate: "2026-06-14T07:30:00-07:00" }
  }];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u === "/api/passes") return { json: async () => listResp };
    if (u.includes("/api/passes/") && u.endsWith("/status")) {
      pushedTo.push({ url: u, body: JSON.parse(opts.body) });
      return { json: async () => ({ ok: true, push: { sent: 1, failures: [], unregistered: [] } }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  globalThis.prompt = () => { throw new Error("prompt() should not be used"); };
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { root.remove(); delete globalThis.fetch; delete globalThis.prompt; root._mountAbort?.abort(); });

describe("Flights — per-pass inline status editor", () => {
  it("renders an inline per-pass editor under each passenger", async () => {
    mountFlights(root, {});
    await flush();
    expect(root.querySelector(`.fl-pass[data-row="${SERIAL}"] .fl-editor[data-scope="pass"]`)).toBeTruthy();
  });

  it("pushes a single-pass update from the inline editor", async () => {
    mountFlights(root, {});
    await flush();
    const row = root.querySelector(`.fl-pass[data-row="${SERIAL}"]`);
    const gate = row.querySelector('.fl-editor[data-scope="pass"] input[data-f="departureGate"]');
    gate.value = "C12"; ev(gate, "input");
    row.querySelector('button[data-act="pass-update"]').click();
    await flush();
    expect(pushedTo).toHaveLength(1);
    expect(pushedTo[0].url).toContain(encodeURIComponent(SERIAL));
    expect(pushedTo[0].body).toEqual({ departureGate: "C12" });
  });

  it("shows the pass's current value as a placeholder/hint, never a submittable one", async () => {
    mountFlights(root, {});
    await flush();
    const row = root.querySelector(`.fl-pass[data-row="${SERIAL}"]`);
    const editor = row.querySelector('.fl-editor[data-scope="pass"]');
    const gate = editor.querySelector('input[data-f="departureGate"]');
    expect(gate.placeholder).toBe("B9");
    expect(gate.value).toBe("");
    expect(editor.querySelector(".fl-f-current")?.textContent).toContain("Jun 14");
    row.querySelector('button[data-act="pass-update"]').click();
    await flush();
    expect(pushedTo).toHaveLength(0);
  });
});

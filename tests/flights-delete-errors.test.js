// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountFlights } from "../apps/designer/src/flights.js";

// Delete / flight-delete must not fail silently: a network fault or non-2xx
// response has to surface an error AND must not behave like a success (no
// reload dropping the row as if the delete went through).
const flush = () => new Promise(r => setTimeout(r, 0));
const SERIAL = "5J5057@2026-06-14-001";
const GID = "5J5057@2026-06-14";

let root, passesFetches, deleteMode;
beforeEach(() => {
  passesFetches = 0;
  deleteMode = "reject";
  const listResp = [{
    serial: SERIAL, groupId: GID,
    passenger: "SOLIVERES/ANGELO", seat: "14A",
    lastModified: "Sat, 14 Jun 2026 00:00:00 GMT", deviceCount: 0, template: "cebpac"
  }];
  globalThis.confirm = () => true;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u === "/api/passes") { passesFetches++; return { ok: true, json: async () => listResp }; }
    if (opts?.method === "DELETE") {
      if (deleteMode === "reject") throw new Error("network down");
      return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { root.remove(); delete globalThis.fetch; delete globalThis.confirm; root._mountAbort?.abort(); });

describe("Flights — delete error handling", () => {
  it("surfaces a rejected per-pass delete and does not reload as success", async () => {
    mountFlights(root, {});
    await flush();
    expect(passesFetches).toBe(1);
    root.querySelector(`.fl-pass[data-row="${SERIAL}"] button[data-act="del"]`).click();
    await flush(); await flush();
    expect(root.querySelector(`[data-status="${SERIAL}"]`).textContent).toMatch(/delete failed/i);
    expect(passesFetches).toBe(1);
    expect(root.querySelector(`.fl-pass[data-row="${SERIAL}"]`)).toBeTruthy();
  });

  it("surfaces a non-ok per-pass delete and does not reload as success", async () => {
    deleteMode = "non-ok";
    mountFlights(root, {});
    await flush();
    root.querySelector(`.fl-pass[data-row="${SERIAL}"] button[data-act="del"]`).click();
    await flush(); await flush();
    expect(root.querySelector(`[data-status="${SERIAL}"]`).textContent).toMatch(/delete failed/i);
    expect(passesFetches).toBe(1);
  });

  it("surfaces a failed flight delete and does not reload as success", async () => {
    mountFlights(root, {});
    await flush();
    root.querySelector(`.fl-panel[data-panel="${GID}"] button[data-act="grp-del"]`).click();
    await flush(); await flush();
    expect(root.querySelector(`[data-grp-status="${GID}"]`).textContent).toMatch(/delete failed/i);
    expect(passesFetches).toBe(1);
    expect(root.querySelector(`.fl-row[data-flight="${GID}"]`)).toBeTruthy();
  });
});

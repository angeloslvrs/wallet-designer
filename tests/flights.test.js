// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountFlights, flightsFrom } from "../apps/designer/src/flights.js";

// Flights view: the departures board (one row per trip) with a docked control
// panel. The panel's schedule fields are ISO-8601 — iOS rejects a pass whose
// date isn't — so they use the same typed date + time + offset picker as the
// Issue view; an operator can't hand-type a malformed value into a push.
const flush = () => new Promise(r => setTimeout(r, 0));
const ev = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

let root, pushed, listResp;
beforeEach(() => {
  pushed = [];
  listResp = [{
    serial: "5J5057@2026-06-14-001", groupId: "5J5057@2026-06-14",
    passenger: "SOLIVERES/ANGELO", seat: "14A",
    lastModified: "Sat, 14 Jun 2026 00:00:00 GMT", deviceCount: 0, template: "cebpac",
    route: { from: "MNL", to: "NRT", toCity: "Tokyo", flight: "5J 5057" },
    current: { departureGate: "12", currentDepartureDate: "2026-06-14T06:40:00+08:00" }
  }];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u === "/api/passes") return { json: async () => listResp };
    if (u.includes("/api/groups/") && u.endsWith("/status")) {
      pushed.push(JSON.parse(opts.body));
      return { json: async () => ({ ok: true, count: 1, sent: 0, results: [] }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { root.remove(); delete globalThis.fetch; root._mountAbort?.abort(); document.getElementById("toast")?.remove(); });

describe("flightsFrom — board rows from the flat pass list", () => {
  it("groups by groupId, reads route/gate/times from the first pass that has them, and sorts by departure", () => {
    const rows = flightsFrom([
      { serial: "b-1", groupId: "B", current: { currentDepartureDate: "2026-06-15T08:00:00Z" }, deviceCount: 1 },
      { serial: "a-1", groupId: "A", route: { flight: "5J 5056", to: "NRT", toCity: "Tokyo" }, current: {}, deviceCount: 0 },
      { serial: "a-2", groupId: "A", current: { departureGate: "12", currentDepartureDate: "2026-06-14T06:40:00+08:00" }, deviceCount: 1, status: "Delayed" }
    ]);
    expect(rows.map(r => r.gid)).toEqual(["A", "B"]);
    const a = rows[0];
    expect(a.flight).toBe("5J 5056");
    expect(a.gate).toBe("12");
    expect(a.toCity).toBe("Tokyo");
    expect(a.devices).toBe(1);
    expect(a.status).toBe("Delayed");
    expect(a.members).toHaveLength(2);
  });
  it("labels legacy passes without a trip id and sorts undated flights last", () => {
    const rows = flightsFrom([{ serial: "x" }, { serial: "y", groupId: "Y", current: { currentDepartureDate: "2026-06-14T06:40:00Z" } }]);
    expect(rows.map(r => r.gid)).toEqual(["Y", "(legacy — no trip id)"]);
    expect(rows[1].flight).toBe("(legacy — no trip id)");
  });
});

describe("Flights board + panel", () => {
  it("renders a board row per flight and selects the first one into the panel", async () => {
    mountFlights(root, {});
    await flush();
    const row = root.querySelector('.fl-row[data-flight="5J5057@2026-06-14"]');
    expect(row).toBeTruthy();
    expect(row.classList.contains("is-selected")).toBe(true);
    expect(row.textContent).toContain("5J 5057");
    expect(row.textContent).toContain("Tokyo");
    expect(root.querySelector('.fl-panel[data-panel="5J5057@2026-06-14"]')).toBeTruthy();
  });

  it("renders the schedule fields as separate date + time pickers, not free text", async () => {
    mountFlights(root, {});
    await flush();
    const ph = root.querySelector('.fl-editor[data-scope="grp"] [data-typed-status="currentBoardingDate"]');
    expect(ph).toBeTruthy();
    expect(ph.querySelector('input[type="date"]')).toBeTruthy();
    expect(ph.querySelector('input[type="time"]')).toBeTruthy();
    expect(root.querySelector('input[data-f="currentBoardingDate"]')).toBeNull();
  });

  it("pushes a well-formed ISO-8601 date (wall-clock + offset) plus a plain field to the whole flight", async () => {
    mountFlights(root, {});
    await flush();
    const panel = root.querySelector('.fl-panel[data-panel="5J5057@2026-06-14"]');
    const typed = panel.querySelector('[data-typed-status="currentBoardingDate"]');
    const date = typed.querySelector('input[type="date"]');
    const time = typed.querySelector('input[type="time"]');
    const off = typed.querySelector('input[type="text"]');
    date.value = "2026-06-14"; ev(date, "input");
    time.value = "15:10"; ev(time, "input");
    off.value = "+09:00"; ev(off, "input");
    const gate = panel.querySelector('input[data-f="departureGate"]');
    gate.value = "56"; ev(gate, "input");
    panel.querySelector('button[data-act="grp-update"]').click();
    await flush();
    expect(pushed).toEqual([{ departureGate: "56", currentBoardingDate: "2026-06-14T15:10:00+09:00" }]);
  });

  it("shows the flight's live gate and times in the trip editor instead of made-up examples", async () => {
    mountFlights(root, {});
    await flush();
    const ed = root.querySelector('.fl-editor[data-scope="grp"]');
    expect(ed.querySelector('input[data-f="departureGate"]').placeholder).toBe("12");
    expect(ed.querySelector('.fl-field--departureGate .fl-f-current').textContent).toContain("now 12");
    expect(ed.querySelector('.fl-sched > summary').textContent).toMatch(/departure/i);
    // The picker's inputs carry accessible names.
    expect(ed.querySelector('[data-typed-status="currentBoardingDate"] input[type="date"]').getAttribute("aria-label")).toBe("Boarding date");
  });

  it("walks the push button through Pushing… → ✓ and announces the result", async () => {
    mountFlights(root, {});
    await flush();
    const panel = root.querySelector('.fl-panel');
    const gate = panel.querySelector('input[data-f="departureGate"]');
    gate.value = "56"; ev(gate, "input");
    const btn = panel.querySelector('button[data-act="grp-update"]');
    btn.click();
    expect(btn.textContent).toBe("Pushing…");
    await flush();
    expect(btn.textContent).toMatch(/✓/);
    expect(panel.querySelector('[data-grp-status]').getAttribute("aria-live")).toBe("polite");
    expect(document.getElementById("toast")?.textContent).toMatch(/✓/);
  });

  it("pushes nothing and reports when every field is untouched", async () => {
    mountFlights(root, {});
    await flush();
    root.querySelector('button[data-act="grp-update"]').click();
    await flush();
    expect(pushed).toHaveLength(0);
    expect(root.querySelector('[data-grp-status="5J5057@2026-06-14"]').textContent).toMatch(/nothing to update/i);
  });

  it("shows an empty state with the issue call-to-action when nothing is issued", async () => {
    listResp = [];
    let shown = 0;
    mountFlights(root, { showIssue: () => shown++ });
    await flush();
    expect(root.textContent).toMatch(/No flights yet/);
    root.querySelector('button[data-act="new-flight"]').click();
    expect(shown).toBe(1);
  });
});

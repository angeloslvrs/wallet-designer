import { esc } from "./esc.js";
import { buildStatusBody, describePushResult, validateStatusValues } from "./ops.js";
import { semanticKind } from "@wpd/pass-builder/field-kinds.js";
import { renderTypedInput } from "./inputs.js";
import { appleWalletButton } from "./wallet-badge.js";

// Flights view — the landing screen: a departures board (one row per trip /
// groupId) with a docked control panel for the selected flight. The panel
// pushes a typed, validated status update to every pass on the flight
// (POST /api/groups/:id/status) and lists the passengers, each with its own
// per-pass editor (POST /api/passes/:serial/status), Add-to-Wallet and Delete.

// Status-editor fields. Keys are Apple's semantic keys (the status API
// vocabulary). transitStatus renders as a row of keys backed by a hidden
// input; the rest are typed pickers (dates) or plain inputs.
const STATUS_FIELDS = [
  ["transitStatus", "Status", "", ["", "On Time", "Boarding", "Delayed", "Cancelled", "Diverted"]],
  ["transitStatusReason", "Reason shown on device", "e.g. crew availability"],
  ["departureGate", "Gate", "B9"],
  ["currentBoardingDate", "Boarding", ""],
  ["currentDepartureDate", "Departure", ""],
  ["currentArrivalDate", "Arrival", ""]
];
// Rarely-touched fields live behind a "More" disclosure.
const MORE_FIELDS = [
  ["transitProvider", "Transit info", ""],
  ["securityScreening", "Security", ""],
  ["delayed", "Delay note", ""]
];
const ALL_FIELDS = [...STATUS_FIELDS, ...MORE_FIELDS];
// Clearing resets the delay/status banner only; schedule fields are left alone.
const CLEAR_BODY = { delayed: "", transitStatus: "", transitStatusReason: "" };

export const STATUS_SLUG = { "On Time": "ontime", "Boarding": "boarding", "Delayed": "delayed", "Cancelled": "cancelled", "Diverted": "diverted" };
// Trip status = the most severe status across its passes.
const STATUS_SEVERITY = ["Cancelled", "Diverted", "Delayed", "Boarding", "On Time"];
const pillHtml = (status, attr = "") => {
  const s = status || "On Time";
  return `<span class="st-pill st-pill--${STATUS_SLUG[s] || "other"}" ${attr}>${esc(s)}</span>`;
};
export const tripStatusOf = (members) => {
  const set = new Set(members.map(p => p.status || "On Time"));
  return STATUS_SEVERITY.find(s => set.has(s)) ?? [...set][0] ?? "On Time";
};
function setPillEl(el, status) {
  if (!el) return;
  const s = status || "On Time";
  el.className = `st-pill st-pill--${STATUS_SLUG[s] || "other"} flap`;
  el.textContent = s;
}

const fmtWhen = (s) => {
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
const fmtTime = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
};
const fmtDay = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};
const ago = (s) => {
  const t = new Date(s).getTime();
  if (isNaN(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};

/**
 * Fold the flat GET /api/passes list into board rows, one per groupId.
 * Pure — exported for tests. Flights with a known departure sort first by it;
 * undated ones follow in list order.
 */
export function flightsFrom(list) {
  const groups = new Map();
  for (const p of list) {
    const gid = p.groupId ?? "(legacy — no trip id)";
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push(p);
  }
  const rows = [...groups.entries()].map(([gid, members]) => {
    const first = (pick) => { for (const m of members) { const v = pick(m); if (v) return v; } return undefined; };
    const departs = first(m => m.current?.currentDepartureDate);
    return {
      gid, members,
      flight: first(m => m.route?.flight) ?? gid,
      from: first(m => m.route?.from), to: first(m => m.route?.to),
      toCity: first(m => m.route?.toCity),
      gate: first(m => m.current?.departureGate),
      departs, boards: first(m => m.current?.currentBoardingDate),
      status: tripStatusOf(members),
      template: first(m => m.template),
      devices: members.reduce((n, p) => n + (p.deviceCount || 0), 0),
      lastModified: members.map(m => m.lastModified).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0]
    };
  });
  const t = (r) => { const v = new Date(r.departs ?? "").getTime(); return isNaN(v) ? Infinity : v; };
  return rows.sort((a, b) => t(a) - t(b));
}

const scopeKey = (kind, id) => `${kind}:${id}`;

export function mountFlights(root, { showIssue } = {}) {
  // Re-mounted on every tab visit — drop the previous mount's listener or one
  // click would fire each action once per visit (duplicate pushes/deletes).
  root._mountAbort?.abort();
  const { signal } = (root._mountAbort = new AbortController());

  let flights = [];
  let selected = null;        // gid of the flight in the panel
  // Typed (ISO-8601) editor values, keyed by scope ("grp:<gid>" / "pass:<serial>")
  // then field key. Pickers write here; update reads it back. Reset on load().
  let editorValues = {};

  const $ = (s) => root.querySelector(s);
  const setStatus = (serial, msg) => { const el = $(`[data-status="${CSS.escape(serial)}"]`); if (el) el.textContent = msg; };
  const setGrpStatus = (gid, msg) => { const el = $(`[data-grp-status="${CSS.escape(gid)}"]`); if (el) el.textContent = msg; };

  const shell = (body, meta = "") => `
    <div class="view fl-view">
      <div class="view-head">
        <div><h1>Departures</h1><p class="view-sub">${meta}</p></div>
        <div class="fl-head-right"><span class="fl-clock" data-clock></span>${showIssue ? `<button type="button" class="btn btn-primary" data-act="new-flight">New flight</button>` : ""}</div>
      </div>
      ${body}
    </div>`;

  // ---- board ----------------------------------------------------------------
  function boardRow(f) {
    const dest = f.toCity || f.to || "—";
    const sub = [f.to && f.toCity ? f.to : null, f.from ? `from ${f.from}` : null, f.template ? esc(f.template) : null].filter(Boolean).join(" · ");
    return `
      <div class="fl-row ${f.gid === selected ? "is-selected" : ""}" data-flight="${esc(f.gid)}" role="button" tabindex="0">
        <div class="fl-flight">${esc(f.flight)}</div>
        <div class="fl-gate ${f.gate ? "" : "is-empty"}">${esc(f.gate || "—")}</div>
        <div class="fl-dest">${esc(dest)}<small>${sub || esc(f.gid)}</small></div>
        <div class="fl-time">${f.departs ? `${esc(fmtTime(f.departs))}<small>${esc(fmtDay(f.departs))}${f.boards ? ` · boards ${esc(fmtTime(f.boards))}` : ""}</small>` : `<span class="is-empty">—</span>`}</div>
        <div>${pillHtml(f.status, `data-chip-trip="${esc(f.gid)}"`)}</div>
        <div class="fl-count">${f.members.length} <span>· ${f.devices} on device</span><div class="fl-bar"><i style="width:${f.members.length ? Math.round(100 * f.devices / f.members.length) : 0}%"></i></div></div>
      </div>`;
  }
  const boardHtml = () => `
    <div class="card fl-board">
      <div class="fl-head"><div>Flight</div><div>Gate</div><div>Destination</div><div>Departs</div><div>Status</div><div>Passes · on device</div></div>
      ${flights.map(boardRow).join("")}
    </div>`;

  // ---- editors --------------------------------------------------------------
  // One status editor (trip-wide or per-pass). `current` (per-pass only) shows
  // what's already live as placeholder/hint — never a submittable value, so an
  // untouched field means "don't change this" (buildStatusBody drops empties).
  function fieldHtml([key, label, ph, options], kind, id, current) {
    const cur = current?.[key];
    let control;
    if (options) {
      // Status keys: a segmented row writing into a hidden input (same data-f
      // contract as every other field). "(no change)" is the empty key.
      control = `<div class="fl-keys" data-keys="${esc(key)}">${options.map(o =>
        `<button type="button" class="fl-key" data-status-key="${esc(o)}" title="${esc(o || "no change")}">${esc(o || "—")}</button>`).join("")}</div><input type="hidden" data-f="${esc(key)}" value="" />`;
    } else if (semanticKind(key) === "date") {
      control = `<div class="fl-typed" data-typed-status="${esc(key)}" data-scope="${esc(kind)}" data-scope-id="${esc(id)}" title="${esc(label)}"></div>`;
    } else {
      control = `<input data-f="${esc(key)}" placeholder="${esc(cur || ph)}" title="${esc(label)}" />`;
    }
    const showHint = cur && (semanticKind(key) === "date" || Boolean(options));
    const hint = showHint ? ` <span class="fl-f-current">now ${esc(semanticKind(key) === "date" ? fmtWhen(cur) : cur)}</span>` : "";
    return `<label class="fl-field fl-field--${esc(key)}"><span class="fl-f-label">${esc(label)}${hint}</span>${control}<span class="field-err" data-ferr="${esc(key)}"></span></label>`;
  }
  function editorHtml(kind, id, actsHtml, current) {
    const main = STATUS_FIELDS.map(f => fieldHtml(f, kind, id, current)).join("");
    const more = MORE_FIELDS.map(f => fieldHtml(f, kind, id, current)).join("");
    return `<div class="fl-editor" data-scope="${esc(kind)}" data-scope-id="${esc(id)}">${main}
      <details class="fl-more"><summary>More — transit info, security, delay note</summary><div class="fl-more-body">${more}</div></details>
      <div class="fl-editor-acts">${actsHtml}</div></div>`;
  }

  function mountDateFields(container) {
    for (const ph of container.querySelectorAll("[data-typed-status]")) {
      const key = ph.dataset.typedStatus;
      const sk = scopeKey(ph.dataset.scope, ph.dataset.scopeId);
      (editorValues[sk] ??= {});
      ph.replaceChildren(renderTypedInput({
        type: "date",
        value: editorValues[sk][key],
        onChange: (v) => {
          (editorValues[sk] ??= {})[key] = v;
          const span = ph.parentElement?.querySelector("[data-ferr]");
          const msg = validateStatusValues({ [key]: v })[key];
          if (span) { span.textContent = msg ?? ""; span.classList.toggle("show", Boolean(msg)); }
        }
      }));
    }
  }

  // ---- panel ----------------------------------------------------------------
  function passRow(p) {
    const editor = editorHtml("pass", p.serial,
      `<button type="button" data-act="pass-update" data-serial="${esc(p.serial)}" class="btn btn-primary btn-sm">Push to this pass</button>` +
      `<button type="button" data-act="pass-clear" data-serial="${esc(p.serial)}" class="btn btn-sm">Clear status</button>`,
      p.current);
    return `
      <div class="fl-pass" data-row="${esc(p.serial)}">
        <div class="fl-pass-main">
          ${pillHtml(p.status, `data-chip-pass="${esc(p.serial)}"`)}
          <b class="fl-pass-name">${esc(p.passenger || "—")}</b>
          <span class="fl-pass-seat">${esc(p.seat || "—")}</span>
          <code class="fl-pass-serial" title="${esc(p.serial)}">${esc(p.serial)}</code>
          <span class="fl-pass-dev ${p.deviceCount ? "is-on" : ""}">${p.deviceCount ? `● ${p.deviceCount} on device` : "○ not added"}</span>
        </div>
        <div class="fl-pass-acts">
          ${appleWalletButton(`/api/passes/${encodeURIComponent(p.serial)}/pkpass`)}
          <button type="button" data-act="del" data-serial="${esc(p.serial)}" class="btn-link danger">Delete</button>
        </div>
        <details class="fl-pass-edit">
          <summary>Update just this pass</summary>
          ${editor}
        </details>
        <div class="fl-status" data-status="${esc(p.serial)}"></div>
      </div>`;
  }

  function panelHtml(f) {
    if (!f) return `<aside class="card fl-panel fl-panel--empty"><p class="empty">Select a flight to update it.</p></aside>`;
    const editor = editorHtml("grp", f.gid,
      `<button type="button" data-act="grp-update" data-grp="${esc(f.gid)}" class="btn btn-primary">Push to ${f.devices} device${f.devices === 1 ? "" : "s"}</button>` +
      `<button type="button" data-act="grp-clear" data-grp="${esc(f.gid)}" class="btn">Clear status</button>` +
      `<span class="fl-grp-status" data-grp-status="${esc(f.gid)}"></span>`);
    const route = f.from || f.to ? `${esc(f.from || "?")} → ${esc(f.to || "?")}` : esc(f.gid);
    return `
      <aside class="card fl-panel" data-panel="${esc(f.gid)}">
        <div class="fl-panel-head">
          <div><h2>${esc(f.flight)} <span class="fl-route">${route}</span></h2>
            <p class="fl-panel-sub">${f.departs ? `${esc(fmtDay(f.departs))} · dep ${esc(fmtTime(f.departs))}` : "no departure time"} · ${f.members.length} pass${f.members.length === 1 ? "" : "es"} · ${f.devices} on device${f.lastModified ? ` · updated ${esc(ago(f.lastModified))}` : ""}</p></div>
          <button type="button" data-act="grp-del" data-grp="${esc(f.gid)}" class="btn-link danger">Delete flight</button>
        </div>
        ${editor}
        <div class="fl-passes">
          <div class="fl-passes-head"><span>Passengers</span>${showIssue ? `<button type="button" class="btn-link" data-act="add-pax">+ Add passengers</button>` : ""}</div>
          ${f.members.map(passRow).join("")}
        </div>
      </aside>`;
  }

  function renderPanel() {
    const host = $(".fl-panel-host");
    if (!host) return;
    host.innerHTML = panelHtml(flights.find(f => f.gid === selected));
    mountDateFields(host);
  }

  function select(gid) {
    selected = gid;
    for (const row of root.querySelectorAll(".fl-row")) row.classList.toggle("is-selected", row.dataset.flight === gid);
    renderPanel();
  }

  // ---- load -----------------------------------------------------------------
  async function load() {
    // A stale mount (aborted on a tab switch) must not blank the DOM the newer
    // mount owns — bail on an aborted signal before AND after the fetch.
    if (signal.aborted) return;
    editorValues = {};
    root.innerHTML = shell(`<p class="empty">Loading…</p>`);
    let list;
    try { list = await fetch("/api/passes", { signal }).then(r => r.json()); }
    catch { if (signal.aborted) return; root.innerHTML = shell(`<p class="empty">API offline.</p>`); return; }
    if (signal.aborted) return;

    if (!Array.isArray(list) || !list.length) {
      root.innerHTML = shell(`
        <div class="empty empty--action">
          <p>No flights yet.</p>
          <p class="hint">Pick a template, issue passes, and they show up here grouped by flight, ready to push updates to.</p>
          ${showIssue ? `<button type="button" class="btn btn-primary" data-act="new-flight">Choose a template</button>` : ""}
        </div>`);
      return;
    }

    flights = flightsFrom(list);
    if (!flights.some(f => f.gid === selected)) selected = flights[0].gid;
    const passes = list.length, devices = flights.reduce((n, f) => n + f.devices, 0);
    root.innerHTML = shell(
      `<div class="fl-split"><div class="stagger">${boardHtml()}</div><div class="fl-panel-host"></div></div>`,
      `${flights.length} flight${flights.length === 1 ? "" : "s"} · ${passes} pass${passes === 1 ? "" : "es"} · ${devices} on device${devices === 1 ? "" : "s"}`
    );
    renderPanel();
  }

  // ---- pushes ---------------------------------------------------------------
  async function pushOne(serial, body) {
    setStatus(serial, "Pushing…");
    const j = await fetch(`/api/passes/${encodeURIComponent(serial)}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal
    }).then(r => r.json()).catch(() => ({}));
    if (signal.aborted) return {};
    setStatus(serial, describePushResult(j));
    return j;
  }
  async function pushGroup(gid, body) {
    setGrpStatus(gid, "Pushing…");
    const j = await fetch(`/api/groups/${encodeURIComponent(gid)}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal
    }).then(r => r.json()).catch(() => ({}));
    if (signal.aborted) return {};
    setGrpStatus(gid, describePushResult(j));
    return j;
  }

  // After a push the new transitStatus is known (from the body we sent), so
  // pills update without a reload. A clear resets to "On Time".
  const passPill = (serial) => $(`[data-chip-pass="${CSS.escape(serial)}"]`);
  function recomputeTripPill(gid) {
    const f = flights.find(x => x.gid === gid);
    if (!f) return;
    f.status = tripStatusOf(f.members);
    setPillEl($(`[data-chip-trip="${CSS.escape(gid)}"]`), f.status);
  }
  function setGroupStatus(gid, status) {
    const f = flights.find(x => x.gid === gid);
    if (!f) return;
    for (const m of f.members) { m.status = status; setPillEl(passPill(m.serial), status); }
    recomputeTripPill(gid);
  }
  function setPassStatus(gid, serial, status) {
    const f = flights.find(x => x.gid === gid);
    const m = f?.members.find(x => x.serial === serial);
    if (m) m.status = status;
    setPillEl(passPill(serial), status);
    recomputeTripPill(gid);
  }

  // Read one editor: plain inputs/hidden from the DOM, typed dates from editorValues.
  function collectEditorValues(container, key) {
    const values = {};
    for (const inp of container.querySelectorAll("[data-f]")) values[inp.dataset.f] = inp.value;
    Object.assign(values, editorValues[key] ?? {});
    return values;
  }
  function showEditorErrors(container, errs) {
    for (const span of container.querySelectorAll("[data-ferr]")) {
      const msg = errs[span.dataset.ferr];
      span.textContent = msg ?? ""; span.classList.toggle("show", Boolean(msg));
    }
  }
  async function runUpdate(container, { kind, id, setMsg }) {
    const values = collectEditorValues(container, scopeKey(kind, id));
    const errs = validateStatusValues(values);
    showEditorErrors(container, errs);
    if (Object.keys(errs).length) { setMsg(`✗ fix ${Object.keys(errs).length} invalid field(s) before pushing`); return { ok: false }; }
    const body = buildStatusBody(values);
    if (!body) { setMsg("✗ nothing to update — change at least one field"); return { ok: false }; }
    const j = kind === "grp" ? await pushGroup(id, body) : await pushOne(id, body);
    return { ok: !!j?.ok, body };
  }

  // ---- events ---------------------------------------------------------------
  root.addEventListener("click", async (e) => {
    const key = e.target.closest("[data-status-key]");
    if (key) {
      const grp = key.closest("[data-keys]");
      const hidden = grp?.parentElement?.querySelector('input[data-f="transitStatus"]');
      for (const b of grp.querySelectorAll("[data-status-key]")) b.classList.toggle("is-on", b === key);
      if (hidden) hidden.value = key.dataset.statusKey;
      return;
    }
    const row = e.target.closest(".fl-row");
    if (row) { select(row.dataset.flight); return; }

    const t = e.target.closest("[data-act]");
    if (!t) return;
    const act = t.dataset.act, serial = t.dataset.serial, grp = t.dataset.grp;
    const gidOf = (s) => flights.find(f => f.members.some(m => m.serial === s))?.gid;

    if (act === "new-flight" || act === "add-pax") { showIssue?.(); return; }
    if (act === "del") {
      if (!confirm(`Delete pass ${serial}?`)) return;
      setStatus(serial, "Deleting…");
      try {
        const r = await fetch(`/api/passes/${encodeURIComponent(serial)}`, { method: "DELETE", signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        load();
      } catch (err) { if (signal.aborted) return; setStatus(serial, `✗ delete failed — ${err.message}`); }
      return;
    }
    if (act === "grp-update") {
      const { ok, body } = await runUpdate(t.closest(".fl-editor"), { kind: "grp", id: grp, setMsg: (m) => setGrpStatus(grp, m) });
      if (ok && body?.transitStatus) setGroupStatus(grp, body.transitStatus);
      return;
    }
    if (act === "pass-update") {
      const { ok, body } = await runUpdate(t.closest(".fl-editor"), { kind: "pass", id: serial, setMsg: (m) => setStatus(serial, m) });
      if (ok && body?.transitStatus) setPassStatus(gidOf(serial), serial, body.transitStatus);
      return;
    }
    if (act === "grp-clear") { const j = await pushGroup(grp, { ...CLEAR_BODY }); if (j?.ok) setGroupStatus(grp, "On Time"); return; }
    if (act === "pass-clear") { const j = await pushOne(serial, { ...CLEAR_BODY }); if (j?.ok) setPassStatus(gidOf(serial), serial, "On Time"); return; }
    if (act === "grp-del") {
      if (!confirm(`Delete ALL passes on ${grp}?`)) return;
      setGrpStatus(grp, "Deleting…");
      try {
        const r = await fetch(`/api/groups/${encodeURIComponent(grp)}`, { method: "DELETE", signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        load();
      } catch (err) { if (signal.aborted) return; setGrpStatus(grp, `✗ delete failed — ${err.message}`); }
      return;
    }
  }, { signal });

  root.addEventListener("keydown", (e) => {
    const row = e.target.closest?.(".fl-row");
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(row.dataset.flight); }
  }, { signal });

  // Validate a plain editor field when focus leaves it.
  root.addEventListener("focusout", (e) => {
    const inp = e.target;
    if (!inp?.matches?.(".fl-editor input[data-f]:not([type=hidden])")) return;
    const msg = validateStatusValues({ [inp.dataset.f]: inp.value })[inp.dataset.f];
    const span = inp.parentElement?.querySelector("[data-ferr]");
    if (span) { span.textContent = msg ?? ""; span.classList.toggle("show", Boolean(msg)); }
  }, { signal });

  // Live clock in the header (local time of the operator).
  const tick = () => { const c = $("[data-clock]"); if (c) c.textContent = new Date().toLocaleTimeString(undefined, { hour12: false }); };
  const timer = setInterval(() => { if (signal.aborted) clearInterval(timer); else tick(); }, 1000);
  signal.addEventListener("abort", () => clearInterval(timer));

  load().then(tick);
}

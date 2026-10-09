import { esc } from "./esc.js";
import { buildStatusBody, describePushResult, validateStatusValues } from "./ops.js";
import { semanticKind } from "@wpd/pass-builder/field-kinds.js";
import { renderTypedInput } from "./inputs.js";
import { appleWalletButton } from "./wallet-badge.js";
import { toast } from "./toast.js";

// Flights view — the landing screen: a departures board (one row per trip /
// groupId) with a docked control panel for the selected flight. The panel
// pushes a typed, validated status update to every pass on the flight
// (POST /api/groups/:id/status) and lists the passengers, each with its own
// per-pass editor (POST /api/passes/:serial/status), Add-to-Wallet and Delete.

// Status-editor fields. Keys are Apple's semantic keys (the status API
// vocabulary). The common one-field pushes (status, reason, gate) stay
// visible; the schedule and the rarely-touched fields sit behind disclosures.
const STATUS_VOCAB = ["On Time", "Boarding", "Delayed", "Cancelled", "Diverted"];
const QUICK_FIELDS = [
  ["transitStatus", "Status", "", STATUS_VOCAB],
  ["transitStatusReason", "Reason shown on device", "e.g. crew availability"],
  ["departureGate", "Gate", "e.g. B9"]
];
const SCHEDULE_FIELDS = [
  ["currentBoardingDate", "Boarding", ""],
  ["currentDepartureDate", "Departure", ""],
  ["currentArrivalDate", "Arrival", ""]
];
const MORE_FIELDS = [
  ["transitProvider", "Transit info", ""],
  ["securityScreening", "Security", ""],
  ["delayed", "Delay note", ""]
];
const EDITOR_KEYS = [...QUICK_FIELDS, ...SCHEDULE_FIELDS, ...MORE_FIELDS].map(f => f[0]);
// Clearing resets the delay/status banner only; schedule fields are left alone.
const CLEAR_BODY = { delayed: "", transitStatus: "", transitStatusReason: "" };

export const STATUS_SLUG = { "On Time": "ontime", "Boarding": "boarding", "Delayed": "delayed", "Cancelled": "cancelled", "Diverted": "diverted" };
// Trip status = the most severe status across its passes. A pass that has
// never had a status pushed carries `statusSet: false` from the API and shows
// as "Not pushed" rather than a fabricated "On Time".
const STATUS_SEVERITY = ["Cancelled", "Diverted", "Delayed", "Boarding", "On Time"];
const hasStatus = (p) => p.statusSet !== false && Boolean(p.status);
const pillClass = (status) => status ? `st-pill st-pill--${STATUS_SLUG[status] || "other"}` : "st-pill st-pill--draft";
const pillHtml = (status, attr = "") => `<span class="${pillClass(status)}" ${attr}>${esc(status || "Not pushed")}</span>`;
export const tripStatusOf = (members) => {
  const set = new Set(members.filter(hasStatus).map(p => p.status));
  return STATUS_SEVERITY.find(s => set.has(s)) ?? [...set][0] ?? "";
};
function setPillEl(el, status) {
  if (!el) return;
  el.className = `${pillClass(status)} flap`;
  el.textContent = status || "Not pushed";
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
const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Fold the flat GET /api/passes list into board rows, one per groupId.
 * Pure — exported for tests. Flights with a known departure sort first by it;
 * undated ones follow in list order. `current` is the trip-level live value
 * per editor key (first pass that has one), so the trip editor can show what
 * is live instead of a made-up example.
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
    const current = {};
    for (const k of EDITOR_KEYS) current[k] = first(m => m.current?.[k]);
    return {
      gid, members, current,
      flight: first(m => m.route?.flight) ?? gid,
      from: first(m => m.route?.from), to: first(m => m.route?.to),
      toCity: first(m => m.route?.toCity),
      gate: current.departureGate,
      departs: current.currentDepartureDate, boards: current.currentBoardingDate,
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

export function mountFlights(root, { showIssue, selectGroup } = {}) {
  // Re-mounted on every tab visit — drop the previous mount's listener or one
  // click would fire each action once per visit (duplicate pushes/deletes).
  root._mountAbort?.abort();
  const { signal } = (root._mountAbort = new AbortController());

  let flights = [];
  let selected = selectGroup ?? null;   // gid of the flight in the panel (preselected by Issue's "Open flight")
  // Typed (ISO-8601) editor values, keyed by scope ("grp:<gid>" / "pass:<serial>")
  // then field key. Pickers write here; update reads it back. Reset on load().
  let editorValues = {};

  const $ = (s) => root.querySelector(s);
  const setStatus = (serial, msg) => { const el = $(`[data-status="${CSS.escape(serial)}"]`); if (el) el.textContent = msg; };
  const setGrpStatus = (gid, msg) => { const el = $(`[data-grp-status="${CSS.escape(gid)}"]`); if (el) el.textContent = msg; };
  const narrow = () => typeof matchMedia === "function" && matchMedia("(max-width: 1080px)").matches;

  const shell = (body, meta = "") => `
    <div class="view fl-view">
      <div class="view-head">
        <div><h1>Departures</h1><p class="view-sub">${meta}</p></div>
        <div class="fl-head-right">
          <div class="fl-clock-wrap"><span class="fl-clock" data-clock></span><small>${esc(localZone() || "local time")}</small></div>
          ${showIssue ? `<button type="button" class="btn btn-primary" data-act="new-flight">New flight</button>` : ""}
        </div>
      </div>
      ${body}
    </div>`;

  // ---- board ----------------------------------------------------------------
  function boardRow(f) {
    const dest = f.toCity || f.to || "—";
    const sub = [f.to && f.toCity ? f.to : null, f.from ? `from ${f.from}` : null, f.template ? esc(f.template) : null].filter(Boolean).join(" · ");
    const sel = f.gid === selected;
    return `
      <div class="fl-row ${sel ? "is-selected" : ""}" data-flight="${esc(f.gid)}" role="button" tabindex="0" aria-pressed="${sel}" aria-label="${esc(f.flight)} to ${esc(dest)}">
        <div class="fl-flight">${esc(f.flight)}</div>
        <div class="fl-gate ${f.gate ? "" : "is-empty"}">${esc(f.gate || "—")}</div>
        <div class="fl-dest">${esc(dest)}<small>${sub || esc(f.gid)}</small></div>
        <div class="fl-time">${f.departs ? `${esc(fmtTime(f.departs))}<small>${esc(fmtDay(f.departs))}</small>${f.boards ? `<small>boards ${esc(fmtTime(f.boards))}</small>` : ""}` : `<span class="is-empty">—</span>`}</div>
        <div>${pillHtml(f.status, `data-chip-trip="${esc(f.gid)}"`)}</div>
        <div class="fl-count">${f.members.length} <span>· ${f.devices} on device</span><div class="fl-bar" aria-hidden="true"><i style="width:${f.members.length ? Math.round(100 * f.devices / f.members.length) : 0}%"></i></div></div>
      </div>`;
  }
  const boardHtml = () => `
    <div class="card fl-board">
      <div class="fl-head"><div>Flight</div><div>Gate</div><div>Destination</div><div>Departs</div><div>Status</div><div>Passes · on device</div></div>
      ${flights.map(boardRow).join("")}
    </div>`;

  // ---- editors --------------------------------------------------------------
  // One status editor (trip-wide or per-pass). `current` shows what's already
  // live as the placeholder / "now …" hint — never a submittable value, so an
  // untouched field means "don't change this" (buildStatusBody drops empties).
  function fieldHtml([key, label, ph, options], kind, id, current) {
    const cur = current?.[key];
    const idBase = `${kind}-${id}-${key}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    let control;
    if (options) {
      // Status keys: a toggle group writing into a hidden input (same data-f
      // contract as every field). Nothing pressed = no change.
      control = `<div class="fl-keys" role="group" aria-label="${esc(label)}" data-keys="${esc(key)}">${options.map(o =>
        `<button type="button" class="fl-key" data-status-key="${esc(o)}" aria-pressed="false">${esc(o)}</button>`).join("")}</div><input type="hidden" data-f="${esc(key)}" value="" />`;
    } else if (semanticKind(key) === "date") {
      control = `<div class="fl-typed" data-typed-status="${esc(key)}" data-scope="${esc(kind)}" data-scope-id="${esc(id)}" data-label="${esc(label)}"></div>`;
    } else {
      control = `<input id="${idBase}" data-f="${esc(key)}" placeholder="${esc(cur || ph)}" />`;
    }
    const hint = cur ? ` <span class="fl-f-current">now ${esc(semanticKind(key) === "date" ? fmtWhen(cur) : cur)}</span>` : "";
    const labelTag = options || semanticKind(key) === "date" ? "div" : "label";
    const forAttr = labelTag === "label" ? ` for="${idBase}"` : "";
    return `<div class="fl-field fl-field--${esc(key)}"><${labelTag} class="fl-f-label"${forAttr}>${esc(label)}${hint}</${labelTag}>${control}<span class="field-err" data-ferr="${esc(key)}" role="alert"></span></div>`;
  }
  function editorHtml(kind, id, actsHtml, current, extraHtml = "") {
    const quick = QUICK_FIELDS.map(f => fieldHtml(f, kind, id, current)).join("");
    const sched = SCHEDULE_FIELDS.map(f => fieldHtml(f, kind, id, current)).join("");
    const more = MORE_FIELDS.map(f => fieldHtml(f, kind, id, current)).join("");
    const schedNow = SCHEDULE_FIELDS.map(([k, label]) => current?.[k] ? `${label.toLowerCase()} ${fmtTime(current[k])}` : null).filter(Boolean).join(" · ");
    return `<div class="fl-editor" data-scope="${esc(kind)}" data-scope-id="${esc(id)}">${quick}
      <details class="fl-sched"><summary>Change schedule…${schedNow ? ` <span class="fl-f-current">${esc(schedNow)}</span>` : ""}</summary><div class="fl-sched-body">${sched}</div></details>
      <details class="fl-more"><summary>More — transit info, security, delay note</summary><div class="fl-more-body">${more}${extraHtml}</div></details>
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
        label: ph.dataset.label,
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
      `<button type="button" data-act="pass-update" data-serial="${esc(p.serial)}" class="btn btn-primary btn-sm">${p.deviceCount ? `Push to this pass` : "Save for this pass"}</button>` +
      `<button type="button" data-act="pass-clear" data-serial="${esc(p.serial)}" class="btn btn-sm">Clear status</button>`,
      p.current);
    return `
      <div class="fl-pass" data-row="${esc(p.serial)}">
        <div class="fl-pass-main">
          ${pillHtml(hasStatus(p) ? p.status : "", `data-chip-pass="${esc(p.serial)}"`)}
          <b class="fl-pass-name">${esc(p.passenger || "—")}</b>
          <span class="fl-pass-seat">${esc(p.seat || "—")}</span>
          <code class="fl-pass-serial" title="${esc(p.serial)}">${esc(p.serial)}</code>
          <span class="fl-pass-dev ${p.deviceCount ? "is-on" : ""}">${p.deviceCount ? `● ${p.deviceCount} on device` : "○ not added"}</span>
        </div>
        <div class="fl-pass-acts">
          ${appleWalletButton(`/api/passes/${encodeURIComponent(p.serial)}/pkpass`)}
          <button type="button" data-act="del" data-serial="${esc(p.serial)}" class="btn-link danger">Delete pass</button>
        </div>
        <details class="fl-pass-edit">
          <summary>Update just this pass</summary>
          ${editor}
        </details>
        <div class="fl-status" data-status="${esc(p.serial)}" role="status" aria-live="polite"></div>
      </div>`;
  }

  function panelHtml(f) {
    if (!f) return `<aside class="card fl-panel fl-panel--empty"><p class="empty">Select a flight to update it.</p></aside>`;
    const pushLabel = f.devices ? `Push to ${plural(f.devices, "device")}` : "Save update · no devices yet";
    const editor = editorHtml("grp", f.gid,
      `<button type="button" data-act="grp-update" data-grp="${esc(f.gid)}" class="btn btn-primary" title="${f.devices ? "Updates every pass on this flight and notifies the phones that added one" : "No phone has added a pass from this flight yet; the update is stored and ships when one does"}">${pushLabel}</button>` +
      `<button type="button" data-act="grp-clear" data-grp="${esc(f.gid)}" class="btn">Clear status</button>` +
      `<span class="fl-grp-status" data-grp-status="${esc(f.gid)}" role="status" aria-live="polite"></span>`,
      f.current,
      `<div class="fl-danger"><button type="button" data-act="grp-del" data-grp="${esc(f.gid)}" class="btn-link danger">Delete flight and its ${plural(f.members.length, "pass", "passes")}</button></div>`);
    const route = f.from || f.to ? `${esc(f.from || "?")} → ${esc(f.to || "?")}` : esc(f.gid);
    return `
      <aside class="card fl-panel" data-panel="${esc(f.gid)}" aria-label="Update ${esc(f.flight)}">
        <div class="fl-panel-head">
          <h2>${esc(f.flight)} <span class="fl-route">${route}</span></h2>
          <p class="fl-panel-sub">${f.departs ? `${esc(fmtDay(f.departs))} · dep ${esc(fmtTime(f.departs))}` : "no departure time"} · ${plural(f.members.length, "pass", "passes")} · ${f.devices} on device${f.lastModified ? ` · updated ${esc(ago(f.lastModified))}` : ""}</p>
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

  function select(gid, { scroll = false } = {}) {
    selected = gid;
    for (const row of root.querySelectorAll(".fl-row")) {
      const on = row.dataset.flight === gid;
      row.classList.toggle("is-selected", on);
      row.setAttribute("aria-pressed", String(on));
    }
    renderPanel();
    // On a stacked (narrow) layout the panel sits below the board: bring it up.
    if (scroll && narrow()) $(".fl-panel-host")?.scrollIntoView?.({ block: "start", behavior: "smooth" });
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
      `${plural(flights.length, "flight")} · ${plural(passes, "pass", "passes")} · ${devices} on device${devices === 1 ? "" : "s"}`
    );
    renderPanel();
  }

  // ---- pushes ---------------------------------------------------------------
  // The push button narrates its own state (Pushing… → ✓ Pushed) so the
  // highest-stakes click in the product doesn't end in silence.
  async function withButtonState(btn, work) {
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.classList.add("is-busy"); btn.innerHTML = "Pushing…"; }
    let j;
    try { j = await work(); }
    finally {
      if (btn && !signal.aborted) {
        if (j?.ok) {
          btn.classList.remove("is-busy"); btn.classList.add("is-done");
          const sent = j.results ? j.results.reduce((n, r) => n + (r.push?.sent ?? 0), 0) : (j.push?.sent ?? 0);
          btn.innerHTML = sent ? `✓ Pushed to ${plural(sent, "device")}` : "✓ Saved";
          setTimeout(() => { if (!signal.aborted && btn.isConnected) { btn.innerHTML = orig; btn.classList.remove("is-done"); btn.disabled = false; } }, 2200);
        } else { btn.innerHTML = orig; btn.classList.remove("is-busy"); btn.disabled = false; }
      }
    }
    return j;
  }
  async function pushOne(serial, body, btn) {
    setStatus(serial, "Pushing…");
    const j = await withButtonState(btn, () => fetch(`/api/passes/${encodeURIComponent(serial)}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal
    }).then(r => r.json()).catch(() => ({})));
    if (signal.aborted) return {};
    setStatus(serial, describePushResult(j));
    if (j?.ok) toast(describePushResult(j));
    return j;
  }
  async function pushGroup(gid, body, btn) {
    setGrpStatus(gid, "Pushing…");
    const j = await withButtonState(btn, () => fetch(`/api/groups/${encodeURIComponent(gid)}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal
    }).then(r => r.json()).catch(() => ({})));
    if (signal.aborted) return {};
    setGrpStatus(gid, describePushResult(j));
    if (j?.ok) toast(describePushResult(j));
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
    for (const m of f.members) { m.status = status; m.statusSet = true; setPillEl(passPill(m.serial), status); }
    recomputeTripPill(gid);
  }
  function setPassStatus(gid, serial, status) {
    const f = flights.find(x => x.gid === gid);
    const m = f?.members.find(x => x.serial === serial);
    if (m) { m.status = status; m.statusSet = true; }
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
  async function runUpdate(container, { kind, id, setMsg, btn }) {
    const values = collectEditorValues(container, scopeKey(kind, id));
    const errs = validateStatusValues(values);
    showEditorErrors(container, errs);
    if (Object.keys(errs).length) { setMsg(`✗ fix ${plural(Object.keys(errs).length, "invalid field")} before pushing`); return { ok: false }; }
    const body = buildStatusBody(values);
    if (!body) { setMsg("✗ nothing to update — change at least one field"); return { ok: false }; }
    const j = kind === "grp" ? await pushGroup(id, body, btn) : await pushOne(id, body, btn);
    return { ok: !!j?.ok, body };
  }

  // ---- events ---------------------------------------------------------------
  root.addEventListener("click", async (e) => {
    const key = e.target.closest("[data-status-key]");
    if (key) {
      const grp = key.closest("[data-keys]");
      const hidden = grp?.parentElement?.querySelector('input[data-f="transitStatus"]');
      const wasOn = key.getAttribute("aria-pressed") === "true";
      for (const b of grp.querySelectorAll("[data-status-key]")) {
        const on = b === key && !wasOn;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", String(on));
      }
      if (hidden) hidden.value = wasOn ? "" : key.dataset.statusKey;   // pressing the active key un-sets it
      return;
    }
    const row = e.target.closest(".fl-row");
    if (row) { select(row.dataset.flight, { scroll: true }); return; }

    const t = e.target.closest("[data-act]");
    if (!t) return;
    const act = t.dataset.act, serial = t.dataset.serial, grp = t.dataset.grp;
    const flightOf = (s) => flights.find(f => f.members.some(m => m.serial === s));
    const gidOf = (s) => flightOf(s)?.gid;

    if (act === "new-flight" || act === "add-pax") { showIssue?.(); return; }
    if (act === "del") {
      const f = flightOf(serial), m = f?.members.find(x => x.serial === serial);
      if (!confirm(`Delete the pass for ${m?.passenger || serial} on ${f?.flight || "this flight"}?${m?.deviceCount ? `\n\nIt is on ${plural(m.deviceCount, "phone")}; those copies stop updating.` : ""}`)) return;
      setStatus(serial, "Deleting…");
      try {
        const r = await fetch(`/api/passes/${encodeURIComponent(serial)}`, { method: "DELETE", signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        toast(`Deleted ${m?.passenger || serial}`);
        load();
      } catch (err) { if (signal.aborted) return; setStatus(serial, `✗ delete failed — ${err.message}`); }
      return;
    }
    if (act === "grp-update") {
      const { ok, body } = await runUpdate(t.closest(".fl-editor"), { kind: "grp", id: grp, setMsg: (m) => setGrpStatus(grp, m), btn: t });
      if (ok && body?.transitStatus) setGroupStatus(grp, body.transitStatus);
      return;
    }
    if (act === "pass-update") {
      const { ok, body } = await runUpdate(t.closest(".fl-editor"), { kind: "pass", id: serial, setMsg: (m) => setStatus(serial, m), btn: t });
      if (ok && body?.transitStatus) setPassStatus(gidOf(serial), serial, body.transitStatus);
      return;
    }
    if (act === "grp-clear") {
      const f = flights.find(x => x.gid === grp);
      if (!confirm(`Clear the delay/status on ${f ? plural(f.members.length, "pass", "passes") : "this flight"} and push?`)) return;
      const j = await pushGroup(grp, { ...CLEAR_BODY }, t);
      if (j?.ok) setGroupStatus(grp, "On Time");
      return;
    }
    if (act === "pass-clear") {
      if (!confirm("Clear the delay/status on this pass and push?")) return;
      const j = await pushOne(serial, { ...CLEAR_BODY }, t);
      if (j?.ok) setPassStatus(gidOf(serial), serial, "On Time");
      return;
    }
    if (act === "grp-del") {
      const f = flights.find(x => x.gid === grp);
      const name = f ? `${f.flight}${f.to ? ` → ${f.to}` : ""}` : grp;
      if (!confirm(`Delete ${name}?\n\n${f ? `${plural(f.members.length, "pass", "passes")}, ${f.devices} on devices.` : ""} Installed copies stop updating and can't be restored.`)) return;
      setGrpStatus(grp, "Deleting…");
      try {
        const r = await fetch(`/api/groups/${encodeURIComponent(grp)}`, { method: "DELETE", signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        toast(`Deleted ${name}`);
        load();
      } catch (err) { if (signal.aborted) return; setGrpStatus(grp, `✗ delete failed — ${err.message}`); }
      return;
    }
  }, { signal });

  root.addEventListener("keydown", (e) => {
    const row = e.target.closest?.(".fl-row");
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(row.dataset.flight, { scroll: true }); }
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

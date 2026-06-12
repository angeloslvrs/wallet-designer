import { replaceState } from "./state.js";
import { renderForm } from "./form.js";
import { esc } from "./esc.js";
import { buildStatusBody, describePushResult } from "./ops.js";

// Manage view — the ops console: every issued pass grouped by trip, with
// Add-to-Wallet, per-pass quick actions, a full status editor per trip
// (gate/boarding/depart/arrive/transit/screening/delay → group push), and the
// device log reported through the public POST /v1/log.

// [bodyKey, placeholder, selectOptions?] — entries with options render as a
// <select> whose empty first option means "no change" (buildStatusBody drops it).
// Body keys are Apple's semantic keys (the status API vocabulary); the old
// verbs (gate, boarding, …) remain accepted server-side as aliases.
const STATUS_FIELDS = [
  ["departureGate", "Gate (B7)"],
  ["currentBoardingDate", "Boarding (2026-06-20T07:30:00-07:00)"],
  ["currentDepartureDate", "Depart (ISO time)"],
  ["currentArrivalDate", "Arrive (ISO time)"],
  ["transitProvider", "Transit info"],
  ["securityScreening", "Security screening"],
  ["delayed", "Delay note"],
  ["transitStatus", "Status", ["", "On Time", "Delayed", "Cancelled", "Diverted"]],
  ["transitStatusReason", "Status reason (crew availability)"]
];

const fmtWhen = (s) => {
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function mountManage(root, showDesigner) {
  // Re-mounted on every tab visit — drop the previous mount's listener or one
  // click would fire each action once per visit (duplicate prompts/deletes).
  root._mountAbort?.abort();
  const { signal } = (root._mountAbort = new AbortController());

  const setStatus = (serial, msg) => {
    const el = root.querySelector(`[data-status="${CSS.escape(serial)}"]`);
    if (el) el.textContent = msg;
  };

  const shell = (inner) => `<div class="mg-wrap"><div class="mg-head"><h2>Manage issued passes</h2>${inner.count != null ? `<span class="mg-count">${inner.count} pass(es)</span>` : ""}</div>${inner.body}</div>`;

  const logCard = () => `
    <div class="mg-card">
      <div class="mg-card-head">
        <div class="mg-trip"><span class="mg-trip-id">Device log</span><span class="mg-badge">POST /v1/log</span></div>
        <div class="mg-grp-acts"><button data-act="log-refresh">Refresh</button></div>
      </div>
      <div class="mg-list" id="mg-log"><p class="mg-empty">Loading…</p></div>
    </div>`;

  async function loadLog() {
    const el = root.querySelector("#mg-log");
    if (!el) return;
    let log = [];
    try { log = await fetch("/api/log?limit=50").then(r => r.json()); }
    catch { el.innerHTML = `<p class="mg-empty">API offline.</p>`; return; }
    if (!Array.isArray(log) || !log.length) {
      el.innerHTML = `<p class="mg-empty">No device logs yet — they arrive when an iPhone hits a problem with a pass.</p>`;
      return;
    }
    el.innerHTML = log.map(e => `
      <div class="mg-row mg-log-row">
        <code>${esc(fmtWhen(e.at))}</code>
        <span class="mg-log-msg">${(e.entries ?? []).map(line => esc(String(line))).join("<br>")}</span>
      </div>`).join("");
  }

  async function load() {
    root.innerHTML = shell({ body: `<p class="mg-empty">Loading…</p>` });
    let list;
    try { list = await fetch("/api/passes").then(r => r.json()); }
    catch { root.innerHTML = shell({ body: `<p class="mg-empty">API offline.</p>` }); return; }

    if (!Array.isArray(list) || !list.length) {
      root.innerHTML = shell({ body: `<p class="mg-empty">Nothing issued yet — build or issue passes in the Designer.</p>` + logCard() });
      loadLog();
      return;
    }

    const groups = {};
    // Passes issued before trip grouping existed have no groupId — label them
    // honestly (their group-level actions will 404 until re-issued).
    for (const p of list) (groups[p.groupId ?? "(legacy — no trip id)"] ??= []).push(p);

    const cards = Object.entries(groups).map(([gid, members]) => {
      const rows = members.map(p => `
        <div class="mg-row">
          <div class="mg-info">
            <b>${esc(p.passenger || "—")}</b> · seat ${esc(p.seat || "—")} · <code>${esc(p.serial)}</code>
            ${p.template ? `<span class="mg-badge mg-tpl">tpl: ${esc(p.template)}</span>` : ""}
            · ${p.deviceCount} device(s) · <span class="mg-when">${esc(fmtWhen(p.lastModified))}</span>
          </div>
          <div class="mg-acts">
            <a class="btn wallet" href="/api/passes/${encodeURIComponent(p.serial)}/pkpass">Add to Wallet</a>
            ${p.template ? "" : `<button data-act="edit" data-serial="${esc(p.serial)}">Edit</button>`}
            <button data-act="gate" data-serial="${esc(p.serial)}">Gate</button>
            <button data-act="delay" data-serial="${esc(p.serial)}">Delay</button>
            <button data-act="status" data-serial="${esc(p.serial)}">Status</button>
            <button data-act="del" data-serial="${esc(p.serial)}" class="danger">Delete</button>
          </div>
          <div class="mg-status" data-status="${esc(p.serial)}"></div>
        </div>`).join("");

      const editor = STATUS_FIELDS.map(([key, ph, options]) =>
        options
          ? `<select data-f="${key}" title="${esc(ph)}">${options.map(o =>
              `<option value="${esc(o)}">${esc(o || `${ph}: (no change)`)}</option>`).join("")}</select>`
          : `<input data-f="${key}" placeholder="${esc(ph)}" />`).join("");

      return `
        <div class="mg-card" data-card="${esc(gid)}">
          <div class="mg-card-head">
            <div class="mg-trip"><span class="mg-trip-id">${esc(gid)}</span><span class="mg-badge">${members.length} pass(es)</span></div>
            <div class="mg-grp-acts">
              <button data-act="grp-del" data-grp="${esc(gid)}" class="danger">Delete trip</button>
            </div>
          </div>
          <div class="mg-editor">
            ${editor}
            <div class="mg-editor-acts">
              <button data-act="grp-update" data-grp="${esc(gid)}">Update trip · push</button>
              <button data-act="grp-clear" data-grp="${esc(gid)}">Clear delay/status</button>
              <span class="mg-grp-status" data-grp-status="${esc(gid)}"></span>
            </div>
          </div>
          <div class="mg-list">${rows}</div>
        </div>`;
    }).join("");

    root.innerHTML = shell({ count: list.length, body: cards + logCard() });
    loadLog();
  }

  async function pushOne(serial, body) {
    setStatus(serial, "Pushing…");
    const j = await fetch(`/api/passes/${encodeURIComponent(serial)}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(r => r.json()).catch(() => ({}));
    setStatus(serial, describePushResult(j));
  }

  async function pushGroup(gid, body) {
    const el = root.querySelector(`[data-grp-status="${CSS.escape(gid)}"]`);
    if (el) el.textContent = "Pushing…";
    const j = await fetch(`/api/groups/${encodeURIComponent(gid)}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(r => r.json()).catch(() => ({}));
    if (el) el.textContent = describePushResult(j);
  }

  root.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    const { act, serial, grp } = t.dataset;

    if (act === "edit") {
      const rec = await fetch(`/api/passes/${encodeURIComponent(serial)}`).then(r => r.json());
      if (rec?.state) { replaceState(rec.state); renderForm(document.getElementById("form-pane")); showDesigner(); }
      return;
    }
    if (act === "gate")  { const g = prompt(`New gate for ${serial}:`); if (g != null) await pushOne(serial, { departureGate: g }); return; }
    if (act === "delay") { const d = prompt(`Delay note for ${serial}:`, "ATC delay — new boarding 06:30"); if (d != null) await pushOne(serial, { delayed: d }); return; }
    if (act === "status") {
      const s = prompt(`Status for ${serial} (On Time / Delayed / Cancelled — empty clears):`, "Delayed");
      if (s == null) return;
      const why = prompt("Reason (shown as the push banner, e.g. crew availability):", "");
      await pushOne(serial, { transitStatus: s, transitStatusReason: why ?? "" });
      return;
    }
    if (act === "del")   { if (confirm(`Delete pass ${serial}?`)) { await fetch(`/api/passes/${encodeURIComponent(serial)}`, { method: "DELETE" }); load(); } return; }

    if (act === "grp-update") {
      const card = t.closest(".mg-card");
      const values = {};
      for (const inp of card.querySelectorAll(".mg-editor [data-f]")) values[inp.dataset.f] = inp.value;
      const body = buildStatusBody(values);
      const el = root.querySelector(`[data-grp-status="${CSS.escape(grp)}"]`);
      if (!body) { if (el) el.textContent = "✗ nothing to update — fill in at least one field"; return; }
      await pushGroup(grp, body);
      return;
    }
    if (act === "grp-clear") { await pushGroup(grp, { delayed: "", transitStatus: "", transitStatusReason: "" }); return; }
    if (act === "grp-del")   { if (confirm(`Delete ALL passes in trip ${grp}?`)) { await fetch(`/api/groups/${encodeURIComponent(grp)}`, { method: "DELETE" }); load(); } return; }
    if (act === "log-refresh") { loadLog(); return; }
  }, { signal });

  load();
}

import { replaceState } from "./state.js";
import { renderForm } from "./form.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Manage view: list every issued pass (grouped by trip) with Add-to-Wallet,
// push (gate / delay), edit (load back into the designer), and delete — for
// single passes and whole groups.
export function mountManage(root, showDesigner) {
  const setStatus = (serial, msg) => {
    const el = root.querySelector(`[data-status="${CSS.escape(serial)}"]`);
    if (el) el.textContent = msg;
  };

  const shell = (inner) => `<div class="mg-wrap"><div class="mg-head"><h2>Manage issued passes</h2>${inner.count != null ? `<span class="mg-count">${inner.count} pass(es)</span>` : ""}</div>${inner.body}</div>`;

  async function load() {
    root.innerHTML = shell({ body: `<p class="mg-empty">Loading…</p>` });
    let list;
    try { list = await fetch("/api/passes").then(r => r.json()); }
    catch { root.innerHTML = shell({ body: `<p class="mg-empty">API offline.</p>` }); return; }

    if (!Array.isArray(list) || !list.length) {
      root.innerHTML = shell({ body: `<p class="mg-empty">Nothing issued yet — build or issue passes in the Designer.</p>` });
      return;
    }

    const groups = {};
    for (const p of list) (groups[p.groupId] ??= []).push(p);

    const cards = Object.entries(groups).map(([gid, members]) => {
      const rows = members.map(p => `
        <div class="mg-row">
          <div class="mg-info"><b>${esc(p.passenger || "—")}</b> · seat ${esc(p.seat || "—")} · <code>${esc(p.serial)}</code> · ${p.deviceCount} device(s)</div>
          <div class="mg-acts">
            <a class="btn wallet" href="/api/passes/${encodeURIComponent(p.serial)}/pkpass">Add to Wallet</a>
            <button data-act="edit" data-serial="${esc(p.serial)}">Edit</button>
            <button data-act="gate" data-serial="${esc(p.serial)}">Gate</button>
            <button data-act="delay" data-serial="${esc(p.serial)}">Delay</button>
            <button data-act="del" data-serial="${esc(p.serial)}" class="danger">Delete</button>
          </div>
          <div class="mg-status" data-status="${esc(p.serial)}"></div>
        </div>`).join("");
      return `
        <div class="mg-card">
          <div class="mg-card-head">
            <div class="mg-trip"><span class="mg-trip-id">${esc(gid)}</span><span class="mg-badge">${members.length} pass(es)</span></div>
            <div class="mg-grp-acts">
              <button data-act="grp-gate" data-grp="${esc(gid)}">Gate · all</button>
              <button data-act="grp-delay" data-grp="${esc(gid)}">Delay · all</button>
              <button data-act="grp-clear" data-grp="${esc(gid)}">Clear · all</button>
              <button data-act="grp-del" data-grp="${esc(gid)}" class="danger">Delete trip</button>
              <span class="mg-grp-status" data-grp-status="${esc(gid)}"></span>
            </div>
          </div>
          <div class="mg-list">${rows}</div>
        </div>`;
    }).join("");

    root.innerHTML = shell({ count: list.length, body: cards });
  }

  async function pushOne(serial, body) {
    setStatus(serial, "Pushing…");
    const j = await fetch(`/api/passes/${encodeURIComponent(serial)}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(r => r.json()).catch(() => ({}));
    setStatus(serial, j.ok ? `✓ pushed ${j.push?.sent ?? 0} device(s)` : `✗ ${j.error ?? "error"}`);
  }

  async function pushGroup(gid, body) {
    const el = root.querySelector(`[data-grp-status="${CSS.escape(gid)}"]`);
    if (el) el.textContent = "Pushing…";
    const j = await fetch(`/api/groups/${encodeURIComponent(gid)}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(r => r.json()).catch(() => ({}));
    if (el) el.textContent = j.ok ? `✓ ${j.count} pass(es), ${j.sent} device(s)` : `✗ ${j.error ?? "error"}`;
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
    if (act === "gate")  { const g = prompt(`New gate for ${serial}:`); if (g != null) await pushOne(serial, { gate: g }); return; }
    if (act === "delay") { const d = prompt(`Delay note for ${serial}:`, "ATC delay — new boarding 06:30"); if (d != null) await pushOne(serial, { delayed: d }); return; }
    if (act === "del")   { if (confirm(`Delete pass ${serial}?`)) { await fetch(`/api/passes/${encodeURIComponent(serial)}`, { method: "DELETE" }); load(); } return; }

    if (act === "grp-gate")  { const g = prompt(`New gate for whole trip ${grp}:`); if (g != null) await pushGroup(grp, { gate: g }); return; }
    if (act === "grp-delay") { const d = prompt(`Delay note for whole trip ${grp}:`, "ATC delay — new boarding 06:30"); if (d != null) await pushGroup(grp, { delayed: d }); return; }
    if (act === "grp-clear") { await pushGroup(grp, { delayed: "" }); return; }
    if (act === "grp-del")   { if (confirm(`Delete ALL passes in trip ${grp}?`)) { await fetch(`/api/groups/${encodeURIComponent(grp)}`, { method: "DELETE" }); load(); } return; }
  });

  load();
}

import bwipjs from "bwip-js";
import { esc } from "./esc.js";

// Issue view — issue template-backed passes from the browser: pick an
// installed .pkpasstemplate, name the trip (groupId), fill one row per
// passenger (inputs generated from the template's field keys), then one
// POST /api/passes per row with per-row success/error inline.

const SERIAL_PAD = 3;

/**
 * Compose the trip groupId the server requires for template passes,
 * e.g. ("RP247", "2026-06-20") → "RP247@2026-06-20".
 * @returns {string} empty when either piece is missing
 */
export function composeGroupId(flight, date) {
  const f = (flight ?? "").trim().toUpperCase();
  const d = (date ?? "").trim();
  return f && d ? `${f}@${d}` : "";
}

/**
 * Suggested serial for passenger row n (1-based): <groupId>-<NNN>.
 * Serials are caller-supplied in the template flow; this is only a default.
 * @returns {string} empty when there is no groupId yet
 */
export function suggestSerial(groupId, n) {
  const g = (groupId ?? "").trim();
  return g ? `${g}-${String(n).padStart(SERIAL_PAD, "0")}` : "";
}

/**
 * Map one passenger row to the POST /api/passes template body.
 * Values are plain strings at issue time (the {value, changeMessage} object
 * form is for updates); empty inputs are left out so template defaults apply.
 */
export function buildIssueRequest({ template, groupId, serial, values }) {
  const data = {};
  for (const [key, raw] of Object.entries(values ?? {})) {
    const v = (raw ?? "").trim();
    if (v) data[key] = v;
  }
  return { template, serialNumber: (serial ?? "").trim(), groupId: (groupId ?? "").trim(), data };
}

/**
 * One-line per-row summary of an issue response. Errors (e.g. unknown field
 * keys from the dry-run merge) are surfaced verbatim.
 * @returns {string} plain text — esc() before any innerHTML use
 */
export function describeIssueResult(ok, j) {
  return ok ? "✓ issued" : `✗ ${j?.error ?? "error"}`;
}

export function mountIssue(root, showManage) {
  // Re-mounted on every tab visit — drop the previous mount's listeners or
  // one click would fire issueAll() once per visit (duplicate POSTs).
  root._mountAbort?.abort();
  const { signal } = (root._mountAbort = new AbortController());

  let templates = [];        // [{ id, fieldKeys, assets, error? }]
  let selected = null;       // template id
  let groupId = "";
  let rows = [{ values: {}, serial: "", serialEdited: false }];

  const $ = (sel) => root.querySelector(sel);
  const current = () => templates.find(t => t.id === selected);

  function reSuggestSerials() {
    rows = rows.map((r, i) => r.serialEdited ? r : { ...r, serial: suggestSerial(groupId, i + 1) });
  }

  function syncFromInputs() {
    groupId = $("#iss-group")?.value ?? groupId;
    rows = rows.map((r, i) => {
      const rowEl = root.querySelector(`.iss-row[data-i="${i}"]`);
      if (!rowEl) return r;
      const values = {};
      for (const inp of rowEl.querySelectorAll("input[data-key]")) values[inp.dataset.key] = inp.value;
      return { ...r, values, serial: rowEl.querySelector("input[data-serial]")?.value ?? r.serial };
    });
  }

  function rowHtml(r, i) {
    const fields = (current()?.fieldKeys ?? []).map(k =>
      `<input data-key="${esc(k)}" placeholder="${esc(k)}" value="${esc(r.values[k] ?? "")}" />`).join("");
    return `
      <div class="iss-row mg-row" data-i="${i}">
        <div class="iss-fields">
          ${fields}
          <input data-serial placeholder="serial" value="${esc(r.serial)}" class="iss-serial" title="Serial number (caller-supplied; suggested from the trip id)" />
          <button data-act="rm" data-i="${i}" ${rows.length === 1 ? "disabled" : ""} title="remove">✕</button>
        </div>
        <div class="mg-status" data-row-status="${i}"></div>
      </div>`;
  }

  function render() {
    const tpl = current();
    const options = templates.map(t =>
      `<option value="${esc(t.id)}" ${t.id === selected ? "selected" : ""} ${t.error ? "disabled" : ""}>` +
      `${esc(t.id)}${t.error ? " (broken)" : ""}</option>`).join("");

    root.innerHTML = `
      <div class="mg-wrap">
        <div class="mg-head"><h2>Issue passes from a template</h2></div>
        <div class="mg-card">
          <div class="live-row">
            <label>Template</label>
            <select id="iss-tpl" style="flex:1">${options}</select>
          </div>
          ${tpl?.error ? `<p class="hint">✗ ${esc(tpl.error)}</p>` : `
          <p class="hint">Fields: ${(tpl?.fieldKeys ?? []).map(k => `<code>${esc(k)}</code>`).join(" ")}
             · ${tpl?.assets?.length ?? 0} asset(s)</p>`}
          <div class="live-row">
            <label>Trip id</label>
            <input id="iss-group" placeholder='RP247@2026-06-20 (required)' value="${esc(groupId)}" style="flex:1" />
          </div>
          <div class="live-row iss-compose">
            <label class="hint">or compose:</label>
            <input id="iss-flight" placeholder="RP247" />
            <input id="iss-date" type="date" />
            <button data-act="compose">→ Trip id</button>
          </div>
        </div>
        <div class="mg-card">
          <div class="mg-card-head">
            <div class="mg-trip"><span class="mg-trip-id">Passengers</span><span class="mg-badge">${rows.length} row(s)</span></div>
            <div class="mg-grp-acts"><button data-act="add">+ Add passenger</button></div>
          </div>
          <div class="mg-list">${rows.map(rowHtml).join("")}</div>
          <div class="mg-editor-acts">
            <button data-act="issue">Issue ${rows.length} pass(es)</button>
            <span class="mg-grp-status" id="iss-status"></span>
          </div>
        </div>
      </div>`;
  }

  function renderEmpty() {
    root.innerHTML = `
      <div class="mg-wrap">
        <div class="mg-head"><h2>Issue passes from a template</h2></div>
        <p class="mg-empty">No templates installed yet — drop a <code>.pkpasstemplate</code> bundle into
        <code>templates/</code> or upload one (see <code>templates/README.md</code>), then reload.</p>
      </div>`;
  }

  function setRowStatus(i, html) {
    const el = root.querySelector(`[data-row-status="${i}"]`);
    if (el) el.innerHTML = html;
  }

  function walletAffordance(serial) {
    const url = `${location.origin}/api/passes/${encodeURIComponent(serial)}/pkpass`;
    return `✓ issued · <a class="btn wallet" href="${esc(url)}">Add to Wallet</a> <canvas class="iss-qr" data-qr="${esc(url)}" title="Scan with the iPhone"></canvas>`;
  }

  function drawQrCodes() {
    for (const c of root.querySelectorAll("canvas[data-qr]")) {
      try { bwipjs.toCanvas(c, { bcid: "qrcode", text: c.dataset.qr, scale: 2 }); } catch { /* ignore */ }
      c.removeAttribute("data-qr");
    }
  }

  async function issueAll() {
    syncFromInputs();
    const status = $("#iss-status");
    if (!groupId.trim()) { status.textContent = "✗ trip id is required for template passes"; return; }
    status.textContent = "Issuing…";
    let okCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const body = buildIssueRequest({ template: selected, groupId, serial: rows[i].serial, values: rows[i].values });
      if (!body.serialNumber) { setRowStatus(i, "✗ serial is required"); continue; }
      let r, j;
      try {
        r = await fetch("/api/passes", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        j = await r.json().catch(() => ({}));
      } catch { setRowStatus(i, "✗ API offline"); continue; }
      if (r.ok) { okCount++; setRowStatus(i, walletAffordance(j.serialNumber)); }
      else setRowStatus(i, esc(describeIssueResult(false, j)));
    }
    drawQrCodes();
    status.innerHTML = okCount
      ? `✓ issued ${okCount}/${rows.length} for <b>${esc(groupId)}</b> · <button data-act="manage">Manage trip →</button>`
      : "✗ nothing issued — fix the rows above";
  }

  async function load() {
    root.innerHTML = `<div class="mg-wrap"><p class="mg-empty">Loading templates…</p></div>`;
    try { templates = await fetch("/api/templates").then(r => r.json()); }
    catch { root.innerHTML = `<div class="mg-wrap"><p class="mg-empty">API offline.</p></div>`; return; }
    if (!Array.isArray(templates) || !templates.length) { renderEmpty(); return; }
    selected ??= (templates.find(t => !t.error) ?? templates[0]).id;
    reSuggestSerials();
    render();
  }

  root.addEventListener("click", (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    if (act === "compose") {
      const gid = composeGroupId($("#iss-flight").value, $("#iss-date").value);
      if (!gid) return;
      syncFromInputs();
      groupId = gid;
      // Composing names a new trip — re-derive every serial, including
      // manually edited ones (they belonged to the old trip id).
      rows = rows.map(r => ({ ...r, serialEdited: false }));
      reSuggestSerials();
      render();
      return;
    }
    if (act === "add") { syncFromInputs(); rows = [...rows, { values: {}, serial: suggestSerial(groupId, rows.length + 1), serialEdited: false }]; render(); return; }
    if (act === "rm")  { syncFromInputs(); rows = rows.filter((_, i) => i !== Number(e.target.dataset.i)); reSuggestSerials(); render(); return; }
    if (act === "issue") return issueAll();
    if (act === "manage") return showManage?.();
  }, { signal });

  root.addEventListener("input", (e) => {
    if (e.target.id === "iss-group") {
      groupId = e.target.value;
      syncFromInputs();
      reSuggestSerials();
      for (const rowEl of root.querySelectorAll(".iss-row")) {
        const i = Number(rowEl.dataset.i);
        const inp = rowEl.querySelector("input[data-serial]");
        if (inp && !rows[i].serialEdited) inp.value = rows[i].serial;
      }
    }
    if (e.target.matches("input[data-serial]")) {
      const i = Number(e.target.closest(".iss-row").dataset.i);
      rows = rows.map((r, n) => n === i ? { ...r, serialEdited: true } : r);
    }
  }, { signal });

  root.addEventListener("change", (e) => {
    if (e.target.id === "iss-tpl") { syncFromInputs(); selected = e.target.value; render(); }
  }, { signal });

  load();
}

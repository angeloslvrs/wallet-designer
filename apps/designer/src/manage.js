import { replaceState } from "./state.js";
import { renderForm } from "./form.js";
import { esc } from "./esc.js";
import { buildStatusBody, describePushResult, validateStatusValues } from "./ops.js";
import { semanticKind } from "@wpd/pass-builder/field-kinds.js";
import { renderTypedInput } from "./inputs.js";

// Manage view — the ops console: every issued pass grouped by trip, with
// Add-to-Wallet, a typed+validated status editor at the trip level (push to
// every pass on the flight) AND per pass (push to one), and the device log
// reported through the public POST /v1/log.

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
// Clearing only resets the delay/status banner; schedule fields are left alone.
const CLEAR_BODY = { delayed: "", transitStatus: "", transitStatusReason: "" };

const fmtWhen = (s) => {
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

// Editor instances are scoped: "grp:<tripId>" for the trip-wide editor and
// "pass:<serial>" for a single pass. The scope key namespaces editorValues so
// the trip and per-pass date pickers (same field keys) never collide.
const scopeKey = (kind, id) => `${kind}:${id}`;

export function mountManage(root, showDesigner) {
  // Re-mounted on every tab visit — drop the previous mount's listener or one
  // click would fire each action once per visit (duplicate pushes/deletes).
  root._mountAbort?.abort();
  const { signal } = (root._mountAbort = new AbortController());

  // Typed (ISO-8601 date) status-editor values, keyed by scope then field key.
  // Date fields are the picker component (not plain [data-f] inputs), so the
  // picker writes its formatted value here; update reads it back. Reset on every
  // load() so a refresh starts the editors empty (like the plain fields).
  let editorValues = {};

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

  // One status editor (trip-wide or per-pass), parameterized by scope + its
  // action buttons. Date fields render the typed picker (mounted post-render);
  // everything else is a plain input or a select.
  function statusEditorHtml(kind, id, actsHtml) {
    const fields = STATUS_FIELDS.map(([key, ph, options]) => {
      let control;
      if (options) {
        control = `<select data-f="${esc(key)}" title="${esc(ph)}">${options.map(o =>
          `<option value="${esc(o)}">${esc(o || `${ph}: (no change)`)}</option>`).join("")}</select>`;
      } else if (semanticKind(key) === "date") {
        // ISO-8601 schedule field → datetime-local + offset picker, mounted
        // post-render so a malformed date can't be typed.
        control = `<div class="mg-typed" data-typed-status="${esc(key)}" data-scope="${esc(kind)}" data-scope-id="${esc(id)}" title="${esc(ph)}"></div>`;
      } else {
        control = `<input data-f="${esc(key)}" placeholder="${esc(ph)}" title="${esc(ph)}" />`;
      }
      return `<span class="mg-field">${control}<span class="field-err" data-ferr="${esc(key)}"></span></span>`;
    }).join("");
    return `<div class="mg-editor" data-scope="${esc(kind)}" data-scope-id="${esc(id)}">${fields}<div class="mg-editor-acts">${actsHtml}</div></div>`;
  }

  // Mount the typed ISO-8601 pickers into their placeholders after innerHTML is
  // set. The picker reports a correctly-formed value straight into editorValues
  // (keyed by the editor's scope) and validates it inline.
  function mountStatusDateFields() {
    for (const ph of root.querySelectorAll("[data-typed-status]")) {
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

  function passRow(p) {
    const passEditor = statusEditorHtml("pass", p.serial,
      `<button data-act="pass-update" data-serial="${esc(p.serial)}">Update · push</button>` +
      `<button data-act="pass-clear" data-serial="${esc(p.serial)}">Clear delay/status</button>`);
    return `
      <div class="mg-row" data-row="${esc(p.serial)}">
        <div class="mg-info">
          <b>${esc(p.passenger || "—")}</b> · seat ${esc(p.seat || "—")} · <code>${esc(p.serial)}</code>
          ${p.template ? `<span class="mg-badge mg-tpl">tpl: ${esc(p.template)}</span>` : ""}
          · ${p.deviceCount} device(s) · <span class="mg-when">${esc(fmtWhen(p.lastModified))}</span>
        </div>
        <div class="mg-acts">
          <a class="btn wallet" href="/api/passes/${encodeURIComponent(p.serial)}/pkpass">Add to Wallet</a>
          ${p.template ? "" : `<button data-act="edit" data-serial="${esc(p.serial)}">Edit</button>`}
          <button data-act="del" data-serial="${esc(p.serial)}" class="danger">Delete</button>
        </div>
        <details class="mg-pass-edit">
          <summary>Update this pass — gate, delay, status…</summary>
          ${passEditor}
        </details>
        <div class="mg-status" data-status="${esc(p.serial)}"></div>
      </div>`;
  }

  async function load() {
    editorValues = {};   // fresh editors on every (re)load
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
      const rows = members.map(passRow).join("");
      const tripEditor = statusEditorHtml("grp", gid,
        `<button data-act="grp-update" data-grp="${esc(gid)}">Update trip · push</button>` +
        `<button data-act="grp-clear" data-grp="${esc(gid)}">Clear delay/status</button>` +
        `<span class="mg-grp-status" data-grp-status="${esc(gid)}"></span>`);
      return `
        <div class="mg-card" data-card="${esc(gid)}">
          <div class="mg-card-head">
            <div class="mg-trip"><span class="mg-trip-id">${esc(gid)}</span><span class="mg-badge">${members.length} pass(es)</span></div>
            <div class="mg-grp-acts">
              <button data-act="grp-del" data-grp="${esc(gid)}" class="danger">Delete trip</button>
            </div>
          </div>
          <div class="mg-editor-label">Update the whole trip</div>
          ${tripEditor}
          <div class="mg-list">${rows}</div>
        </div>`;
    }).join("");

    root.innerHTML = shell({ count: list.length, body: cards + logCard() });
    mountStatusDateFields();
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

  // Read a single editor instance's values: plain inputs/selects from the DOM,
  // typed date fields from editorValues (the pickers write straight there).
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

  // Validate one editor, then push (to the whole trip or to one pass). Same
  // guardrails everywhere: a date/gate edit must be well-formed before it pushes.
  async function runUpdate(container, { kind, id, setMsg }) {
    const values = collectEditorValues(container, scopeKey(kind, id));
    const errs = validateStatusValues(values);
    showEditorErrors(container, errs);
    if (Object.keys(errs).length) { setMsg(`✗ fix ${Object.keys(errs).length} invalid field(s) before pushing`); return; }
    const body = buildStatusBody(values);
    if (!body) { setMsg("✗ nothing to update — fill in at least one field"); return; }
    if (kind === "grp") await pushGroup(id, body); else await pushOne(id, body);
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
    if (act === "del") { if (confirm(`Delete pass ${serial}?`)) { await fetch(`/api/passes/${encodeURIComponent(serial)}`, { method: "DELETE" }); load(); } return; }

    if (act === "grp-update") {
      const grpStatus = root.querySelector(`[data-grp-status="${CSS.escape(grp)}"]`);
      await runUpdate(t.closest(".mg-editor"), { kind: "grp", id: grp, setMsg: (m) => { if (grpStatus) grpStatus.textContent = m; } });
      return;
    }
    if (act === "pass-update") {
      await runUpdate(t.closest(".mg-editor"), { kind: "pass", id: serial, setMsg: (m) => setStatus(serial, m) });
      return;
    }
    if (act === "grp-clear")  { await pushGroup(grp, { ...CLEAR_BODY }); return; }
    if (act === "pass-clear") { await pushOne(serial, { ...CLEAR_BODY }); return; }
    if (act === "grp-del")    { if (confirm(`Delete ALL passes in trip ${grp}?`)) { await fetch(`/api/groups/${encodeURIComponent(grp)}`, { method: "DELETE" }); load(); } return; }
    if (act === "log-refresh") { loadLog(); return; }
  }, { signal });

  // Validate a plain status-editor field when focus leaves it (same kinds as issue).
  root.addEventListener("focusout", (e) => {
    const inp = e.target;
    if (!inp?.matches?.(".mg-editor [data-f]")) return;
    const msg = validateStatusValues({ [inp.dataset.f]: inp.value })[inp.dataset.f];
    const span = inp.parentElement?.querySelector("[data-ferr]");
    if (span) { span.textContent = msg ?? ""; span.classList.toggle("show", Boolean(msg)); }
  }, { signal });

  load();
}

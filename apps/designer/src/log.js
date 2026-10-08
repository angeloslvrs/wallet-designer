import { esc } from "./esc.js";

// Device log view — everything iPhones report through the public POST /v1/log
// (read back via GET /api/log), newest first.

const fmtWhen = (s) => {
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

export function mountLog(root) {
  root._mountAbort?.abort();
  const { signal } = (root._mountAbort = new AbortController());

  const shell = (body) => `
    <div class="view">
      <div class="view-head">
        <div><h1>Device log</h1><p class="view-sub">What iPhones report back through the PassKit web service. Newest first.</p></div>
        <button type="button" class="btn" data-act="refresh">Refresh</button>
      </div>
      ${body}
    </div>`;

  async function load() {
    if (signal.aborted) return;
    root.innerHTML = shell(`<p class="empty">Loading…</p>`);
    let log;
    try { log = await fetch("/api/log?limit=100", { signal }).then(r => r.json()); }
    catch { if (signal.aborted) return; root.innerHTML = shell(`<p class="empty">API offline.</p>`); return; }
    if (signal.aborted) return;
    if (!Array.isArray(log) || !log.length) {
      root.innerHTML = shell(`<div class="empty"><p>No device logs yet.</p><p class="hint">They arrive when an iPhone hits a problem with a pass. Pushes and fetches that succeed are silent.</p></div>`);
      return;
    }
    root.innerHTML = shell(`
      <div class="card log-table">
        <div class="log-row log-head"><span>Time</span><span>Entries</span></div>
        ${log.map(e => `
          <div class="log-row">
            <code>${esc(fmtWhen(e.at))}</code>
            <span class="log-msg">${(e.entries ?? []).map(line => esc(String(line))).join("<br>")}</span>
          </div>`).join("")}
      </div>`);
  }

  root.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="refresh"]')) load();
  }, { signal });

  load();
}

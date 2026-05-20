import { state } from "./state.js";

/**
 * "Live Activity" controls — after a pass has been issued (POST /api/passes),
 * these mutate its server-side copy and fire APNs pushes to registered devices.
 */
export function mountLiveControls(root) {
  root.innerHTML = `
    <fieldset>
      <legend>Live Activity Controls</legend>
      <p class="hint">Updates the issued pass on the server and pushes to registered devices via APNs (or logs the push in dev mode).</p>
      <div class="live-row">
        <button data-action="issue">Issue / re-issue this pass</button>
      </div>
      <div class="live-row">
        <label>New gate</label>
        <input id="live-gate" placeholder="B7" />
        <button data-action="gate">Change gate</button>
      </div>
      <div class="live-row">
        <label>Delay reason</label>
        <input id="live-delay" placeholder="ATC delay — new boarding 06:30" />
        <button data-action="delay">Mark delayed</button>
      </div>
      <div class="live-row">
        <button data-action="boarding">Boarding now</button>
        <button data-action="clear">Clear delay</button>
      </div>
      <div id="live-status"></div>
    </fieldset>
  `;
  const status = root.querySelector("#live-status");
  const serial = () => state.meta.serialNumber;
  const set = msg => { status.textContent = msg; };

  root.addEventListener("click", async e => {
    const action = e.target?.dataset?.action;
    if (!action) return;

    if (action === "issue") {
      const r = await fetch("/api/passes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      });
      if (!r.ok) return set(`✗ ${await r.text()}`);
      const j = await r.json();
      set(`✓ issued ${j.serialNumber} (token ${j.authenticationToken.slice(0, 8)}…)`);
      return;
    }

    let body = {};
    if (action === "gate")     body = { gate: root.querySelector("#live-gate").value };
    if (action === "delay")    body = { delayed: root.querySelector("#live-delay").value };
    if (action === "boarding") body = { transitInfo: "Boarding now — proceed to the gate" };
    if (action === "clear")    body = { delayed: "" };

    const r = await fetch(`/api/passes/${encodeURIComponent(serial())}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) return set(`✗ ${(await r.json()).error}`);
    const j = await r.json();
    set(`✓ ${action} → push: ${j.push.sent} device(s) (${j.push.mode})`);
  });
}

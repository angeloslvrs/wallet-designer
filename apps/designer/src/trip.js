import { state } from "./state.js";

// Trip panel: build one pass per passenger on the shared flight, then push
// status updates (gate / delay / boarding) to the whole group at once.

const esc = (s) => String(s ?? "").replace(/"/g, "&quot;");

function seedPassengers() {
  const p = state.passenger ?? {};
  const s = p.seats?.[0] ?? {};
  return [{
    name: p.name ?? "", seat: s.number ?? "", cabin: s.cabin ?? "economy",
    group: p.boardingGroup ?? "", seq: p.seqNumber ?? "", ff: p.frequentFlyerNumber ?? ""
  }];
}

function buildPassState(p, i) {
  const base = structuredClone(state);
  const f = base.flight;
  const seatId = (p.seat || String(i + 1)).replace(/\s+/g, "");
  return {
    ...base,
    meta: { ...base.meta, serialNumber: `${f.airlineCode}${f.flightNumber}-${seatId}` },
    passenger: {
      name: p.name,
      ...(p.ff ? { frequentFlyerNumber: p.ff } : {}),
      seats: [{ number: p.seat, cabin: p.cabin || "economy" }],
      boardingGroup: p.group,
      seqNumber: p.seq
    },
    barcode: {
      ...base.barcode,
      message: `${f.airlineCode}${f.flightNumber}${f.departure.iata}${f.arrival.iata}${p.seat}${p.seq}`,
      altText: `${f.airlineCode}${f.flightNumber} ${p.seat}`
    }
  };
}

export function mountTrip(root) {
  let pax = seedPassengers();
  let groups = [];        // [{ groupId, count }]
  let selectedGroup = null;

  const $ = (sel) => root.querySelector(sel);

  function paxRows() {
    return pax.map((p, i) => `
      <div class="pax-row" data-i="${i}">
        <input data-k="name"  placeholder="Name"  value="${esc(p.name)}" style="flex:2" />
        <input data-k="seat"  placeholder="Seat"  value="${esc(p.seat)}" style="flex:1" />
        <input data-k="group" placeholder="Grp"   value="${esc(p.group)}" style="width:46px" />
        <input data-k="seq"   placeholder="Seq"    value="${esc(p.seq)}" style="width:54px" />
        <button data-act="rm" ${pax.length === 1 ? "disabled" : ""} title="remove">✕</button>
      </div>`).join("");
  }

  function groupOptions() {
    if (!groups.length) return `<option value="">— no trips issued yet —</option>`;
    return groups.map(g =>
      `<option value="${esc(g.groupId)}" ${g.groupId === selectedGroup ? "selected" : ""}>${esc(g.groupId)} (${g.count})</option>`
    ).join("");
  }

  function render() {
    root.innerHTML = `
      <fieldset>
        <legend>Trip — passengers on this flight</legend>
        <p class="hint">One pass per passenger, sharing the flight/branding above. Serial = FLIGHT-SEAT.</p>
        <div id="pax-list">${paxRows()}</div>
        <div class="live-row" style="margin-top:6px">
          <button data-act="add">+ Add passenger</button>
          <button data-act="issue" style="flex:1">Issue whole trip</button>
        </div>
        <div id="trip-status"></div>
      </fieldset>
      <fieldset>
        <legend>Flight updates (whole trip)</legend>
        <p class="hint">Updates every passenger's pass on the selected trip and pushes all devices.</p>
        <div class="live-row"><label>Trip</label><select id="group-pick" style="flex:1">${groupOptions()}</select></div>
        <div class="live-row"><label>New gate</label><input id="g-gate" placeholder="B7" /><button data-act="g-gate">Change gate</button></div>
        <div class="live-row"><label>Delay</label><input id="g-delay" placeholder="ATC delay — new boarding 06:30" /><button data-act="g-delay">Mark delayed</button></div>
        <div class="live-row"><button data-act="g-boarding">Boarding now</button><button data-act="g-clear">Clear delay</button></div>
        <div id="group-status"></div>
      </fieldset>`;
  }

  function syncPaxFromInputs() {
    for (const row of root.querySelectorAll(".pax-row")) {
      const i = Number(row.dataset.i);
      for (const inp of row.querySelectorAll("input")) pax[i][inp.dataset.k] = inp.value;
    }
  }

  async function refreshGroups(select) {
    try {
      const list = await fetch("/api/passes").then(r => r.json());
      const by = {};
      for (const p of list) by[p.groupId] = (by[p.groupId] ?? 0) + 1;
      groups = Object.entries(by).map(([groupId, count]) => ({ groupId, count }));
      if (select) selectedGroup = select;
      else if (!selectedGroup && groups[0]) selectedGroup = groups[0].groupId;
      const pick = $("#group-pick");
      if (pick) pick.innerHTML = groupOptions();
    } catch { /* API offline — leave as is */ }
  }

  async function issueTrip() {
    syncPaxFromInputs();
    const status = $("#trip-status");
    status.textContent = "Issuing…";
    let lastGroup = null;
    const issued = [];
    for (let i = 0; i < pax.length; i++) {
      if (!pax[i].name) continue;
      const r = await fetch("/api/passes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPassState(pax[i], i))
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { issued.push({ serial: j.serialNumber, name: pax[i].name }); lastGroup = j.groupId; }
      else { status.textContent = `✗ ${j.error ?? r.status}`; return; }
    }
    const links = issued.map(p =>
      `<a href="/api/passes/${encodeURIComponent(p.serial)}/pkpass" download>${esc(p.name)} (${esc(p.serial)})</a>`
    ).join("<br>");
    status.innerHTML = `✓ issued ${issued.length} pass(es) for trip <b>${esc(lastGroup)}</b>.<br>Download &amp; AirDrop to each phone:<br>${links}`;
    await refreshGroups(lastGroup);
  }

  async function groupAction(body) {
    const gid = $("#group-pick").value;
    const status = $("#group-status");
    if (!gid) { status.textContent = "✗ no trip selected — issue one first"; return; }
    status.textContent = "Pushing…";
    const r = await fetch(`/api/groups/${encodeURIComponent(gid)}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { status.textContent = `✗ ${j.error ?? r.status}`; return; }
    status.textContent = `✓ updated ${j.count} pass(es) → pushed ${j.sent} device(s)`;
  }

  render();
  refreshGroups();

  root.addEventListener("click", async (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    if (act === "add") { syncPaxFromInputs(); pax.push({ name: "", seat: "", cabin: "economy", group: pax[0]?.group ?? "", seq: "", ff: "" }); render(); return; }
    if (act === "rm") { syncPaxFromInputs(); pax.splice(Number(e.target.closest(".pax-row").dataset.i), 1); render(); return; }
    if (act === "issue") return issueTrip();
    if (act === "g-gate")     return groupAction({ gate: $("#g-gate").value });
    if (act === "g-delay")    return groupAction({ delayed: $("#g-delay").value });
    if (act === "g-boarding") return groupAction({ transitInfo: "Boarding now — proceed to the gate" });
    if (act === "g-clear")    return groupAction({ delayed: "" });
  });

  root.addEventListener("change", (e) => {
    if (e.target.id === "group-pick") selectedGroup = e.target.value;
  });
}

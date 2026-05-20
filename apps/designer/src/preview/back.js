export function renderBack(root, s) {
  const dep = s.flight.departure, arr = s.flight.arrival;
  const rows = [
    ["Passenger", s.passenger.name],
    ["Frequent Flyer", s.passenger.frequentFlyerNumber ?? "—"],
    ["Boarding Group", s.passenger.boardingGroup],
    ["Sequence", s.passenger.seqNumber],
    ["Departure Terminal", dep.terminal ?? "—"],
    ["Departure Gate", dep.gate ?? "—"],
    ["Arrival Terminal", arr.terminal ?? "—"],
    ["Aircraft", "—"],
    ["Confirmation", s.barcode.message]
  ];

  const card = document.createElement("div");
  card.style.cssText = `
    width: 340px; min-height: 540px; padding: 18px;
    background: ${s.branding.backgroundColor};
    color: ${s.branding.foregroundColor};
    border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.18);
    font-family: -apple-system, system-ui, sans-serif; font-size: 12px;
  `;
  card.innerHTML = `<div style="font-size:13px;font-weight:600;margin-bottom:12px">Details</div>` +
    rows.map(([k, v]) => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.12)">
        <span style="color:${s.branding.labelColor}">${esc(k)}</span>
        <span style="font-weight:600">${esc(v)}</span>
      </div>`).join("");
  root.appendChild(card);
}

const esc = (x) => String(x ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));

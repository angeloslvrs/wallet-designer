export function renderFront(root, s) {
  const dep = s.flight.departure, arr = s.flight.arrival;
  const card = document.createElement("div");
  card.style.cssText = `
    width: 340px; min-height: 540px; padding: 18px;
    background: ${s.branding.backgroundColor};
    color: ${s.branding.foregroundColor};
    border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.18);
    font-family: -apple-system, system-ui, sans-serif;
  `;
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:${s.branding.labelColor}">
      <span>${esc(s.branding.logoText)}</span>
      <span>GATE ${esc(dep.gate ?? "—")} · SEAT ${esc(s.passenger.seats[0]?.number ?? "—")}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:end;margin-top:18px">
      <div>
        <div style="font-size:10px;color:${s.branding.labelColor}">${esc(dep.city)}</div>
        <div style="font-size:42px;font-weight:700;letter-spacing:2px">${esc(dep.iata)}</div>
      </div>
      <div style="font-size:22px;opacity:.6">→</div>
      <div style="text-align:right">
        <div style="font-size:10px;color:${s.branding.labelColor}">${esc(arr.city)}</div>
        <div style="font-size:42px;font-weight:700;letter-spacing:2px">${esc(arr.iata)}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:18px;font-size:11px">
      ${fld("PASSENGER", s.passenger.name, s)}
      ${fld("FLIGHT", `${s.flight.airlineCode}${s.flight.flightNumber}`, s)}
      ${fld("BOARDING", short(dep.boarding), s)}
      ${fld("DEPART", short(dep.depart), s)}
      ${fld("GROUP", s.passenger.boardingGroup, s)}
      ${fld("SEQ", s.passenger.seqNumber, s)}
    </div>
    <div style="margin-top:24px;display:flex;justify-content:center">
      <div style="background:white;color:black;padding:10px 14px;border-radius:6px;font-family:monospace;font-size:10px;text-align:center;letter-spacing:1px;min-width:200px">
        ▩▩ QR ▩▩<br/>${esc(s.barcode.altText)}
      </div>
    </div>
  `;
  root.appendChild(card);
}

const fld = (label, v, s) => `<div>
  <div style="color:${s.branding.labelColor};font-size:9px;letter-spacing:1px">${esc(label)}</div>
  <div style="font-size:13px;font-weight:600">${esc(v ?? "—")}</div>
</div>`;

const short = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }); } catch { return "—"; } };
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));

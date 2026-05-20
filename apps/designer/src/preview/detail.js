export function renderDetail(root, s) {
  const dep = s.flight.departure, arr = s.flight.arrival;
  const card = document.createElement("div");
  card.style.cssText = `
    width: 360px; min-height: 540px; padding: 16px;
    background: white; color: #1a1a1a; border-radius: 18px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.12);
    font-family: -apple-system, system-ui, sans-serif;
    display: flex; flex-direction: column; gap: 12px;
  `;

  const section = (title, html) => `
    <div style="background:#f4f4f7;border-radius:12px;padding:12px">
      <div style="font-size:11px;letter-spacing:1px;color:#888;text-transform:uppercase;margin-bottom:6px">${esc(title)}</div>
      <div style="font-size:14px">${html}</div>
    </div>`;

  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:32px;height:32px;border-radius:8px;background:${s.branding.backgroundColor};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px">${esc(s.flight.airlineCode)}</div>
      <div>
        <div style="font-size:13px;font-weight:600">${esc(s.flight.airlineCode)}${esc(s.flight.flightNumber)}</div>
        <div style="font-size:11px;color:#888">${esc(s.branding.logoText)}</div>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:end">
      <div>
        <div style="font-size:28px;font-weight:700">${esc(dep.iata)}</div>
        <div style="font-size:11px;color:#888">${esc(dep.city)}</div>
        <div style="font-size:11px">${short(dep.depart)}</div>
      </div>
      <div style="color:#aaa">→</div>
      <div style="text-align:right">
        <div style="font-size:28px;font-weight:700">${esc(arr.iata)}</div>
        <div style="font-size:11px;color:#888">${esc(arr.city)}</div>
        <div style="font-size:11px">${short(arr.arrive)}</div>
      </div>
    </div>

    ${section("Boarding", `
      <div style="display:flex;justify-content:space-between">
        <span>Group ${esc(s.passenger.boardingGroup)}</span>
        <span style="font-weight:600">${short(dep.boarding)}</span>
      </div>
      <div style="margin-top:4px;color:#888">Terminal ${esc(dep.terminal ?? "—")} · Gate ${esc(dep.gate ?? "—")}</div>
    `)}

    ${section("Seats", s.passenger.seats.map(seat =>
      `<div style="display:flex;justify-content:space-between"><span>${esc(seat.number)}</span><span style="color:#888">${esc(seat.cabin)}</span></div>`
    ).join(""))}

    ${s.iOS26?.duration ? section("Flight Duration", `${Math.floor(s.iOS26.duration/3600)}h ${Math.floor((s.iOS26.duration%3600)/60)}m`) : ""}
    ${s.iOS26?.securityScreening ? section("Security Screening", esc(s.iOS26.securityScreening)) : ""}
    ${s.iOS26?.transitInfo ? section("Transit", esc(s.iOS26.transitInfo)) : ""}
    ${s.iOS26?.wifi?.length ? section("Wifi", s.iOS26.wifi.map(w =>
      `<div><strong>${esc(w.ssid)}</strong>${w.password ? ` · <code>${esc(w.password)}</code>` : ""}</div>`
    ).join("")) : ""}
  `;
  root.appendChild(card);
}

const short = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }); } catch { return "—"; } };
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));

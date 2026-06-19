// Shared "we read this from your boarding pass — apply it?" modal. Pure DOM:
// returns a Promise<boolean> (Confirm → true, Cancel → false). Both the
// Designer and Issue flows use it before writing parsed BCBP into the form.

import { esc } from "./esc.js";

const fmtName = (n) => n ? [n.givenName, n.familyName].filter(Boolean).join(" ") : "";
const fmtSeats = (s) => (s ?? []).map(x => `${x.seatRow ?? ""}${x.seatNumber ?? ""}`).join(", ");

export function showBcbpPreview(parsed) {
  return new Promise((resolve) => {
    const rows = [
      ["Passenger", fmtName(parsed.passengerName)],
      ["Route", [parsed.departureAirportCode, parsed.destinationAirportCode].filter(Boolean).join(" → ")],
      ["Flight", parsed.flightCode ?? ""],
      ["Seat", fmtSeats(parsed.seats)],
      ["Booking ref", parsed.confirmationNumber ?? ""],
      ["Sequence", parsed.boardingSequenceNumber ?? ""],
      ["Flight date", parsed.flightDate ? `${parsed.flightDate} (no time in barcode — set departure time manually)` : ""]
    ].filter(([, v]) => v);

    const overlay = document.createElement("div");
    overlay.className = "bcbp-preview";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
    const card = document.createElement("div");
    card.style.cssText = "background:#fff;color:#111;border-radius:12px;max-width:420px;width:100%;padding:18px;font:14px system-ui";
    card.innerHTML =
      `<div style="font-weight:700;margin-bottom:10px">Detected from boarding pass</div>` +
      rows.map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px solid #eee"><span style="color:#666">${k}</span><span style="font-weight:600;text-align:right">${esc(v)}</span></div>`).join("") +
      `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
         <button data-bcbp-cancel style="background:#eee;border:none;padding:9px 16px;border-radius:8px;cursor:pointer">Cancel</button>
         <button data-bcbp-confirm style="background:#1a2150;color:#fff;border:none;padding:9px 16px;border-radius:8px;cursor:pointer;font-weight:600">Confirm &amp; fill</button>
       </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const finish = (ok) => { overlay.remove(); resolve(ok); };
    card.querySelector("[data-bcbp-confirm]").addEventListener("click", () => finish(true));
    card.querySelector("[data-bcbp-cancel]").addEventListener("click", () => finish(false));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(false); });
  });
}

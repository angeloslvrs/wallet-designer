import { state } from "./state.js";
import { esc } from "./esc.js";
import { appleWalletButton } from "./wallet-badge.js";

// "Build .pkpass": issue (store) the pass, then show a QR to scan with the
// iPhone plus Apple's official Add to Apple Wallet badge. Opening the .pkpass
// URL on iOS Safari triggers the Add-to-Wallet sheet; on desktop it downloads.
export function wireBuildButton(btn, statusEl) {
  btn.addEventListener("click", async () => {
    statusEl.textContent = "Issuing…";
    btn.disabled = true;
    try {
      const r = await fetch("/api/passes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        statusEl.textContent = `✗ ${j.error ?? r.statusText}${j.details ? ` (${JSON.stringify(j.details)})` : ""}`;
        return;
      }
      const serial = j.serialNumber;
      const url = `${location.origin}/api/passes/${encodeURIComponent(serial)}/pkpass`;

      statusEl.textContent = "";
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;gap:14px;align-items:center;margin-top:8px;text-align:left";

      const qr = document.createElement("canvas");
      // bwip-js is lazily imported (its own chunk) only when a pass is actually
      // issued — the "Build .pkpass" click — never at first paint.
      try { const { default: bwipjs } = await import("bwip-js"); bwipjs.toCanvas(qr, { bcid: "qrcode", text: url, scale: 3 }); } catch { /* ignore */ }
      qr.className = "iss-qr";
      qr.style.cssText = "width:120px;height:120px";

      const right = document.createElement("div");
      // Apple's official badge (never recreated/restyled — see wallet-badge.js).
      right.innerHTML = appleWalletButton(url) +
        `<div class="hint" style="margin-top:8px;line-height:1.5">On your iPhone: <b>scan the QR</b> (or tap the badge if you're on the phone) → Add to Wallet.<br>Serial <code>${esc(serial)}</code></div>`;

      wrap.appendChild(qr);
      wrap.appendChild(right);
      statusEl.appendChild(wrap);
    } catch (e) {
      statusEl.textContent = `✗ ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });
}

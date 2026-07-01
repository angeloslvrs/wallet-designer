import { state } from "./state.js";
import { esc } from "./esc.js";

// "Add to Wallet": issue (store) the pass, then show a QR to scan with the
// iPhone plus a tappable link. Opening the .pkpass URL on iOS Safari triggers
// the Add-to-Wallet sheet; on desktop it downloads the file.
export function wireBuildButton(btn, statusEl) {
  btn.textContent = "Add to Wallet";
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
      wrap.style.cssText = "display:flex;gap:14px;align-items:center;margin-top:8px";

      const qr = document.createElement("canvas");
      // bwip-js is lazily imported (its own chunk) only when a pass is actually
      // issued — the "Add to Wallet" click — never at first paint.
      try { const { default: bwipjs } = await import("bwip-js"); bwipjs.toCanvas(qr, { bcid: "qrcode", text: url, scale: 3 }); } catch { /* ignore */ }
      qr.style.cssText = "width:120px;height:120px;border:1px solid #eee;border-radius:8px";

      const right = document.createElement("div");
      const link = document.createElement("a");
      link.href = url;
      link.textContent = " Add to Wallet";
      link.style.cssText = "display:inline-block;background:#000;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-weight:700";
      const hint = document.createElement("div");
      hint.style.cssText = "font-size:12px;color:#666;margin-top:8px;line-height:1.4";
      hint.innerHTML = `On your iPhone: <b>scan the QR</b> (or tap the button if you're on the phone) → Add to Wallet.<br>Serial <code>${esc(serial)}</code>`;
      right.appendChild(link);
      right.appendChild(hint);

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

import { BrowserMultiFormatReader } from "@zxing/browser";

// Decode a barcode (QR / PDF417 / Aztec / Code128 …) from the device camera or
// an uploaded photo. Resolves with the decoded text, or null if cancelled.
// Camera needs a secure origin (https or localhost); photo upload works anywhere.
export function scanBarcode() {
  return new Promise((resolve) => {
    const reader = new BrowserMultiFormatReader();
    let controls = null;
    let done = false;

    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;" +
      "flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px";
    overlay.innerHTML = `
      <div style="color:#fff;font:14px system-ui;text-align:center">Point the camera at the barcode, or upload a photo of it</div>
      <video playsinline style="width:min(92vw,520px);max-height:60vh;border-radius:12px;background:#000"></video>
      <div style="display:flex;gap:10px">
        <label style="background:#fff;color:#111;padding:9px 16px;border-radius:8px;cursor:pointer;font:600 13px system-ui">
          Upload photo<input type="file" accept="image/*" style="display:none">
        </label>
        <button id="scan-cancel" style="background:#444;color:#fff;border:none;padding:9px 16px;border-radius:8px;cursor:pointer;font:600 13px system-ui">Cancel</button>
      </div>
      <div id="scan-msg" style="color:#ffd2d2;font:12px system-ui;min-height:15px;text-align:center"></div>`;
    document.body.appendChild(overlay);

    const video = overlay.querySelector("video");
    const fileInput = overlay.querySelector("input[type=file]");
    const msg = overlay.querySelector("#scan-msg");

    const finish = (text) => {
      if (done) return;
      done = true;
      try { controls && controls.stop(); } catch { /* ignore */ }
      overlay.remove();
      resolve(text ?? null);
    };

    overlay.querySelector("#scan-cancel").addEventListener("click", () => finish(null));

    // Camera (best-effort; fails silently to upload on insecure origins)
    reader.decodeFromVideoDevice(undefined, video, (result, _err, ctl) => {
      controls = ctl;
      if (result) finish(result.getText());
    }).catch((e) => { msg.textContent = "Camera unavailable — use Upload photo. " + (e?.message ?? ""); });

    // Photo upload
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      msg.textContent = "Decoding…";
      const url = URL.createObjectURL(file);
      try {
        const result = await reader.decodeFromImageUrl(url);
        finish(result.getText());
      } catch {
        msg.textContent = "No barcode found in that image — try a sharper, closer photo.";
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  });
}

// @zxing/browser is the heaviest dependency in the app and is only needed the
// moment a user actually decodes a barcode (camera or photo). It's lazily
// imported inside scanBarcode so it lands in its own chunk and never loads on
// first paint — a paste-only scan never even touches it.
let readerPromise = null;
function getReader() {
  readerPromise ??= import("@zxing/browser").then(m => new m.BrowserMultiFormatReader());
  return readerPromise;
}

// Get a barcode's text by paste (primary), photo upload, or camera (on demand).
// Resolves with the text, or null if cancelled. Camera needs a secure origin.
export function scanBarcode() {
  return new Promise((resolve) => {
    let controls = null, done = false;

    const overlay = document.createElement("div");
    overlay.className = "scan-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px";
    overlay.innerHTML = `
      <div style="color:#fff;font:14px system-ui;text-align:center;max-width:520px">Paste the barcode text below, or upload a photo / use the camera.</div>
      <textarea id="scan-paste" placeholder="Paste boarding-pass barcode text here" style="width:min(92vw,520px);height:84px;border-radius:8px;padding:8px;font:12px monospace"></textarea>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
        <button id="scan-use-paste" style="background:#1a2150;color:#fff;border:none;padding:9px 16px;border-radius:8px;cursor:pointer;font:600 13px system-ui">Use pasted text</button>
        <label style="background:#fff;color:#111;padding:9px 16px;border-radius:8px;cursor:pointer;font:600 13px system-ui">Upload photo<input type="file" accept="image/*" style="display:none"></label>
        <button id="scan-use-cam" style="background:#444;color:#fff;border:none;padding:9px 16px;border-radius:8px;cursor:pointer;font:600 13px system-ui">Use camera</button>
        <button id="scan-cancel" style="background:#444;color:#fff;border:none;padding:9px 16px;border-radius:8px;cursor:pointer;font:600 13px system-ui">Cancel</button>
      </div>
      <video playsinline style="display:none;width:min(92vw,520px);max-height:46vh;border-radius:12px;background:#000"></video>
      <div id="scan-msg" style="color:#ffd2d2;font:12px system-ui;min-height:15px;text-align:center"></div>`;
    document.body.appendChild(overlay);

    const $ = (sel) => overlay.querySelector(sel);
    const video = $("video"), fileInput = $("input[type=file]"), msg = $("#scan-msg");

    const finish = (text) => {
      if (done) return;
      done = true;
      try { controls && controls.stop(); } catch { /* ignore */ }
      overlay.remove();
      resolve(text ?? null);
    };

    $("#scan-cancel").addEventListener("click", () => finish(null));
    $("#scan-use-paste").addEventListener("click", () => {
      const v = $("#scan-paste").value.trim();
      if (v) finish(v); else msg.textContent = "Paste the barcode text first, or use a photo / camera.";
    });

    $("#scan-use-cam").addEventListener("click", async () => {
      video.style.display = "block";
      msg.textContent = "Starting camera…";
      try {
        const reader = await getReader();
        await reader.decodeFromVideoDevice(undefined, video, (result, _err, ctl) => {
          controls = ctl;
          if (result) finish(result.getText());
        });
        msg.textContent = "";
      } catch (e) {
        msg.textContent = "Camera unavailable — paste the text or upload a photo. " + (e?.message ?? "");
      }
    });

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      msg.textContent = "Decoding…";
      const url = URL.createObjectURL(file);
      try {
        const reader = await getReader();
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

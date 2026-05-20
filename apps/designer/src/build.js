import { state } from "./state.js";

export function wireBuildButton(btn, statusEl) {
  btn.addEventListener("click", async () => {
    statusEl.textContent = "Building…";
    btn.disabled = true;
    try {
      const r = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        statusEl.textContent = `✗ ${err.error}${err.details ? ` (${JSON.stringify(err.details)})` : ""}`;
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${state.meta.serialNumber || "pass"}.pkpass`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      statusEl.textContent = `✓ Downloaded ${a.download} (${blob.size} bytes)`;
    } catch (e) {
      statusEl.textContent = `✗ ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });
}

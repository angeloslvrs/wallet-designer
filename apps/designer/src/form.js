import { setPath, getPath } from "./state.js";
import { scanBarcode } from "./scan.js";

const rgbToHex = (s) => {
  const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(s || "");
  if (!m) return "#000000";
  return "#" + [1, 2, 3].map(i => Number(m[i]).toString(16).padStart(2, "0")).join("");
};
const hexToRgb = (h) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || "");
  return m ? `rgb(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)})` : "rgb(0,0,0)";
};

// ISO-8601 <-> datetime-local. The form stores airport-local times as full ISO-8601
// strings (e.g. 2026-06-01T07:30:00-07:00). <input type=datetime-local> only edits the
// wall-clock part, so the UTC offset is edited in a field beside it and preserved —
// dropping it would corrupt Apple's date semantics. A blank offset emits a naive time.
const splitIso = (v) => {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(v || "");
  return m ? { local: m[1], offset: m[2] || "" } : { local: "", offset: "" };
};
const joinIso = (local, offset) => (local ? `${local}:00${offset || ""}` : "");

const sections = [
  ["Meta", [
    { path: "meta.passTypeId", label: "Pass Type ID", type: "text" },
    { path: "meta.teamId", label: "Team ID", type: "text" },
    { path: "meta.organizationName", label: "Organization", type: "text" },
    { path: "meta.serialNumber", label: "Serial Number", type: "text" },
    { path: "meta.description", label: "Description", type: "text" }
  ]],
  ["Branding", [
    { path: "branding.logoText", label: "Logo Text", type: "text" },
    { path: "branding.foregroundColor", label: "Foreground", type: "color" },
    { path: "branding.backgroundColor", label: "Background", type: "color" },
    { path: "branding.labelColor", label: "Label", type: "color" }
  ]],
  ["Assets", [
    { path: "branding.logoDataUrl", label: "Logo image (PNG/SVG)", type: "file" }
  ]],
  ["Flight", [
    { path: "flight.airlineCode", label: "Airline Code (IATA)", type: "text" },
    { path: "flight.flightNumber", label: "Flight Number", type: "text" }
  ]],
  ["Departure", [
    { path: "flight.departure.iata", label: "IATA", type: "text" },
    { path: "flight.departure.name", label: "Airport Name", type: "text" },
    { path: "flight.departure.city", label: "City", type: "text" },
    { path: "flight.departure.terminal", label: "Terminal", type: "text" },
    { path: "flight.departure.gate", label: "Gate", type: "text" },
    { path: "flight.departure.boarding", label: "Boarding", type: "datetime" },
    { path: "flight.departure.depart", label: "Departure", type: "datetime" }
  ]],
  ["Arrival", [
    { path: "flight.arrival.iata", label: "IATA", type: "text" },
    { path: "flight.arrival.name", label: "Airport Name", type: "text" },
    { path: "flight.arrival.city", label: "City", type: "text" },
    { path: "flight.arrival.terminal", label: "Terminal", type: "text" },
    { path: "flight.arrival.arrive", label: "Arrival", type: "datetime" }
  ]],
  ["Passenger", [
    { path: "passenger.name", label: "Name", type: "text" },
    { path: "passenger.boardingGroup", label: "Boarding Group", type: "text" },
    { path: "passenger.boardingZone", label: "Boarding Zone", type: "text" },
    { path: "passenger.seqNumber", label: "Sequence", type: "text" },
    { path: "passenger.confirmationNumber", label: "Confirmation #", type: "text" },
    { path: "passenger.ticketFareClass", label: "Fare Class", type: "text" },
    { path: "passenger.priorityStatus", label: "Priority Status", type: "text" },
    { path: "passenger.frequentFlyerNumber", label: "Frequent Flyer #", type: "text" },
    { path: "passenger.membershipProgramName", label: "Loyalty Program", type: "text" }
  ]],
  ["Seat (first only — multi-seat in CLI for now)", [
    { path: "passenger.seats.0.number", label: "Seat Number", type: "text" },
    { path: "passenger.seats.0.cabin", label: "Cabin", type: "select", options: ["economy", "premium", "business", "first"] },
    { path: "passenger.seats.0.description", label: "Seat Description (Window seat)", type: "text" }
  ]],
  ["Barcode", [
    { path: "barcode.format", label: "Format", type: "select", options: ["PKBarcodeFormatQR", "PKBarcodeFormatPDF417", "PKBarcodeFormatAztec", "PKBarcodeFormatCode128"] },
    { path: "barcode.message", label: "Message", type: "text" },
    { type: "scan", forPath: "barcode.message", label: "Scan barcode (camera / photo) → fills Message" },
    { path: "barcode.altText", label: "Alt Text", type: "text" }
  ]],
  ["iOS 26 Semantic", [
    { path: "iOS26.duration", label: "Duration (seconds)", type: "number" },
    { path: "iOS26.securityScreening", label: "Security Screening", type: "text" },
    { path: "iOS26.transitInfo", label: "Transit Info", type: "text" },
    { path: "iOS26.transitStatus", label: "Transit Status (On Time / Delayed)", type: "text" },
    { path: "iOS26.transitStatusReason", label: "Status Reason", type: "text" },
    { path: "iOS26.wifi.0.ssid", label: "Wifi SSID", type: "text" },
    { path: "iOS26.wifi.0.password", label: "Wifi Password", type: "text" }
  ]]
];

export function renderForm(root) {
  root.innerHTML = "";
  for (const [title, fields] of sections) {
    const fs = document.createElement("fieldset");
    const lg = document.createElement("legend");
    lg.textContent = title;
    fs.appendChild(lg);
    for (const f of fields) {
      const lbl = document.createElement("label");
      lbl.textContent = f.label;
      fs.appendChild(lbl);

      if (f.type === "file") {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.addEventListener("change", e => {
          const file = e.target.files?.[0];
          if (!file) { setPath(f.path, ""); return; }
          const reader = new FileReader();
          reader.onload = () => setPath(f.path, reader.result);
          reader.readAsDataURL(file);
        });
        fs.appendChild(input);
        if (getPath(f.path)) {
          const note = document.createElement("div");
          note.style.cssText = "font-size:11px;color:#888;margin-top:2px";
          note.textContent = "✓ logo set (clear by choosing a new file)";
          fs.appendChild(note);
        }
        continue;
      }

      if (f.type === "color") {
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;gap:6px;align-items:center";
        const picker = document.createElement("input");
        picker.type = "color";
        picker.style.cssText = "width:42px;height:32px;padding:0;border:1px solid #ccc;border-radius:4px;flex:none";
        const text = document.createElement("input");
        text.type = "text";
        text.dataset.path = f.path;
        text.value = getPath(f.path) ?? "";
        picker.value = rgbToHex(text.value);
        picker.addEventListener("input", () => { const rgb = hexToRgb(picker.value); text.value = rgb; setPath(f.path, rgb); });
        text.addEventListener("input", () => { setPath(f.path, text.value); picker.value = rgbToHex(text.value); });
        wrap.appendChild(picker);
        wrap.appendChild(text);
        fs.appendChild(wrap);
        continue;
      }

      if (f.type === "scan") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "📷 Scan barcode";
        btn.style.cssText = "background:#1a2150;color:#fff;border:none;padding:8px 12px;border-radius:6px;cursor:pointer";
        btn.addEventListener("click", async () => {
          btn.disabled = true; btn.textContent = "Scanning…";
          try {
            const text = await scanBarcode();
            if (text) {
              setPath(f.forPath, text);
              const inp = root.querySelector(`[data-path="${f.forPath}"]`);
              if (inp) inp.value = text;
            }
          } finally { btn.disabled = false; btn.textContent = "📷 Scan barcode"; }
        });
        fs.appendChild(btn);
        continue;
      }

      if (f.type === "datetime") {
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;gap:6px;align-items:center";
        const { local, offset } = splitIso(getPath(f.path));
        const dt = document.createElement("input");
        dt.type = "datetime-local";
        dt.step = "60";
        dt.value = local;
        dt.dataset.path = f.path;
        dt.style.cssText = "flex:1";
        const off = document.createElement("input");
        off.type = "text";
        off.value = offset;
        off.placeholder = "-07:00";
        off.title = "UTC offset at the airport, e.g. -07:00 or Z (blank = no offset)";
        off.style.cssText = "width:78px;flex:none";
        const sync = () => setPath(f.path, joinIso(dt.value, off.value.trim()));
        dt.addEventListener("input", sync);
        off.addEventListener("input", sync);
        wrap.appendChild(dt);
        wrap.appendChild(off);
        fs.appendChild(wrap);
        continue;
      }

      let input;
      if (f.type === "select") {
        input = document.createElement("select");
        for (const o of f.options) {
          const opt = document.createElement("option");
          opt.value = o; opt.textContent = o;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement("input");
        input.type = f.type;
      }
      input.value = getPath(f.path) ?? "";
      input.dataset.path = f.path;
      input.addEventListener("input", e => {
        const v = f.type === "number" ? Number(e.target.value) : e.target.value;
        setPath(f.path, v);
      });
      fs.appendChild(input);
    }
    root.appendChild(fs);
  }
}

import { setPath, getPath, state } from "./state.js";
import { scanBarcode } from "./scan.js";
import { renderSemanticsEditor } from "./semantics-editor.js";
import { suggestDisplayValues } from "@wpd/pass-builder/suggest.js";

const rgbToHex = (s) => {
  const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(s || "");
  if (!m) return "#000000";
  return "#" + [1, 2, 3].map(i => Number(m[i]).toString(16).padStart(2, "0")).join("");
};
const hexToRgb = (h) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || "");
  return m ? `rgb(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)})` : "rgb(0,0,0)";
};

const SECTIONS = ["header", "primary", "secondary", "auxiliary", "back"];
const SECTION_LABEL = { header: "Header", primary: "Primary", secondary: "Secondary", auxiliary: "Auxiliary", back: "Back" };

// The Designer's built-in semanticKey -> displayField-key map (its own field
// vocabulary). "Suggest values" fills these display fields from the semantics.
const DESIGNER_SUGGEST_MAP = {
  departureGate: "gate", seats: "seat",
  departureAirportCode: "depart", destinationAirportCode: "arrive",
  passengerName: "passenger", flightCode: "flight",
  currentBoardingDate: "boarding", currentDepartureDate: "depart-time",
  boardingGroup: "group", boardingSequenceNumber: "seq",
  membershipProgramNumber: "ff", departureTerminal: "terminal-dep", destinationTerminal: "terminal-arr"
};

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
  ["Barcode", [
    { path: "barcode.format", label: "Format", type: "select", options: ["PKBarcodeFormatQR", "PKBarcodeFormatPDF417", "PKBarcodeFormatAztec", "PKBarcodeFormatCode128"] },
    { path: "barcode.message", label: "Message", type: "text" },
    { type: "scan", forPath: "barcode.message", label: "Scan barcode (camera / photo) → fills Message" },
    { path: "barcode.altText", label: "Alt Text", type: "text" }
  ]]
];

export function renderForm(root) {
  root.innerHTML = "";
  for (const [title, fields] of sections) root.appendChild(renderStaticSection(title, fields, root));
  root.appendChild(renderSemanticsSection());
  root.appendChild(renderDisplayFieldsSection());
}

function renderStaticSection(title, fields, root) {
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
      input.type = "file"; input.accept = "image/*";
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
      text.type = "text"; text.dataset.path = f.path; text.value = getPath(f.path) ?? "";
      picker.value = rgbToHex(text.value);
      picker.addEventListener("input", () => { const rgb = hexToRgb(picker.value); text.value = rgb; setPath(f.path, rgb); });
      text.addEventListener("input", () => { setPath(f.path, text.value); picker.value = rgbToHex(text.value); });
      wrap.append(picker, text);
      fs.appendChild(wrap);
      continue;
    }
    if (f.type === "scan") {
      const btn = document.createElement("button");
      btn.type = "button"; btn.textContent = "📷 Scan barcode";
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
    input.addEventListener("input", e => setPath(f.path, e.target.value));
    fs.appendChild(input);
  }
  return fs;
}

function renderSemanticsSection() {
  const fs = document.createElement("fieldset");
  const lg = document.createElement("legend");
  lg.textContent = "Semantics (Apple)";
  fs.appendChild(lg);
  fs.appendChild(renderSemanticsEditor({
    values: state.semantics ?? {},
    onChange: (next) => setPath("semantics", next)
  }));
  return fs;
}

function renderDisplayFieldsSection() {
  const fs = document.createElement("fieldset");
  const lg = document.createElement("legend");
  lg.textContent = "Display fields";
  fs.appendChild(lg);

  const suggest = document.createElement("button");
  suggest.type = "button"; suggest.className = "suggest-btn"; suggest.textContent = "✨ Suggest values from semantics";
  suggest.addEventListener("click", () => {
    const filled = suggestDisplayValues(state.semantics ?? {}, DESIGNER_SUGGEST_MAP);
    const df = structuredClone(state.displayFields ?? {});
    for (const section of SECTIONS) for (const f of df[section] ?? []) {
      if (f.key in filled) { f.value = filled[f.key]; delete f.dateStyle; delete f.timeStyle; } // value is now literal text
    }
    setPath("displayFields", df);
    rerender();
  });
  fs.appendChild(suggest);

  const body = document.createElement("div");
  fs.appendChild(body);

  function rerender() {
    body.innerHTML = "";
    const df = state.displayFields ?? {};
    for (const section of SECTIONS) {
      const block = document.createElement("div");
      block.className = "df-section";
      const head = document.createElement("div");
      head.className = "df-head"; head.textContent = SECTION_LABEL[section];
      block.appendChild(head);
      (df[section] ?? []).forEach((f, i) => block.appendChild(fieldRow(section, f, i)));
      const add = document.createElement("button");
      add.type = "button"; add.className = "df-add"; add.textContent = "+ add field";
      add.addEventListener("click", () => {
        const next = structuredClone(state.displayFields ?? {});
        (next[section] ??= []).push({ key: `field${next[section].length + 1}`, label: "", value: "" });
        setPath("displayFields", next);
        rerender();
      });
      block.appendChild(add);
      body.appendChild(block);
    }
  }

  function fieldRow(section, f, i) {
    const row = document.createElement("div");
    row.className = "df-row"; row.dataset.k = f.key;
    const key = mk("df-key", f.key, "key");
    const label = mk("df-label", f.label ?? "", "LABEL");
    const value = mk("df-value", f.value ?? "", "value");
    const update = (prop, v) => {
      const next = structuredClone(state.displayFields ?? {});
      next[section][i][prop] = v;
      setPath("displayFields", next);
    };
    key.addEventListener("input", () => update("key", key.value));
    label.addEventListener("input", () => update("label", label.value));
    value.addEventListener("input", () => update("value", value.value));
    const rm = document.createElement("button");
    rm.type = "button"; rm.textContent = "✕"; rm.title = "remove field";
    rm.addEventListener("click", () => {
      const next = structuredClone(state.displayFields ?? {});
      next[section].splice(i, 1);
      setPath("displayFields", next);
      rerender();
    });
    row.append(key, label, value, rm);
    return row;
  }

  function mk(cls, value, placeholder) {
    const i = document.createElement("input");
    i.className = cls; i.value = value; i.placeholder = placeholder;
    return i;
  }

  rerender();
  return fs;
}

import { setPath, getPath, state } from "./state.js";
import { scanBarcode } from "./scan.js";
import { renderSemanticsEditor } from "./semantics-editor.js";
import { suggestDisplayValues } from "@wpd/pass-builder/suggest.js";
import { BRANDING_IMAGE_SLOTS } from "@wpd/pass-builder/form-assets.js";
import { parseBCBP, bcbpToSemantics } from "@wpd/pass-builder/bcbp.js";
import { showBcbpPreview } from "./bcbp-preview.js";

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

const BARCODE_FORMATS = [
  ["PKBarcodeFormatQR", "QR"],
  ["PKBarcodeFormatPDF417", "PDF417"],
  ["PKBarcodeFormatAztec", "Aztec"],
  ["PKBarcodeFormatCode128", "Code 128"]
];

// Apple PassKit image specs (points; assets ship @2x/@3x). iOS scales to fit
// and the validators don't enforce dimensions, so these are warnings, not
// blocks — they keep uploaded art on-spec. Keyed by the builder's slot name.
const ASSET_SPECS = {
  icon: { type: "icon", sizes: [[29, 29], [58, 58], [87, 87]], rec: "58 × 58 (@2x) / 87 × 87 (@3x)" },
  logo: { type: "wide", maxW: 480, maxH: 150, rec: "320 × 100 (@2x) / 480 × 150 (@3x)" },
  footer: { type: "footer", maxW: 858, maxH: 45, rec: "572 × 30 (@2x) / 858 × 45 (@3x)" },
  primaryLogo: { type: "wide", maxW: 480, maxH: 150, rec: "up to 480 × 150 (@3x)" }
};
function validateAssetDims(spec, w, h) {
  if (!spec || !w || !h) return null;
  const dims = `${w} × ${h} px`;
  if (spec.type === "icon") {
    if (Math.abs(w - h) > 1) return { ok: false, msg: `${dims} — must be square; use ${spec.rec}` };
    if (w < 29) return { ok: false, msg: `${dims} — too small; use ${spec.rec}` };
    return spec.sizes.some(([sw, sh]) => sw === w && sh === h)
      ? { ok: true, msg: `${dims} — matches spec` }
      : { ok: false, msg: `${dims} — non-standard; use ${spec.rec}` };
  }
  if (h > w) return { ok: false, msg: `${dims} — should be landscape; use ${spec.rec}` };
  if (w > spec.maxW || h > spec.maxH) return { ok: false, msg: `${dims} — exceeds max; use ${spec.rec}` };
  if (spec.type === "footer" && w < h * 6) return { ok: false, msg: `${dims} — too tall; footer is wide & short (${spec.rec})` };
  return { ok: true, msg: `${dims} — within spec` };
}

// tiny element helper
function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid);
  return n;
}

const card = (eyebrow, ...body) => h("section", { class: "wpd-card wpd-design-card" }, h("div", { class: "wpd-eyebrow" }, eyebrow), ...body);
const fieldLabel = (text) => h("label", { class: "wpd-fld-label", text });

// A plain text input wired to a FormState path.
function textInput(path, placeholder) {
  const i = h("input", { class: "wpd-input", value: getPath(path) ?? "", placeholder: placeholder ?? "" });
  i.dataset.path = path;
  i.addEventListener("input", () => setPath(path, i.value));
  return i;
}

// Color picker + hex text input, two-way synced (colors stored as rgb(...)).
function colorRow(path, label) {
  const picker = h("input", { type: "color", class: "wpd-color-swatch" });
  const text = h("input", { class: "wpd-input mono wpd-color-hex", value: getPath(path) ?? "" });
  text.dataset.path = path;
  picker.value = rgbToHex(text.value);
  picker.addEventListener("input", () => { const rgb = hexToRgb(picker.value); text.value = rgb; setPath(path, rgb); });
  text.addEventListener("input", () => { setPath(path, text.value); picker.value = rgbToHex(text.value); });
  return h("div", { class: "wpd-color" }, fieldLabel(label), h("div", { class: "wpd-color-row" }, picker, text));
}

function brandCard() {
  return card("Brand",
    h("div", { class: "wpd-fld" }, fieldLabel("Organization"), textInput("meta.organizationName")),
    h("div", { class: "wpd-fld" }, fieldLabel("Logo text"), textInput("branding.logoText")),
    h("div", { class: "wpd-color-grid" },
      colorRow("branding.backgroundColor", "Background"),
      colorRow("branding.foregroundColor", "Text"),
      colorRow("branding.labelColor", "Label")));
}

function assetsCard(root) {
  const rows = BRANDING_IMAGE_SLOTS.map(slotDef => {
    const path = `branding.${slotDef.key}`;
    const spec = ASSET_SPECS[slotDef.slot];
    const cur = getPath(path);
    const thumb = h("label", { class: "wpd-asset-thumb", title: slotDef.label });
    const file = h("input", { type: "file", accept: "image/png", style: "display:none" });
    const note = h("div", { class: "wpd-asset-note" });
    const setNote = (res) => {
      if (!res) { note.textContent = ""; note.className = "wpd-asset-note"; return; }
      note.textContent = (res.ok ? "✓ " : "⚠ ") + res.msg;
      note.className = "wpd-asset-note " + (res.ok ? "is-ok" : "is-warn");
    };
    if (typeof cur === "string" && cur.startsWith("data:image/")) {
      thumb.appendChild(h("img", { src: cur, alt: slotDef.label }));
    } else {
      thumb.appendChild(h("span", { class: "wpd-asset-plus", text: "+" }));
    }
    file.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (!f) { setPath(path, ""); return; }
      const reader = new FileReader();
      reader.onload = () => {
        setPath(path, reader.result);
        const img = new Image();
        img.onload = () => setNote(validateAssetDims(spec, img.naturalWidth, img.naturalHeight));
        img.onerror = () => setNote(null);
        img.src = reader.result;
        thumb.replaceChildren(h("img", { src: reader.result, alt: slotDef.label }));
        clearBtn.hidden = false;
      };
      reader.readAsDataURL(f);
      e.target.value = "";
    });
    thumb.appendChild(file);
    const clearBtn = h("button", { type: "button", class: "wpd-ghost wpd-asset-clear", text: "Remove" });
    clearBtn.hidden = !cur;
    clearBtn.addEventListener("click", () => { setPath(path, ""); renderForm(root); });
    return h("div", { class: "wpd-asset-row" },
      thumb,
      h("div", { class: "wpd-asset-info" },
        h("div", { class: "wpd-asset-label", text: slotDef.label }),
        h("div", { class: "wpd-asset-hint", text: assetHint(slotDef.slot) }),
        note),
      clearBtn);
  });
  return card("Assets", h("div", { class: "wpd-asset-list" }, ...rows));
}
const assetHint = (slot) => ({
  icon: "PNG · 29 × 29 pt, square — required by iOS",
  logo: "PNG · up to 160 × 50 pt — front of the pass",
  footer: "PNG · up to 286 × 15 pt — above the barcode",
  primaryLogo: "PNG · iOS 26 expanded view"
}[slot] ?? "PNG");

function barcodeCard(root) {
  const cur = () => getPath("barcode.format");
  const btns = BARCODE_FORMATS.map(([value, label]) => {
    const b = h("button", { type: "button", class: "wpd-fmt-btn" + (cur() === value ? " is-active" : ""), text: label, "data-fmt": value });
    b.addEventListener("click", () => {
      setPath("barcode.format", value);
      for (const sib of grid.querySelectorAll(".wpd-fmt-btn")) sib.classList.toggle("is-active", sib.dataset.fmt === value);
    });
    return b;
  });
  const grid = h("div", { class: "wpd-fmt-grid" }, ...btns);

  const scanBtn = h("button", { type: "button", class: "wpd-ghost", text: "📷 Scan / paste boarding pass → autofill flight details" });
  const scanNote = h("div", { class: "wpd-asset-hint" });
  scanBtn.addEventListener("click", async () => {
    scanBtn.disabled = true; const orig = scanBtn.textContent; scanBtn.textContent = "Scanning…";
    try {
      const text = await scanBarcode();
      if (!text) return;
      setPath("barcode.message", text);
      let parsed = null;
      try { parsed = parseBCBP(text); } catch { /* not a BCBP barcode */ }
      if (!parsed) { scanNote.textContent = "Set as barcode message (not a recognized boarding pass — fields not autofilled)."; renderForm(root); return; }
      if (!(await showBcbpPreview(parsed))) { scanNote.textContent = "Barcode message set; autofill cancelled."; renderForm(root); return; }
      const sem = { ...(state.semantics ?? {}), ...bcbpToSemantics(parsed) };
      setPath("semantics", sem);
      const filled = suggestDisplayValues(sem, DESIGNER_SUGGEST_MAP);
      const df = structuredClone(state.displayFields ?? {});
      for (const section of SECTIONS) for (const fld of df[section] ?? []) {
        if (fld.key in filled) { fld.value = filled[fld.key]; delete fld.dateStyle; delete fld.timeStyle; }
      }
      setPath("displayFields", df);
      renderForm(root);
    } finally { scanBtn.disabled = false; scanBtn.textContent = orig; }
  });

  return card("Barcode",
    h("div", { class: "wpd-fld" }, fieldLabel("Format"), grid),
    h("div", { class: "wpd-fld" }, fieldLabel("Message"), (() => { const i = textInput("barcode.message"); i.classList.add("mono"); return i; })()),
    h("div", { class: "wpd-fld" }, scanBtn, scanNote),
    h("div", { class: "wpd-fld" }, fieldLabel("Alt text"), textInput("barcode.altText")));
}

// Display fields: header/primary/secondary/auxiliary/back, each row key+label+value.
// Value inputs carry data-fieldkey so a click on the matching pass field can focus them.
function fieldsCard() {
  const body = h("div");
  const top = h("div", { class: "wpd-fields-top" },
    h("span", { class: "wpd-fields-hint", text: "click a field on the pass to jump here" }),
    (() => {
      const b = h("button", { type: "button", class: "wpd-ghost", text: "✨ Suggest values from semantics" });
      b.addEventListener("click", () => {
        const filled = suggestDisplayValues(state.semantics ?? {}, DESIGNER_SUGGEST_MAP);
        const df = structuredClone(state.displayFields ?? {});
        for (const section of SECTIONS) for (const f of df[section] ?? []) {
          if (f.key in filled) { f.value = filled[f.key]; delete f.dateStyle; delete f.timeStyle; }
        }
        setPath("displayFields", df);
        rerender();
      });
      return b;
    })());

  function rerender() {
    body.innerHTML = "";
    const df = state.displayFields ?? {};
    for (const section of SECTIONS) {
      const block = h("div", { class: "wpd-fsec" });
      block.appendChild(h("div", { class: "wpd-fsec-head" }, SECTION_LABEL[section]));
      (df[section] ?? []).forEach((f, i) => block.appendChild(fieldRow(section, f, i)));
      const add = h("button", { type: "button", class: "wpd-ghost-mini", text: "+ add field" });
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
    const update = (prop, v) => {
      const next = structuredClone(state.displayFields ?? {});
      next[section][i][prop] = v;
      setPath("displayFields", next);
    };
    const key = h("input", { class: "wpd-input wpd-df-key", value: f.key ?? "", placeholder: "key" });
    const label = h("input", { class: "wpd-input wpd-df-label", value: f.label ?? "", placeholder: "LABEL" });
    const value = h("input", { class: "wpd-input wpd-df-value", value: f.value ?? "", placeholder: "value" });
    value.dataset.fieldkey = f.key ?? "";
    key.addEventListener("input", () => { update("key", key.value); value.dataset.fieldkey = key.value; });
    label.addEventListener("input", () => update("label", label.value));
    value.addEventListener("input", () => update("value", value.value));
    const rm = h("button", { type: "button", class: "wpd-df-rm", title: "remove field", text: "✕" });
    rm.addEventListener("click", () => {
      const next = structuredClone(state.displayFields ?? {});
      next[section].splice(i, 1);
      setPath("displayFields", next);
      rerender();
    });
    const row = h("div", { class: "wpd-df-row" }, key, label, value, rm);
    row.dataset.k = f.key ?? "";
    return row;
  }

  rerender();
  return card("Fields", top, body);
}

function metaDrawer() {
  const fields = [
    ["meta.passTypeId", "Pass Type ID"],
    ["meta.teamId", "Team ID"],
    ["meta.serialNumber", "Serial Number"],
    ["meta.description", "Description"],
    ["meta.expirationDate", "Pass expiry (ISO; blank = arrival + 1 day)"]
  ];
  const body = h("div", { class: "wpd-drawer-body" },
    ...fields.map(([path, label]) => h("div", { class: "wpd-fld" }, fieldLabel(label), textInput(path))));
  return h("details", { class: "wpd-drawer wpd-design-drawer" },
    h("summary", { class: "wpd-drawer-summary", text: "Pass metadata — identifiers & expiry" }),
    body);
}

function semanticsDrawer() {
  const body = h("div", { class: "wpd-drawer-body" });
  body.appendChild(renderSemanticsEditor({
    values: state.semantics ?? {},
    onChange: (next) => setPath("semantics", next)
  }));
  return h("details", { class: "wpd-drawer wpd-design-drawer" },
    h("summary", { class: "wpd-drawer-summary", text: "Apple semantics" }),
    body);
}

export function renderForm(root) {
  root.innerHTML = "";
  const view = h("div", { class: "wpd-view wpd-design" },
    h("div", { class: "wpd-view-head" },
      h("h1", { text: "Design" }),
      h("p", { text: "Branding, layout & barcode — the live preview mirrors the shipped boarding pass." })),
    brandCard(),
    assetsCard(root),
    barcodeCard(root),
    fieldsCard(),
    metaDrawer(),
    semanticsDrawer());
  root.appendChild(view);
}

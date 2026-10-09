import { setPath, getPath, state } from "./state.js";
import { scanBarcode } from "./scan.js";
import { renderSemanticsEditor } from "./semantics-editor.js";
import { suggestDisplayValues } from "@wpd/pass-builder/suggest.js";
import { BRANDING_IMAGE_SLOTS } from "@wpd/pass-builder/form-assets.js";
import { parseBCBP, bcbpToSemantics } from "@wpd/pass-builder/bcbp.js";
import { showBcbpPreview } from "./bcbp-preview.js";
import { renderTypedInput } from "./inputs.js";

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

/**
 * A display field holding a date/time (its value must stay ISO-8601): Wallet
 * formats dateStyle/timeStyle fields; timeFormat "24h" ones are rendered
 * "HH:mm" at emit (field-render.js).
 */
const isDateField = (f) => f?.dateStyle !== undefined || f?.timeStyle !== undefined || f?.timeFormat !== undefined;

// Label tokens a label can carry (resolved from the pass's semantics at emit).
const LABEL_TOKEN_HINT = "Labels can show flight values: {departureCityName:upper}, {destinationAirportName}, {flightCode} …";
const LABEL_TOKEN_TITLE = "Use {semanticKey} or {semanticKey:upper} to fill the label from the flight data, e.g. {departureCityName:upper}";

/**
 * Fill display fields from semantics through the Designer's suggest map. A
 * date-styled field keeps its style and gets the raw ISO value (the pass
 * formats it on device); others get the formatted text.
 */
export function applySuggestions(displayFields, semantics) {
  const filled = suggestDisplayValues(semantics, DESIGNER_SUGGEST_MAP);
  const semOf = Object.fromEntries(Object.entries(DESIGNER_SUGGEST_MAP).map(([sem, fk]) => [fk, sem]));
  const df = structuredClone(displayFields ?? {});
  for (const section of SECTIONS) for (const f of df[section] ?? []) {
    if (!(f.key in filled)) continue;
    const raw = semantics?.[semOf[f.key]];
    if (isDateField(f) && typeof raw === "string") f.value = raw;
    else { f.value = filled[f.key]; delete f.dateStyle; delete f.timeStyle; delete f.timeFormat; }
  }
  return df;
}

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

// One titled group inside a section of the Design workspace's left pane.
const card = (title, ...body) => h("section", { class: "dw-group" }, h("h2", { class: "dw-h", text: title }), ...body);
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
        const dataUrl = reader.result;
        // The app only accepts PNG data URLs — reject anything else before it
        // reaches state (an <input accept> is advisory; users can still pick
        // other files). Decode via an Image to confirm it's a readable image.
        if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png")) {
          setNote({ ok: false, msg: "Not a PNG — only PNG images are accepted." });
          return;
        }
        const img = new Image();
        img.onload = () => {
          setPath(path, dataUrl);
          setNote(validateAssetDims(spec, img.naturalWidth, img.naturalHeight));
          thumb.replaceChildren(h("img", { src: dataUrl, alt: slotDef.label }));
          clearBtn.hidden = false;
        };
        img.onerror = () => setNote({ ok: false, msg: "Could not read this image — it may be corrupt." });
        img.src = dataUrl;
      };
      reader.onerror = () => setNote({ ok: false, msg: "Could not read this file." });
      reader.readAsDataURL(f);
      e.target.value = "";
    });
    thumb.appendChild(file);
    const clearBtn = h("button", { type: "button", class: "wpd-ghost wpd-asset-clear", text: "Remove" });
    clearBtn.hidden = !cur;
    clearBtn.addEventListener("click", () => { setPath(path, ""); renderForm(root, { section: "look" }); });
    return h("div", { class: "wpd-asset-row" },
      thumb,
      h("div", { class: "wpd-asset-info" },
        h("div", { class: "wpd-asset-label", text: slotDef.label }),
        h("div", { class: "wpd-asset-hint", text: assetHint(slotDef.slot) }),
        note),
      clearBtn);
  });
  return card("Images", h("div", { class: "wpd-asset-list" }, ...rows));
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

  const scanBtn = h("button", { type: "button", class: "wpd-ghost", text: "Scan / paste boarding pass → autofill" });
  const scanNote = h("div", { class: "wpd-asset-hint" });
  scanBtn.addEventListener("click", async () => {
    scanBtn.disabled = true; const orig = scanBtn.textContent; scanBtn.textContent = "Scanning…";
    try {
      const text = await scanBarcode();
      if (!text) return;
      setPath("barcode.message", text);
      let parsed = null;
      try { parsed = parseBCBP(text); } catch { /* not a BCBP barcode */ }
      if (!parsed) { scanNote.textContent = "Set as barcode message (not a recognized boarding pass — fields not autofilled)."; renderForm(root, { section: "barcode" }); return; }
      if (!(await showBcbpPreview(parsed))) { scanNote.textContent = "Barcode message set; autofill cancelled."; renderForm(root, { section: "barcode" }); return; }
      const sem = { ...(state.semantics ?? {}), ...bcbpToSemantics(parsed) };
      setPath("semantics", sem);
      setPath("displayFields", applySuggestions(state.displayFields, sem));
      renderForm(root, { section: "barcode" });
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
    h("span", { class: "wpd-fields-hint wpd-fields-tokens", text: LABEL_TOKEN_HINT }),
    (() => {
      const b = h("button", { type: "button", class: "wpd-link", text: "Suggest from semantics" });
      b.addEventListener("click", () => {
        setPath("displayFields", applySuggestions(state.displayFields, state.semantics ?? {}));
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
      const add = h("button", { type: "button", class: "wpd-link", text: "+ add field" });
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
    const where = `${SECTION_LABEL[section]} field ${i + 1}`;
    const key = h("input", { class: "wpd-input wpd-df-key", value: f.key ?? "", placeholder: "key", "aria-label": `${where} key` });
    const label = h("input", { class: "wpd-input wpd-df-label", value: f.label ?? "", placeholder: "LABEL", title: LABEL_TOKEN_TITLE, "aria-label": `${where} label` });
    // A date-styled field gets the typed date/time/offset picker (its value must
    // stay ISO-8601 — iOS rejects the pass otherwise); others a plain input.
    let value, focusTarget;
    if (isDateField(f)) {
      value = renderTypedInput({ type: "date", value: f.value ?? "", label: where, onChange: (v) => update("value", v) });
      value.classList.add("wpd-df-value", "wpd-df-date");
      focusTarget = value.querySelector("input");
    } else {
      value = h("input", { class: "wpd-input wpd-df-value", value: f.value ?? "", placeholder: "value", "aria-label": `${where} value` });
      value.addEventListener("input", () => update("value", value.value));
      focusTarget = value;
    }
    focusTarget.dataset.fieldkey = f.key ?? "";
    key.addEventListener("input", () => { update("key", key.value); focusTarget.dataset.fieldkey = key.value; });
    label.addEventListener("input", () => update("label", label.value));
    // Optional: left off the pass while blank (e.g. a note only some routes fill).
    const opt = h("button", { type: "button", class: "wpd-df-opt" + (f.optional ? " is-active" : ""), text: "opt", title: "Optional: hide this field on the pass while it’s blank", "aria-label": `${where} optional — hide while blank`, "aria-pressed": String(Boolean(f.optional)) });
    opt.addEventListener("click", () => {
      const next = structuredClone(state.displayFields ?? {});
      if (next[section][i].optional) delete next[section][i].optional; else next[section][i].optional = true;
      setPath("displayFields", next);
      rerender();
    });
    const rm = h("button", { type: "button", class: "wpd-df-rm", title: "remove field", "aria-label": `Remove ${where}`, text: "×" });
    rm.addEventListener("click", () => {
      const next = structuredClone(state.displayFields ?? {});
      next[section].splice(i, 1);
      setPath("displayFields", next);
      rerender();
    });
    // A date row wraps: key · label · remove on top, the picker full-width below,
    // then how the time shows: the phone's own format, or always 24-hour.
    const row = isDateField(f)
      ? h("div", { class: "wpd-df-row is-date" }, key, label, opt, rm, value, timeFormatToggle(section, i, f, where))
      : h("div", { class: "wpd-df-row" }, key, label, value, opt, rm);
    row.dataset.k = f.key ?? "";
    return row;
  }

  // Phone format: Wallet formats the ISO value in the phone's locale (12 h or
  // 24 h per its setting). 24-hour: always "HH:mm" in the airport's time.
  function timeFormatToggle(section, i, f, where) {
    const fixed = f.timeFormat === "24h";
    const set = (mode) => {
      const next = structuredClone(state.displayFields ?? {});
      const field = next[section][i];
      if (mode === "24h") { field.timeFormat = "24h"; delete field.dateStyle; delete field.timeStyle; }
      else { delete field.timeFormat; field.timeStyle ??= "PKDateStyleShort"; }
      setPath("displayFields", next);
      rerender();
    };
    const btn = (mode, text, on) => {
      const b = h("button", { type: "button", class: "wpd-fmt-btn" + (on ? " is-active" : ""), text, "data-tfmt": mode, "aria-pressed": String(on) });
      b.addEventListener("click", () => { if (!on) set(mode); });
      return b;
    };
    return h("div", { class: "wpd-tfmt", role: "group", "aria-label": `${where} time format` },
      btn("device", "Phone format", !fixed), btn("24h", "24-hour", fixed));
  }

  rerender();
  const head = h("div", { class: "dw-df-head", "aria-hidden": "true" }, h("span", { text: "Key" }), h("span", { text: "Label" }), h("span", { text: "Value" }));
  return card("Fields on the pass", top, head, body);
}

function metaCard() {
  const fields = [
    ["meta.passTypeId", "Pass Type ID", "Forced from the server's signing cert at issue"],
    ["meta.teamId", "Team ID", "Forced from the server's signing cert at issue"],
    ["meta.serialNumber", "Sample serial", "Each issued pass gets its own"],
    ["meta.description", "Description", "VoiceOver reads this for the pass"],
    ["meta.expirationDate", "Pass expiry", "ISO date-time; blank = arrival + 1 day"]
  ];
  return card("Pass metadata",
    ...fields.map(([path, label, hint]) => h("div", { class: "wpd-fld" }, fieldLabel(label), textInput(path), h("div", { class: "wpd-asset-hint", text: hint }))));
}

function semanticsCard() {
  return card("Flight data",
    h("p", { class: "dw-sub", text: "Apple's semantic tags: iOS 26 builds the boarding pass's expanded view and Live Activity from these. The values here are the design's sample; issuing replaces the flight and passenger." }),
    renderSemanticsEditor({ values: state.semantics ?? {}, onChange: (next) => setPath("semantics", next) }));
}

// Left-pane sections of the Design workspace (main.js owns the tab strip).
export const DESIGN_SECTIONS = [
  ["look", "Look"], ["fields", "Fields"], ["flight", "Flight data"], ["barcode", "Barcode"], ["advanced", "Advanced"]
];

/**
 * Render one section of the Design editor into `root`.
 * @param {HTMLElement} root
 * @param {{section?: "look"|"fields"|"flight"|"barcode"|"advanced"}} [opts]
 */
export function renderForm(root, { section = "look" } = {}) {
  root.innerHTML = "";
  const build = {
    look: () => [brandCard(), assetsCard(root)],
    fields: () => [fieldsCard()],
    flight: () => [semanticsCard()],
    barcode: () => [barcodeCard(root)],
    advanced: () => [metaCard()]
  }[section] ?? (() => [brandCard(), assetsCard(root)]);
  root.appendChild(h("div", { class: "dw-section stagger", "data-section": section }, ...build()));
}

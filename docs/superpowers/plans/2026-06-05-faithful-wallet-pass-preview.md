# Faithful Wallet Pass Preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the designer's stylized preview with a pixel-faithful Apple Wallet boarding pass rendered from the same `pass.json` that gets signed, with a real scannable barcode and an uploadable logo.

**Architecture:** A small, isolated renderer under `apps/designer/src/preview/wallet/`. The preview imports the existing pure `formStateToPassJson(state)`, converts it to a formatted view-model (`model.js` + `format.js`), and the per-tab renderers (`card.js` / `back.js` / `detail.js`) build DOM from it. Barcodes render via `bwip-js`. Pure logic (formatting, model adaptation, format mapping) is unit-tested; visual layout is verified by eye.

**Tech Stack:** Vanilla JS (ES modules), Vite, vitest, `bwip-js`, npm workspaces.

**Spec:** [docs/superpowers/specs/2026-06-05-faithful-wallet-pass-preview-design.md](../specs/2026-06-05-faithful-wallet-pass-preview-design.md)

---

## File Structure

**Create:**
- `apps/designer/src/preview/wallet/format.js` — pure value formatting (PKDateStyle/timeStyle/numberStyle).
- `apps/designer/src/preview/wallet/model.js` — pure `toPassView(passJson)` → formatted view-model.
- `apps/designer/src/preview/wallet/barcode.js` — `passKitToBwipType` (pure) + `renderBarcode` (bwip-js → canvas).
- `apps/designer/src/preview/wallet/card.js` — FRONT ticket renderer (zones + notch + barcode).
- `apps/designer/src/preview/wallet/back.js` — BACK field-list renderer.
- `apps/designer/src/preview/wallet/detail.js` — iOS 26 semantic detail renderer.
- `apps/designer/src/preview/wallet/wallet.css` — Wallet-accurate styling.
- `tests/wallet-format.test.js`, `tests/wallet-model.test.js`, `tests/wallet-barcode.test.js`

**Modify:**
- `apps/designer/package.json` — add `bwip-js` + `@wpd/pass-builder` deps.
- `apps/designer/src/preview/index.js` — rewire to `formStateToPassJson` + wallet renderers.
- `apps/designer/src/form.js` — add Assets section + `file` input type for logo.

**Delete:**
- `apps/designer/src/preview/front.js`, `apps/designer/src/preview/back.js`, `apps/designer/src/preview/detail.js`

---

## Task 1: Add dependencies

**Files:**
- Modify: `apps/designer/package.json`

- [ ] **Step 1: Add deps to the designer workspace**

Replace the `package.json` contents of `apps/designer/package.json` with:

```json
{
  "name": "@wpd/designer",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "@wpd/pass-builder": "*",
    "bwip-js": "^4.5.1"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
```

- [ ] **Step 2: Install at the repo root**

Run: `npm install`
Expected: completes without error; `node_modules/bwip-js` exists and `node_modules/@wpd/pass-builder` is a symlink.

Verify: `ls node_modules/bwip-js >/dev/null && ls -l node_modules/@wpd/pass-builder`
Expected: prints the symlink to `../../packages/pass-builder`.

- [ ] **Step 3: Commit**

```bash
git add apps/designer/package.json package-lock.json
git commit -m "chore(designer): add bwip-js + pass-builder deps for faithful preview"
```

---

## Task 2: `format.js` — Apple value formatting

**Files:**
- Create: `apps/designer/src/preview/wallet/format.js`
- Test: `tests/wallet-format.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/wallet-format.test.js`:

```js
import { describe, it, expect } from "vitest";
import { formatFieldValue } from "../apps/designer/src/preview/wallet/format.js";

describe("formatFieldValue", () => {
  it("returns an em-dash for empty values", () => {
    expect(formatFieldValue({ value: "" })).toBe("—");
    expect(formatFieldValue({ value: null })).toBe("—");
    expect(formatFieldValue({ value: undefined })).toBe("—");
  });

  it("returns the raw string when no style is set", () => {
    expect(formatFieldValue({ value: "38K" })).toBe("38K");
  });

  it("formats an ISO datetime to a time string when timeStyle is short", () => {
    const out = formatFieldValue({
      value: "2026-06-20T13:30:00+08:00",
      dateStyle: "PKDateStyleNone",
      timeStyle: "PKDateStyleShort"
    });
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });

  it("falls back to the raw value for an unparseable date", () => {
    expect(formatFieldValue({ value: "not-a-date", timeStyle: "PKDateStyleShort" })).toBe("not-a-date");
  });

  it("formats a percent number when numberStyle is percent", () => {
    expect(formatFieldValue({ value: 0.5, numberStyle: "PKNumberStylePercent" })).toBe("50%");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/wallet-format.test.js`
Expected: FAIL — cannot resolve `format.js` / `formatFieldValue is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/designer/src/preview/wallet/format.js`:

```js
// Apple PassKit value formatting, so the preview matches how iOS Wallet renders fields.

const DATE_STYLE = {
  PKDateStyleShort: "short",
  PKDateStyleMedium: "medium",
  PKDateStyleLong: "long",
  PKDateStyleFull: "full"
};

/**
 * Format one boardingPass field value the way iOS Wallet would.
 * @param {{value:any, dateStyle?:string, timeStyle?:string, numberStyle?:string}} field
 * @returns {string}
 */
export function formatFieldValue(field) {
  const { value } = field;
  if (value === undefined || value === null || value === "") return "—";
  if (field.dateStyle || field.timeStyle) return formatDate(value, field.dateStyle, field.timeStyle);
  if (field.numberStyle) return formatNumber(value, field.numberStyle);
  return String(value);
}

/** @returns {string} */
export function formatDate(value, dateStyle = "PKDateStyleNone", timeStyle = "PKDateStyleNone") {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const opts = {};
  if (DATE_STYLE[dateStyle]) opts.dateStyle = DATE_STYLE[dateStyle];
  if (DATE_STYLE[timeStyle]) opts.timeStyle = DATE_STYLE[timeStyle];
  if (!opts.dateStyle && !opts.timeStyle) return String(value);
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

/** @returns {string} */
export function formatNumber(value, numberStyle) {
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  if (numberStyle === "PKNumberStylePercent") {
    return new Intl.NumberFormat(undefined, { style: "percent" }).format(n);
  }
  return new Intl.NumberFormat().format(n);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/wallet-format.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/designer/src/preview/wallet/format.js tests/wallet-format.test.js
git commit -m "feat(preview): Apple PassKit value formatting helper"
```

---

## Task 3: `model.js` — pass.json → view-model

**Files:**
- Create: `apps/designer/src/preview/wallet/model.js`
- Test: `tests/wallet-model.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/wallet-model.test.js`:

```js
import { describe, it, expect } from "vitest";
import { toPassView } from "../apps/designer/src/preview/wallet/model.js";

const samplePass = {
  logoText: "EVA Air",
  backgroundColor: "rgb(0,104,71)",
  foregroundColor: "rgb(255,255,255)",
  labelColor: "rgb(244,168,32)",
  barcodes: [{ format: "PKBarcodeFormatPDF417", message: "BR262MNLTPE38K0073", altText: "BR262 38K" }],
  boardingPass: {
    headerFields: [{ key: "gate", label: "GATE", value: "5" }],
    primaryFields: [
      { key: "depart", label: "Manila", value: "MNL" },
      { key: "arrive", label: "Taipei", value: "TPE" }
    ],
    secondaryFields: [{ key: "passenger", label: "PASSENGER", value: "ANGELO SOLIVERES" }],
    auxiliaryFields: [
      { key: "boarding", label: "BOARDING", value: "2026-06-20T13:30:00+08:00", timeStyle: "PKDateStyleShort", dateStyle: "PKDateStyleNone" }
    ],
    backFields: [{ key: "ff", label: "FREQUENT FLYER", value: "BR-INFINITY-7788990" }],
    additionalInfoFields: [{ key: "meal", label: "MEAL", value: "Hot meal" }]
  }
};

describe("toPassView", () => {
  it("maps colors from the pass with sensible fallbacks", () => {
    const v = toPassView(samplePass);
    expect(v.colors).toEqual({
      bg: "rgb(0,104,71)",
      fg: "rgb(255,255,255)",
      label: "rgb(244,168,32)"
    });
  });

  it("maps each zone to {key,label,value}", () => {
    const v = toPassView(samplePass);
    expect(v.primary).toHaveLength(2);
    expect(v.primary[0]).toEqual({ key: "depart", label: "Manila", value: "MNL" });
    expect(v.header[0]).toEqual({ key: "gate", label: "GATE", value: "5" });
    expect(v.back[0].value).toBe("BR-INFINITY-7788990");
    expect(v.additional[0].label).toBe("MEAL");
  });

  it("formats dated auxiliary fields through format.js", () => {
    const v = toPassView(samplePass);
    expect(v.auxiliary[0].value).toMatch(/\d{1,2}:\d{2}/);
  });

  it("exposes the first barcode", () => {
    const v = toPassView(samplePass);
    expect(v.barcode).toEqual({
      format: "PKBarcodeFormatPDF417",
      message: "BR262MNLTPE38K0073",
      altText: "BR262 38K"
    });
  });

  it("returns null barcode and empty zones for a bare pass", () => {
    const v = toPassView({});
    expect(v.barcode).toBeNull();
    expect(v.primary).toEqual([]);
    expect(v.colors.bg).toBe("rgb(0,0,0)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/wallet-model.test.js`
Expected: FAIL — cannot resolve `model.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/designer/src/preview/wallet/model.js`:

```js
import { formatFieldValue } from "./format.js";

const mapFields = (arr) => (arr ?? []).map(f => ({
  key: f.key,
  label: f.label ?? "",
  value: formatFieldValue(f)
}));

/**
 * Pure adapter: the signed pass.json → a formatted view-model for the faithful preview.
 * Reads the same arrays iOS lays out, so preview == shipped pass.
 * @param {object} pass  output of formStateToPassJson
 */
export function toPassView(pass) {
  const bp = pass.boardingPass ?? {};
  const bc = pass.barcodes?.[0] ?? null;
  return {
    logoText: pass.logoText ?? "",
    colors: {
      bg: pass.backgroundColor ?? "rgb(0,0,0)",
      fg: pass.foregroundColor ?? "rgb(255,255,255)",
      label: pass.labelColor ?? pass.foregroundColor ?? "rgb(255,255,255)"
    },
    header: mapFields(bp.headerFields),
    primary: mapFields(bp.primaryFields),
    secondary: mapFields(bp.secondaryFields),
    auxiliary: mapFields(bp.auxiliaryFields),
    back: mapFields(bp.backFields),
    additional: mapFields(bp.additionalInfoFields),
    barcode: bc ? { format: bc.format, message: bc.message, altText: bc.altText ?? "" } : null
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/wallet-model.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/designer/src/preview/wallet/model.js tests/wallet-model.test.js
git commit -m "feat(preview): pass.json -> view-model adapter"
```

---

## Task 4: `barcode.js` — real scannable barcode

**Files:**
- Create: `apps/designer/src/preview/wallet/barcode.js`
- Test: `tests/wallet-barcode.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/wallet-barcode.test.js`:

```js
import { describe, it, expect } from "vitest";
import { passKitToBwipType } from "../apps/designer/src/preview/wallet/barcode.js";

describe("passKitToBwipType", () => {
  it("maps every supported PassKit format", () => {
    expect(passKitToBwipType("PKBarcodeFormatPDF417")).toBe("pdf417");
    expect(passKitToBwipType("PKBarcodeFormatQR")).toBe("qrcode");
    expect(passKitToBwipType("PKBarcodeFormatAztec")).toBe("azteccode");
    expect(passKitToBwipType("PKBarcodeFormatCode128")).toBe("code128");
  });

  it("returns null for an unknown format", () => {
    expect(passKitToBwipType("PKBarcodeFormatBogus")).toBeNull();
    expect(passKitToBwipType(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/wallet-barcode.test.js`
Expected: FAIL — cannot resolve `barcode.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/designer/src/preview/wallet/barcode.js`:

```js
import bwipjs from "bwip-js";

const FORMAT_MAP = {
  PKBarcodeFormatPDF417: "pdf417",
  PKBarcodeFormatQR: "qrcode",
  PKBarcodeFormatAztec: "azteccode",
  PKBarcodeFormatCode128: "code128"
};

/**
 * Map an Apple PassKit barcode format to a bwip-js symbology id.
 * @param {string} passKitFormat
 * @returns {string|null}
 */
export function passKitToBwipType(passKitFormat) {
  return FORMAT_MAP[passKitFormat] ?? null;
}

/**
 * Render a barcode into a <canvas>. On any failure (unknown format, empty
 * message, encode error) returns a neutral placeholder element instead of throwing.
 * @param {{format:string, message:string, altText?:string}} barcode
 * @returns {HTMLElement}
 */
export function renderBarcode(barcode) {
  const type = passKitToBwipType(barcode?.format);
  if (!type || !barcode?.message) return placeholder(barcode?.altText);
  try {
    const canvas = document.createElement("canvas");
    bwipjs.toCanvas(canvas, {
      bcid: type,
      text: barcode.message,
      scale: 2,
      includetext: false,
      ...(type === "pdf417" ? { columns: 6 } : {}),
      paddingwidth: 0,
      paddingheight: 0
    });
    canvas.className = "wallet-barcode-canvas";
    return canvas;
  } catch {
    return placeholder(barcode?.altText);
  }
}

function placeholder(altText) {
  const d = document.createElement("div");
  d.className = "wallet-barcode-placeholder";
  d.textContent = altText || "barcode";
  return d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/wallet-barcode.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/designer/src/preview/wallet/barcode.js tests/wallet-barcode.test.js
git commit -m "feat(preview): bwip-js barcode renderer + format map"
```

---

## Task 5: `wallet.css` — Wallet-accurate styling

**Files:**
- Create: `apps/designer/src/preview/wallet/wallet.css`

- [ ] **Step 1: Create the stylesheet**

Create `apps/designer/src/preview/wallet/wallet.css`:

```css
.wallet-card {
  width: 320px;
  border-radius: 16px;
  overflow: hidden;
  font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28);
  margin: 0 auto;
}
.wallet-pad { padding: 16px 18px; }
.wallet-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.wallet-logo { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 17px; letter-spacing: .3px; }
.wallet-logo img { height: 24px; width: auto; display: block; }
.wallet-header-fields { display: flex; gap: 16px; }
.wallet-header-fields .wallet-field { text-align: right; }

.wallet-primary { display: flex; align-items: flex-end; justify-content: space-between; margin-top: 18px; }
.wallet-primary .wallet-iata { font-size: 40px; font-weight: 800; line-height: 1; letter-spacing: 1px; }
.wallet-primary .wallet-city { font-size: 9px; text-transform: uppercase; letter-spacing: .5px; }
.wallet-plane { opacity: .65; font-size: 18px; padding-bottom: 7px; }

.wallet-row { display: grid; gap: 6px; margin-top: 16px; }
.wallet-row.cols-2 { grid-template-columns: repeat(2, 1fr); }
.wallet-row.cols-3 { grid-template-columns: repeat(3, 1fr); }
.wallet-row.cols-4 { grid-template-columns: repeat(4, 1fr); }

.wallet-field .wallet-label { font-size: 8px; text-transform: uppercase; letter-spacing: .6px; }
.wallet-field .wallet-value { font-size: 14px; font-weight: 700; margin-top: 1px; }

.wallet-perf {
  position: relative;
  height: 0;
  border-top: 2px dashed rgba(255, 255, 255, 0.55);
  margin: 18px 14px 0;
}
.wallet-perf::before, .wallet-perf::after {
  content: ""; position: absolute; top: -10px; width: 20px; height: 20px;
  border-radius: 50%; background: #f0f1f5;
}
.wallet-perf::before { left: -24px; }
.wallet-perf::after { right: -24px; }

.wallet-strip {
  background: #fff; margin: 16px 14px 18px; border-radius: 10px; padding: 14px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.wallet-barcode-canvas { width: 240px; height: auto; image-rendering: pixelated; }
.wallet-barcode-placeholder {
  width: 240px; height: 60px; display: flex; align-items: center; justify-content: center;
  background: repeating-linear-gradient(90deg, #000 0 3px, #fff 3px 6px);
  color: #333; font-size: 11px; letter-spacing: 2px;
}
.wallet-alt { font-size: 11px; color: #333; letter-spacing: 2px; }

/* Back + detail */
.wallet-back, .wallet-detail {
  width: 340px; margin: 0 auto; background: #fff; color: #1a1a1a; border-radius: 16px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.14); overflow: hidden;
  font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
}
.wallet-back-head { display: flex; align-items: center; gap: 10px; padding: 16px 18px; }
.wallet-back-head .badge {
  width: 34px; height: 34px; border-radius: 8px; color: #fff; display: flex;
  align-items: center; justify-content: center; font-weight: 800; font-size: 12px; overflow: hidden;
}
.wallet-back-list { padding: 0 18px 16px; }
.wallet-back-item { padding: 12px 0; border-top: 1px solid #ececf0; }
.wallet-back-item:first-child { border-top: none; }
.wallet-back-item .k { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #8a8a90; }
.wallet-back-item .v { font-size: 15px; margin-top: 2px; }

.wallet-detail-section { background: #f4f4f7; border-radius: 12px; padding: 12px 14px; margin: 12px 16px; }
.wallet-detail-section .title { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #8a8a90; margin-bottom: 6px; }
.wallet-detail-section .body { font-size: 14px; }
.wallet-detail-section .body .line { display: flex; justify-content: space-between; padding: 2px 0; }

.wallet-error { color: #b00020; padding: 16px; font-size: 13px; }
```

- [ ] **Step 2: Commit**

```bash
git add apps/designer/src/preview/wallet/wallet.css
git commit -m "feat(preview): wallet-accurate stylesheet"
```

---

## Task 6: `card.js` — faithful FRONT ticket

**Files:**
- Create: `apps/designer/src/preview/wallet/card.js`

> No unit test (DOM layout — verified by eye in Task 11). Logic it depends on (`model.js`, `format.js`, `barcode.js`) is already tested.

- [ ] **Step 1: Create the renderer**

Create `apps/designer/src/preview/wallet/card.js`:

```js
import { renderBarcode } from "./barcode.js";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function fieldEl(f) {
  const wrap = el("div", "wallet-field");
  wrap.appendChild(el("div", "wallet-label", f.label));
  wrap.appendChild(el("div", "wallet-value", f.value));
  return wrap;
}

function row(fields, colsMax) {
  const cols = Math.min(Math.max(fields.length, 1), colsMax);
  const r = el("div", `wallet-row cols-${cols}`);
  fields.forEach(f => r.appendChild(fieldEl(f)));
  return r;
}

/**
 * Render the faithful FRONT ticket from a view-model.
 * @param {HTMLElement} root
 * @param {ReturnType<import("./model.js").toPassView>} view
 * @param {string|null} logoDataUrl
 */
export function renderFront(root, view, logoDataUrl) {
  const card = el("div", "wallet-card");
  card.style.background = view.colors.bg;
  card.style.color = view.colors.fg;

  const body = el("div", "wallet-pad");

  // Header: logo (image or text) + right-aligned header fields (max 3)
  const header = el("div", "wallet-header");
  const logo = el("div", "wallet-logo");
  if (logoDataUrl) {
    const img = document.createElement("img");
    img.src = logoDataUrl;
    img.alt = view.logoText || "logo";
    logo.appendChild(img);
  } else {
    logo.appendChild(document.createTextNode(view.logoText || ""));
  }
  header.appendChild(logo);
  const hf = el("div", "wallet-header-fields");
  view.header.slice(0, 3).forEach(f => hf.appendChild(fieldEl(f)));
  header.appendChild(hf);
  body.appendChild(header);

  // Primary: origin → destination, big IATA codes
  const prim = el("div", "wallet-primary");
  const [from, to] = view.primary;
  prim.appendChild(iataBlock(from, "left"));
  prim.appendChild(el("div", "wallet-plane", "✈"));
  prim.appendChild(iataBlock(to, "right"));
  body.appendChild(prim);

  if (view.secondary.length) body.appendChild(row(view.secondary, 3));
  if (view.auxiliary.length) body.appendChild(row(view.auxiliary, 4));
  card.appendChild(body);

  // Perforation + barcode strip
  card.appendChild(el("div", "wallet-perf"));
  if (view.barcode) {
    const strip = el("div", "wallet-strip");
    strip.appendChild(renderBarcode(view.barcode));
    if (view.barcode.altText) strip.appendChild(el("div", "wallet-alt", view.barcode.altText));
    card.appendChild(strip);
  }

  applyLabelColor(card, view.colors.label);
  root.appendChild(card);
}

function iataBlock(f, align) {
  const b = el("div");
  if (align === "right") b.style.textAlign = "right";
  b.appendChild(el("div", "wallet-city", f?.label ?? ""));
  b.appendChild(el("div", "wallet-iata", f?.value ?? "—"));
  return b;
}

// Apply labelColor to every label + city after the tree is built.
function applyLabelColor(card, color) {
  card.querySelectorAll(".wallet-label, .wallet-city").forEach(n => { n.style.color = color; });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/designer/src/preview/wallet/card.js
git commit -m "feat(preview): faithful front ticket renderer"
```

---

## Task 7: `back.js` — faithful BACK list

**Files:**
- Create: `apps/designer/src/preview/wallet/back.js`

- [ ] **Step 1: Create the renderer**

Create `apps/designer/src/preview/wallet/back.js`:

```js
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * Render the BACK of the pass: airline badge + back fields + iOS 26 additional info.
 * @param {HTMLElement} root
 * @param {ReturnType<import("./model.js").toPassView>} view
 * @param {string|null} logoDataUrl
 */
export function renderBack(root, view, logoDataUrl) {
  const card = el("div", "wallet-back");

  const head = el("div", "wallet-back-head");
  const badge = el("div", "badge");
  badge.style.background = view.colors.bg;
  if (logoDataUrl) {
    const img = document.createElement("img");
    img.src = logoDataUrl; img.alt = "logo";
    img.style.width = "100%"; img.style.height = "100%"; img.style.objectFit = "contain";
    badge.appendChild(img);
  } else {
    badge.textContent = (view.logoText || "?").slice(0, 2).toUpperCase();
  }
  head.appendChild(badge);
  head.appendChild(el("div", null, view.logoText || ""));
  card.appendChild(head);

  const list = el("div", "wallet-back-list");
  const items = [...view.back, ...view.additional];
  if (!items.length) {
    list.appendChild(el("div", "wallet-back-item", "No back fields."));
  } else {
    for (const f of items) {
      const item = el("div", "wallet-back-item");
      item.appendChild(el("div", "k", f.label));
      item.appendChild(el("div", "v", f.value));
      list.appendChild(item);
    }
  }
  card.appendChild(list);
  root.appendChild(card);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/designer/src/preview/wallet/back.js
git commit -m "feat(preview): faithful back-of-pass renderer"
```

---

## Task 8: `detail.js` — iOS 26 semantic detail

**Files:**
- Create: `apps/designer/src/preview/wallet/detail.js`

> This renderer takes the full `pass` object (not the view-model) because it reads `pass.semantics` and `pass.upcomingPassInformation`.

- [ ] **Step 1: Create the renderer**

Create `apps/designer/src/preview/wallet/detail.js`:

```js
import { formatDate } from "./format.js";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function section(title, lines) {
  const s = el("div", "wallet-detail-section");
  s.appendChild(el("div", "title", title));
  const body = el("div", "body");
  for (const [k, v] of lines) {
    const line = el("div", "line");
    line.appendChild(el("span", null, k));
    line.appendChild(el("span", null, v));
    body.appendChild(line);
  }
  s.appendChild(body);
  return s;
}

/**
 * Render the iOS 26 semantic expanded view from the signed pass.
 * @param {HTMLElement} root
 * @param {object} pass  output of formStateToPassJson
 */
export function renderDetail(root, pass) {
  const sem = pass.semantics ?? {};
  const card = el("div", "wallet-detail");

  const head = el("div", "wallet-back-head");
  const badge = el("div", "badge");
  badge.style.background = pass.backgroundColor ?? "#222";
  badge.textContent = sem.airlineCode ?? "✈";
  head.appendChild(badge);
  head.appendChild(el("div", null, `${sem.flightCode ?? ""} · ${pass.organizationName ?? ""}`));
  card.appendChild(head);

  card.appendChild(section("Route", [
    [`${sem.departureAirportCode ?? "—"} ${sem.departureLocationDescription ?? ""}`,
     sem.currentDepartureDate ? formatDate(sem.currentDepartureDate, "PKDateStyleMedium", "PKDateStyleShort") : "—"],
    [`${sem.destinationAirportCode ?? "—"} ${sem.destinationLocationDescription ?? ""}`,
     sem.currentArrivalDate ? formatDate(sem.currentArrivalDate, "PKDateStyleMedium", "PKDateStyleShort") : "—"]
  ]));

  const boardingLines = [];
  if (sem.boardingGroup) boardingLines.push(["Group", sem.boardingGroup]);
  if (sem.boardingSequenceNumber) boardingLines.push(["Sequence", sem.boardingSequenceNumber]);
  if (sem.currentBoardingDate) boardingLines.push(["Boards", formatDate(sem.currentBoardingDate, "PKDateStyleNone", "PKDateStyleShort")]);
  if (sem.departureGate) boardingLines.push(["Gate", sem.departureGate]);
  if (boardingLines.length) card.appendChild(section("Boarding", boardingLines));

  if (Array.isArray(sem.seats) && sem.seats.length) {
    card.appendChild(section("Seats", sem.seats.map(s => [s.seatNumber ?? "—", s.seatType ?? ""])));
  }

  if (typeof sem.duration === "number") {
    const h = Math.floor(sem.duration / 3600);
    const m = Math.floor((sem.duration % 3600) / 60);
    card.appendChild(section("Flight Duration", [["Estimated", `${h}h ${m}m`]]));
  }
  if (sem.securityScreening) card.appendChild(section("Security Screening", [["Type", sem.securityScreening]]));
  if (sem.transitProvider) card.appendChild(section("Transit", [["Info", sem.transitProvider]]));
  if (Array.isArray(sem.wifiAccess) && sem.wifiAccess.length) {
    card.appendChild(section("Wi-Fi", sem.wifiAccess.map(w => [w.ssid, w.password ?? ""])));
  }
  if (Array.isArray(pass.upcomingPassInformation) && pass.upcomingPassInformation.length) {
    card.appendChild(section("Upcoming", pass.upcomingPassInformation.map(e => [
      e.name ?? e.identifier,
      e.dateInformation?.date ? formatDate(e.dateInformation.date, "PKDateStyleMedium", "PKDateStyleShort") : "—"
    ])));
  }

  root.appendChild(card);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/designer/src/preview/wallet/detail.js
git commit -m "feat(preview): iOS 26 semantic detail renderer"
```

---

## Task 9: Rewire `preview/index.js`, delete old renderers

**Files:**
- Modify: `apps/designer/src/preview/index.js`
- Delete: `apps/designer/src/preview/front.js`, `back.js`, `detail.js`

- [ ] **Step 1: Replace `preview/index.js`**

Replace the entire contents of `apps/designer/src/preview/index.js` with:

```js
import { state } from "../state.js";
import { formStateToPassJson } from "@wpd/pass-builder/form-to-pass.js";
import { toPassView } from "./wallet/model.js";
import { renderFront } from "./wallet/card.js";
import { renderBack } from "./wallet/back.js";
import { renderDetail } from "./wallet/detail.js";
import { getActiveTab, onTabChange } from "../tabs.js";
import "./wallet/wallet.css";

const stage = () => document.getElementById("preview-stage");

export function renderActiveTab() {
  const root = stage();
  root.innerHTML = "";

  let pass;
  try {
    pass = formStateToPassJson(state);
  } catch (err) {
    const e = document.createElement("div");
    e.className = "wallet-error";
    e.textContent = `Preview error: ${err.message}`;
    root.appendChild(e);
    return;
  }

  const view = toPassView(pass);
  const logo = state.branding?.logoDataUrl ?? null;
  const t = getActiveTab();
  if (t === "front") renderFront(root, view, logo);
  else if (t === "back") renderBack(root, view, logo);
  else renderDetail(root, pass);
}

onTabChange(renderActiveTab);
```

- [ ] **Step 2: Delete the superseded renderers**

Run:
```bash
git rm apps/designer/src/preview/front.js apps/designer/src/preview/back.js apps/designer/src/preview/detail.js
```
Expected: three files removed.

- [ ] **Step 3: Verify the deep import resolves under Vite**

Run: `cd apps/designer && npx vite build && cd ../..`
Expected: build succeeds (confirms `@wpd/pass-builder/form-to-pass.js`, `bwip-js`, and the CSS import all resolve). If the deep import fails, fall back to the relative import `../../../../packages/pass-builder/form-to-pass.js` in `preview/index.js`.

- [ ] **Step 4: Commit**

```bash
git add apps/designer/src/preview/index.js
git commit -m "feat(preview): render faithful pass from formStateToPassJson; drop old renderers"
```

---

## Task 10: Logo upload in the form

**Files:**
- Modify: `apps/designer/src/form.js`

- [ ] **Step 1: Add an Assets section**

In `apps/designer/src/form.js`, add this entry to the `sections` array, immediately after the `"Branding"` block:

```js
  ["Assets", [
    { path: "branding.logoDataUrl", label: "Logo image (PNG/SVG)", type: "file" }
  ]],
```

- [ ] **Step 2: Handle the `file` input type in `renderForm`**

In `apps/designer/src/form.js`, replace the body of the `for (const f of fields)` loop in `renderForm` with this version (adds a `file` branch that reads the image as a data URL; leaves text/select/number behavior unchanged):

```js
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
      input.addEventListener("input", e => {
        const v = f.type === "number" ? Number(e.target.value) : e.target.value;
        setPath(f.path, v);
      });
      fs.appendChild(input);
    }
```

- [ ] **Step 3: Verify the existing test suite still passes**

Run: `npm test`
Expected: PASS — existing `pass-builder`/`manifest`/`integration` tests plus the 3 new wallet test files all green.

Note: `branding.logoDataUrl` is a preview-only key; `formStateToPassJson` ignores unknown branding keys, so the build is unaffected. Data URLs persist via the existing localStorage path (acceptable size for a single-user dev tool).

- [ ] **Step 4: Commit**

```bash
git add apps/designer/src/form.js
git commit -m "feat(designer): logo image upload for faithful preview"
```

---

## Task 11: Manual fidelity verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev servers**

Run: `npm run dev`
Expected: Vite on `http://localhost:4318`, API on `http://localhost:4317`.

- [ ] **Step 2: Load the EVA fixture and eyeball all three tabs**

Open `http://localhost:4318/?fixture=eva-br262`.
Verify:
- **Front:** EVA green card, gold labels, white text; `MNL ✈ TPE` big; GATE/SEAT in header; PASSENGER/FLIGHT + BOARDING/DEPART/GROUP/SEQ rows; **dashed perforation + side notches** above a **real PDF417** with `BR262 38K` alt text.
- **Back:** badge + FREQUENT FLYER, terminals, and the MEAL/BAGGAGE/FARE additional-info rows.
- **iOS 26 Detail:** Route, Boarding, Seats, Flight Duration, Security, Transit, Wi-Fi, Upcoming sections populated.

- [ ] **Step 3: Test the barcode formats + logo**

- In the Barcode → Format dropdown, switch to `PKBarcodeFormatQR`; confirm the front strip re-renders a QR code.
- In Assets, upload an EVA logo image; confirm it appears in the front header and the back badge.
- Switch back to `PKBarcodeFormatPDF417`.

- [ ] **Step 4: Confirm build still works**

Click **Build .pkpass**; confirm a `.pkpass` downloads with no error (the build path is unchanged).

- [ ] **Step 5: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "chore(preview): fidelity tweaks from manual verification"
```

---

## Self-Review

**Spec coverage:**
- Faithful card, 3 tabs → Tasks 6/7/8. ✓
- Render from `pass.json` → Task 9 (`formStateToPassJson` → `toPassView`). ✓
- Real scannable barcode (PDF417/QR/Aztec/Code128) → Task 4 + `wallet.css`. ✓
- Logo upload + fallback to `logoText` → Task 10 + Task 6/7. ✓
- Ticket notch + perforation, zone typography, PKDateStyle formatting → Tasks 5/2/6. ✓
- Error handling (em-dash, raw date, barcode placeholder, preview try/catch) → Tasks 2/4/9. ✓
- No backend/schema/signing changes → confirmed (only consumes `formStateToPassJson`); regression covered Task 10 Step 3. ✓
- Out-of-scope (device frame, live activity, asset embedding, LXC) → intentionally excluded. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output.

**Type consistency:** `toPassView` shape (`colors{bg,fg,label}`, `header/primary/secondary/auxiliary/back/additional`, `barcode{format,message,altText}`) is defined in Task 3 and consumed identically in Tasks 6/7. `renderBarcode`/`passKitToBwipType` signatures match between Task 4 and Task 6. `renderFront/renderBack(root,view,logo)` and `renderDetail(root,pass)` match between Tasks 6/7/8 and the calls in Task 9.

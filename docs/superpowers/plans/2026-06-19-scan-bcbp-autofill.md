# Scan Boarding Pass → BCBP Parse + Autofill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user scan (camera/photo) or **paste** a real boarding-pass barcode, parse the IATA BCBP string into structured flight data, show a **preview-then-confirm** panel, and on confirm autofill the semantics + display fields (Designer) or the per-passenger row (Issue) — and set the pass's barcode message to the scanned BCBP.

**Architecture:** A pure parser `packages/pass-builder/bcbp.js` (`parseBCBP` → mandatory-field decode + Julian→date inference; `bcbpToSemantics` → map to Apple semantic keys). A shared preview modal `apps/designer/src/bcbp-preview.js` (`showBcbpPreview(parsed) → Promise<boolean>`). `scan.js` gains a **paste-first** input (paste → upload → camera, in that order). Designer (`form.js`) and Issue (`issue.js`) call scan → parse → preview → apply (reusing existing `suggestDisplayValues`, `harvestSemantics`, and the already-wired `barcodeMessage` reserved key).

**Tech Stack:** Vanilla ESM JS, Node ≥24, vitest, `@zxing/browser` (already a dependency). No new dependencies.

## Global Constraints

- Node ≥24; ESM vanilla JS — no TypeScript, no framework.
- **No new dependencies.** `@zxing/browser` already present; do not add a BCBP npm package — the parser is hand-rolled.
- Immutable updates only — never mutate inputs; return new objects.
- Tests in `tests/` at repo root; run `npx vitest run tests/<file>`.
- **Scope: scan→autofill ONLY.** Do NOT implement the separate issue-time barcode *format/altText* controls (that is the `feat/issue-barcode-controls` stream). The `barcodeMessage` reserved key is ALREADY implemented in `packages/pass-builder/template.js` (RESERVED_KEYS + `applyTemplateData`) — reuse it; do not re-implement it.
- **Preview-then-confirm:** parsed values are shown in a modal and only written to the form after the user clicks Confirm.
- BCBP provides identity/route/carrier/flight#/seat/PNR/sequence + flight **date** (no clock time). Do NOT fabricate departure/arrival *times*, gate, terminal, or timezones — those stay manual.
- Determinism: `parseBCBP` accepts an optional `referenceDate` for the Julian→year inference so tests are deterministic; production callers omit it (defaults to `new Date()`).
- Apple semantics shapes (from `packages/pass-builder/semantics.js`): `passengerName` = `{givenName, familyName}`; `seats` = `[{seatRow, seatNumber}]`; `flightNumber` = number.

---

### Task 1: BCBP parser core (`parseBCBP`)

**Files:**
- Create: `packages/pass-builder/bcbp.js`
- Modify: `packages/pass-builder/index.js` (re-export)
- Test: `tests/bcbp.test.js`

**Interfaces:**
- Produces: `parseBCBP(raw: string, opts?: {referenceDate?: Date}): object` — decodes the mandatory header + first leg of an IATA Resolution 792 "M" boarding pass. Returns `{ format, legs, passengerName:{givenName,familyName}, confirmationNumber, departureAirportCode, destinationAirportCode, airlineCode, flightNumber:number, flightCode, flightDayOfYear:number, flightDate:"YYYY-MM-DD", compartmentCode, seats:[{seatRow,seatNumber}], boardingSequenceNumber, passengerStatus }`. Throws `Error` with a clear message when the string is not a parseable BCBP "M" record.

- [ ] **Step 1: Write the failing test**

```js
// tests/bcbp.test.js
import { describe, it, expect } from "vitest";
import { parseBCBP } from "../packages/pass-builder/bcbp.js";

// Build a single-leg BCBP "M" string from fixed-width fields so positions are
// guaranteed correct (no hand-counting). Layout: header(23) + leg1 mandatory(37).
function sampleBCBP() {
  return [
    "M",                          // format code
    "1",                          // number of legs
    "DESMARAIS/LUC".padEnd(20),   // passenger name (20)
    "E",                          // electronic ticket indicator
    "ABC123".padEnd(7),           // operating carrier PNR (7)
    "YUL",                        // from airport (3)
    "FRA",                        // to airport (3)
    "AC".padEnd(3),               // operating carrier (3)
    "0834".padEnd(5),             // flight number (5)
    "226",                        // Julian date of flight (3)
    "F",                          // compartment code (1)
    "001A",                       // seat number (4)
    "0025".padEnd(5),             // check-in sequence (5)
    "1",                          // passenger status (1)
    "00"                          // conditional size hex (2)
  ].join("");
}

const REF = new Date(Date.UTC(2026, 5, 1)); // 2026-06-01, deterministic year inference

describe("parseBCBP", () => {
  it("decodes the mandatory header + first leg", () => {
    const p = parseBCBP(sampleBCBP(), { referenceDate: REF });
    expect(p.format).toBe("M");
    expect(p.legs).toBe(1);
    expect(p.passengerName).toEqual({ givenName: "LUC", familyName: "DESMARAIS" });
    expect(p.confirmationNumber).toBe("ABC123");
    expect(p.departureAirportCode).toBe("YUL");
    expect(p.destinationAirportCode).toBe("FRA");
    expect(p.airlineCode).toBe("AC");
    expect(p.flightNumber).toBe(834);
    expect(p.flightCode).toBe("AC834");
    expect(p.seats).toEqual([{ seatRow: "1", seatNumber: "A" }]);
    expect(p.boardingSequenceNumber).toBe("25");
    expect(p.flightDayOfYear).toBe(226);
    expect(p.flightDate).toBe("2026-08-14"); // day 226 of 2026
  });

  it("infers the nearest year across the Jan/Dec boundary", () => {
    // day 5 (early Jan) scanned on Dec 28 2025 → should resolve to 2026, not 2025
    const dec = new Date(Date.UTC(2025, 11, 28));
    const s = sampleBCBP().slice(0, 44) + "005" + sampleBCBP().slice(47);
    expect(parseBCBP(s, { referenceDate: dec }).flightDate).toBe("2026-01-05");
  });

  it("ignores leading/trailing whitespace around the record", () => {
    expect(parseBCBP("  " + sampleBCBP() + "\n", { referenceDate: REF }).format).toBe("M");
  });

  it("throws on a non-BCBP string", () => {
    expect(() => parseBCBP("https://example.com/ticket")).toThrow(/BCBP/i);
    expect(() => parseBCBP("M1tooshort")).toThrow(/BCBP/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bcbp.test.js`
Expected: FAIL — `Failed to resolve import "../packages/pass-builder/bcbp.js"`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/pass-builder/bcbp.js
// Pure parser for IATA Resolution 792 "Bar Coded Boarding Pass" (BCBP) strings —
// the data encoded in the PDF417/Aztec barcode printed on boarding passes.
// We decode the MANDATORY header + first leg (fixed-position fields); the
// trailing conditional/variable block and any extra legs are not needed for
// autofill and are ignored. BCBP carries the flight DATE (Julian day-of-year)
// but no clock time, gate, terminal, city, or timezone.

import { splitPersonName, seatSemantics } from "./semantics.js";

const HEADER_NAME = [2, 22]; // passenger-name slice bounds in the header
const LEG_START = 23;        // first leg's mandatory block starts here
const MIN_LEN = 60;          // header(23) + leg mandatory(37)

/** Day-of-year (1..366) → "YYYY-MM-DD", picking the year nearest the reference date. */
function julianToISODate(day, referenceDate) {
  const ref = referenceDate ?? new Date();
  const refMs = ref.getTime();
  let best = null;
  for (const y of [ref.getUTCFullYear() - 1, ref.getUTCFullYear(), ref.getUTCFullYear() + 1]) {
    const cand = new Date(Date.UTC(y, 0, 1) + (day - 1) * 86400000);
    const dist = Math.abs(cand.getTime() - refMs);
    if (best === null || dist < best.dist) best = { cand, dist };
  }
  return best.cand.toISOString().slice(0, 10);
}

/**
 * @param {string} raw  the decoded barcode text
 * @param {{referenceDate?: Date}} [opts]
 * @returns {object} structured BCBP fields (see plan)
 */
export function parseBCBP(raw, opts = {}) {
  const s = String(raw ?? "").replace(/^\s+|\s+$/g, "");
  if (s[0] !== "M" || s.length < MIN_LEN) {
    throw new Error("Not a parseable IATA BCBP 'M' boarding-pass barcode");
  }
  const legs = Number.parseInt(s[1], 10);
  if (!Number.isInteger(legs) || legs < 1) {
    throw new Error("Not a parseable IATA BCBP 'M' boarding-pass barcode (bad leg count)");
  }
  const name = s.slice(HEADER_NAME[0], HEADER_NAME[1]).trim();

  let i = LEG_START;
  const take = (n) => { const v = s.slice(i, i + n); i += n; return v; };
  const pnr = take(7).trim();
  const from = take(3).trim();
  const to = take(3).trim();
  const carrier = take(3).trim();
  const flight = take(5).trim();
  const julian = take(3).trim();
  const compartment = take(1).trim();
  const seat = take(4).trim();
  const sequence = take(5).trim();
  const passengerStatus = take(1).trim();
  // remaining (conditional-size hex + variable block + extra legs) intentionally ignored

  const flightDigits = (flight.match(/\d+/) ?? [""])[0];
  const flightNumber = flightDigits ? Number.parseInt(flightDigits, 10) : undefined;
  const seatDigits = (seat.match(/\d+/) ?? [""])[0];
  const seatLetter = seat.replace(/[0-9\s]/g, "");
  const seatComposite = seatDigits ? `${Number.parseInt(seatDigits, 10)}${seatLetter}` : seat;
  const seqDigits = (sequence.match(/\d+/) ?? [""])[0];
  const flightDayOfYear = Number.parseInt(julian, 10);

  return {
    format: "M",
    legs,
    passengerName: splitPersonName(name),
    confirmationNumber: pnr,
    departureAirportCode: from,
    destinationAirportCode: to,
    airlineCode: carrier,
    flightNumber,
    flightCode: carrier && flightNumber !== undefined ? `${carrier}${flightNumber}` : undefined,
    flightDayOfYear: Number.isInteger(flightDayOfYear) ? flightDayOfYear : undefined,
    flightDate: Number.isInteger(flightDayOfYear) ? julianToISODate(flightDayOfYear, opts.referenceDate) : undefined,
    compartmentCode: compartment || undefined,
    seats: seat ? [seatSemantics(seatComposite)] : [],
    boardingSequenceNumber: seqDigits ? String(Number.parseInt(seqDigits, 10)) : undefined,
    passengerStatus: passengerStatus || undefined
  };
}
```

- [ ] **Step 4: Add re-export**

In `packages/pass-builder/index.js`, after the `form-assets.js` re-export line, add:

```js
export { parseBCBP } from "./bcbp.js";
```

(Task 2 adds `bcbpToSemantics` to this same line.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/bcbp.test.js`
Expected: the 4 `parseBCBP` cases PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/pass-builder/bcbp.js packages/pass-builder/index.js tests/bcbp.test.js
git commit -m "feat(pass-builder): parse IATA BCBP boarding-pass barcodes"
```

---

### Task 2: Map parsed BCBP → Apple semantics (`bcbpToSemantics`)

**Files:**
- Modify: `packages/pass-builder/bcbp.js` (add `bcbpToSemantics`)
- Modify: `packages/pass-builder/index.js` (add `bcbpToSemantics` to the re-export)
- Test: `tests/bcbp.test.js` (add a describe block)

**Interfaces:**
- Consumes: `parseBCBP` output (Task 1).
- Produces: `bcbpToSemantics(parsed: object): Record<string, any>` — a BOARDING_SEMANTICS-shaped object containing only the keys BCBP supplies confidently: `passengerName`, `confirmationNumber`, `departureAirportCode`, `destinationAirportCode`, `airlineCode`, `flightCode`, `flightNumber`, `seats`, `boardingSequenceNumber`. Empty/undefined values are omitted. The flight DATE is intentionally NOT mapped (no time component — surfaced in the preview as reference only).

- [ ] **Step 1: Write the failing test**

```js
// append to tests/bcbp.test.js
import { bcbpToSemantics } from "../packages/pass-builder/bcbp.js";

describe("bcbpToSemantics", () => {
  it("maps confident BCBP fields to Apple semantic keys, omitting date/time", () => {
    const parsed = parseBCBP(sampleBCBP(), { referenceDate: REF });
    const sem = bcbpToSemantics(parsed);
    expect(sem.passengerName).toEqual({ givenName: "LUC", familyName: "DESMARAIS" });
    expect(sem.confirmationNumber).toBe("ABC123");
    expect(sem.departureAirportCode).toBe("YUL");
    expect(sem.destinationAirportCode).toBe("FRA");
    expect(sem.airlineCode).toBe("AC");
    expect(sem.flightCode).toBe("AC834");
    expect(sem.flightNumber).toBe(834);
    expect(sem.seats).toEqual([{ seatRow: "1", seatNumber: "A" }]);
    expect(sem.boardingSequenceNumber).toBe("25");
    // no timestamped departure — BCBP has no clock time
    expect(sem.currentDepartureDate).toBeUndefined();
    expect(sem.originalDepartureDate).toBeUndefined();
  });

  it("omits keys with empty values", () => {
    const sem = bcbpToSemantics({ airlineCode: "", seats: [], flightNumber: undefined });
    expect(sem).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bcbp.test.js`
Expected: FAIL — `bcbpToSemantics is not a function` / import unresolved.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/pass-builder/bcbp.js`:

```js
/**
 * Map parsed BCBP fields onto Apple boarding semantic keys, keeping only the
 * fields BCBP carries confidently. The flight date is omitted on purpose: BCBP
 * has no clock time, so we never write a (wrong) timestamped departure.
 * @param {object} parsed  output of {@link parseBCBP}
 * @returns {Record<string, any>}
 */
export function bcbpToSemantics(parsed = {}) {
  const out = {};
  const name = parsed.passengerName;
  if (name && (name.givenName || name.familyName)) out.passengerName = name;
  if (parsed.confirmationNumber) out.confirmationNumber = parsed.confirmationNumber;
  if (parsed.departureAirportCode) out.departureAirportCode = parsed.departureAirportCode;
  if (parsed.destinationAirportCode) out.destinationAirportCode = parsed.destinationAirportCode;
  if (parsed.airlineCode) out.airlineCode = parsed.airlineCode;
  if (parsed.flightCode) out.flightCode = parsed.flightCode;
  if (Number.isFinite(parsed.flightNumber)) out.flightNumber = parsed.flightNumber;
  if (Array.isArray(parsed.seats) && parsed.seats.length) out.seats = parsed.seats;
  if (parsed.boardingSequenceNumber) out.boardingSequenceNumber = parsed.boardingSequenceNumber;
  return out;
}
```

In `packages/pass-builder/index.js`, change the re-export line to:

```js
export { parseBCBP, bcbpToSemantics } from "./bcbp.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bcbp.test.js`
Expected: PASS (all `parseBCBP` + `bcbpToSemantics` cases).

- [ ] **Step 5: Commit**

```bash
git add packages/pass-builder/bcbp.js packages/pass-builder/index.js tests/bcbp.test.js
git commit -m "feat(pass-builder): map parsed BCBP to Apple boarding semantics"
```

---

### Task 3: Shared preview-confirm modal (`showBcbpPreview`)

**Files:**
- Create: `apps/designer/src/bcbp-preview.js`
- Test: `tests/bcbp-preview.test.js`

**Interfaces:**
- Produces: `showBcbpPreview(parsed: object): Promise<boolean>` — renders a modal overlay listing the detected fields (passenger, route, flight, seat, sequence, and flight date labelled "no time in barcode"), with **Confirm** and **Cancel** buttons. Resolves `true` on Confirm, `false` on Cancel. Pure DOM (no app-state coupling) so both flows reuse it.

- [ ] **Step 1: Write the failing test**

```js
// tests/bcbp-preview.test.js
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { showBcbpPreview } from "../apps/designer/src/bcbp-preview.js";

const parsed = {
  passengerName: { givenName: "LUC", familyName: "DESMARAIS" },
  departureAirportCode: "YUL", destinationAirportCode: "FRA",
  flightCode: "AC834", seats: [{ seatRow: "1", seatNumber: "A" }],
  boardingSequenceNumber: "25", flightDate: "2026-08-14"
};

describe("showBcbpPreview", () => {
  it("renders detected fields and resolves true on Confirm", async () => {
    const p = showBcbpPreview(parsed);
    const overlay = document.querySelector(".bcbp-preview");
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain("AC834");
    expect(overlay.textContent).toContain("YUL");
    expect(overlay.textContent).toContain("FRA");
    overlay.querySelector("[data-bcbp-confirm]").click();
    await expect(p).resolves.toBe(true);
    expect(document.querySelector(".bcbp-preview")).toBeNull(); // removed after choice
  });

  it("resolves false on Cancel", async () => {
    const p = showBcbpPreview(parsed);
    document.querySelector("[data-bcbp-cancel]").click();
    await expect(p).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bcbp-preview.test.js`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Write minimal implementation**

```js
// apps/designer/src/bcbp-preview.js
// Shared "we read this from your boarding pass — apply it?" modal. Pure DOM:
// returns a Promise<boolean> (Confirm → true, Cancel → false). Both the
// Designer and Issue flows use it before writing parsed BCBP into the form.

const fmtName = (n) => n ? [n.givenName, n.familyName].filter(Boolean).join(" ") : "";
const fmtSeats = (s) => (s ?? []).map(x => `${x.seatRow ?? ""}${x.seatNumber ?? ""}`).join(", ");

export function showBcbpPreview(parsed) {
  return new Promise((resolve) => {
    const rows = [
      ["Passenger", fmtName(parsed.passengerName)],
      ["Route", [parsed.departureAirportCode, parsed.destinationAirportCode].filter(Boolean).join(" → ")],
      ["Flight", parsed.flightCode ?? ""],
      ["Seat", fmtSeats(parsed.seats)],
      ["Booking ref", parsed.confirmationNumber ?? ""],
      ["Sequence", parsed.boardingSequenceNumber ?? ""],
      ["Flight date", parsed.flightDate ? `${parsed.flightDate} (no time in barcode — set departure time manually)` : ""]
    ].filter(([, v]) => v);

    const overlay = document.createElement("div");
    overlay.className = "bcbp-preview";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
    const card = document.createElement("div");
    card.style.cssText = "background:#fff;color:#111;border-radius:12px;max-width:420px;width:100%;padding:18px;font:14px system-ui";
    card.innerHTML =
      `<div style="font-weight:700;margin-bottom:10px">Detected from boarding pass</div>` +
      rows.map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px solid #eee"><span style="color:#666">${k}</span><span style="font-weight:600;text-align:right">${v}</span></div>`).join("") +
      `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
         <button data-bcbp-cancel style="background:#eee;border:none;padding:9px 16px;border-radius:8px;cursor:pointer">Cancel</button>
         <button data-bcbp-confirm style="background:#1a2150;color:#fff;border:none;padding:9px 16px;border-radius:8px;cursor:pointer;font-weight:600">Confirm &amp; fill</button>
       </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const finish = (ok) => { overlay.remove(); resolve(ok); };
    card.querySelector("[data-bcbp-confirm]").addEventListener("click", () => finish(true));
    card.querySelector("[data-bcbp-cancel]").addEventListener("click", () => finish(false));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(false); });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bcbp-preview.test.js`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/designer/src/bcbp-preview.js tests/bcbp-preview.test.js
git commit -m "feat(designer): shared BCBP preview-confirm modal"
```

---

### Task 4: Paste-first scan input in `scan.js`

**Files:**
- Modify: `apps/designer/src/scan.js`

**Interfaces:**
- `scanBarcode()` signature is unchanged (`Promise<string|null>`). The overlay is reordered/extended so the user can: (1) **paste** the barcode text and click "Use pasted text" (resolves immediately, no decode); (2) **upload** a photo (zxing decode); (3) start the **camera** on demand (zxing decode). Paste is presented first; the camera no longer auto-starts (it starts when the user clicks "Use camera").

- [ ] **Step 1: Implement (UI change; verified by the suite + designer build, then manually)**

Replace the body of `scanBarcode()` in `apps/designer/src/scan.js` with the overlay below. Keep the `BrowserMultiFormatReader` import and the `decodeFromImageUrl` photo path.

```js
import { BrowserMultiFormatReader } from "@zxing/browser";

// Get a barcode's text by paste (primary), photo upload, or camera (on demand).
// Resolves with the text, or null if cancelled. Camera needs a secure origin.
export function scanBarcode() {
  return new Promise((resolve) => {
    const reader = new BrowserMultiFormatReader();
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

    $("#scan-use-cam").addEventListener("click", () => {
      video.style.display = "block";
      msg.textContent = "Starting camera…";
      reader.decodeFromVideoDevice(undefined, video, (result, _err, ctl) => {
        controls = ctl;
        if (result) finish(result.getText());
      }).then(() => { msg.textContent = ""; })
        .catch((e) => { msg.textContent = "Camera unavailable — paste the text or upload a photo. " + (e?.message ?? ""); });
    });

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
```

- [ ] **Step 2: Verify nothing depends on a changed signature**

Run: `npx vitest run` and `npm run build:designer`
Expected: full suite PASS, designer build SUCCEEDS (public `scanBarcode()` signature unchanged).

- [ ] **Step 3: Commit**

```bash
git add apps/designer/src/scan.js
git commit -m "feat(designer): paste-first barcode input (paste → upload → camera)"
```

---

### Task 5: Designer flow — scan/paste → parse → preview → autofill

**Files:**
- Modify: `apps/designer/src/form.js`

**Interfaces:**
- Consumes: `parseBCBP`, `bcbpToSemantics` (barrel), `showBcbpPreview` (Task 3), `scanBarcode` (already imported), `suggestDisplayValues` (already imported).
- Behaviour: the Barcode section's scan button decodes/pastes text, tries `parseBCBP`; on success shows the preview and, on Confirm, merges `bcbpToSemantics(parsed)` into `state.semantics`, fills display fields via `suggestDisplayValues(...DESIGNER_SUGGEST_MAP)`, and sets `barcode.message` to the raw scanned text. On parse failure it falls back to today's behaviour (just set `barcode.message`) with a note. The form re-renders so populated fields show.

- [ ] **Step 1: Implement**

Add imports near the top of `apps/designer/src/form.js` (after the existing `scan.js` / `suggest.js` imports):

```js
import { parseBCBP, bcbpToSemantics } from "@wpd/pass-builder/bcbp.js";
import { showBcbpPreview } from "./bcbp-preview.js";
```

Change the scan section descriptor label (the `{ type: "scan", ... }` entry, ~line 50) to:

```js
{ type: "scan", forPath: "barcode.message", label: "📷 Scan / paste boarding pass → autofill flight details" },
```

Replace the `if (f.type === "scan") { ... }` block (~lines 106-122) with:

```js
    if (f.type === "scan") {
      const btn = document.createElement("button");
      btn.type = "button"; btn.textContent = "📷 Scan / paste boarding pass";
      btn.style.cssText = "background:#1a2150;color:#fff;border:none;padding:8px 12px;border-radius:6px;cursor:pointer";
      const note = document.createElement("div");
      note.style.cssText = "font-size:11px;color:#888;margin-top:4px";
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "Scanning…";
        try {
          const text = await scanBarcode();
          if (!text) return;
          setPath(f.forPath, text); // raw barcode is always the message
          let parsed = null;
          try { parsed = parseBCBP(text); } catch { /* not a BCBP barcode */ }
          if (!parsed) { note.textContent = "Set as barcode message (not a recognized boarding pass — fields not autofilled)."; renderForm(root); return; }
          const ok = await showBcbpPreview(parsed);
          if (!ok) { note.textContent = "Barcode message set; autofill cancelled."; renderForm(root); return; }
          const sem = { ...(state.semantics ?? {}), ...bcbpToSemantics(parsed) };
          setPath("semantics", sem);
          const filled = suggestDisplayValues(sem, DESIGNER_SUGGEST_MAP);
          const df = structuredClone(state.displayFields ?? {});
          for (const section of SECTIONS) for (const fld of df[section] ?? []) {
            if (fld.key in filled) { fld.value = filled[fld.key]; delete fld.dateStyle; delete fld.timeStyle; }
          }
          setPath("displayFields", df);
          renderForm(root);
        } finally { btn.disabled = false; btn.textContent = "📷 Scan / paste boarding pass"; }
      });
      fs.appendChild(btn);
      fs.appendChild(note);
      continue;
    }
```

- [ ] **Step 2: Verify**

Run: `npx vitest run` and `npm run build:designer`
Expected: suite PASS, build SUCCEEDS.

- [ ] **Step 3: Manual check**

`npm run dev` → Designer → Barcode → "Scan / paste boarding pass", paste a sample BCBP (`M1DESMARAIS/LUC       EABC123 YULFRAAC 0834 226F001A0025 100`), confirm the preview, and verify semantics + display fields populate and the Message field holds the raw string.

- [ ] **Step 4: Commit**

```bash
git add apps/designer/src/form.js
git commit -m "feat(designer): autofill semantics & fields from scanned boarding pass"
```

---

### Task 6: Issue flow — per-passenger scan → preview → autofill row + barcode message

**Files:**
- Modify: `apps/designer/src/issue.js`
- Test: `tests/issue-template.test.js` (add `buildIssueRequest` barcodeMessage cases)

**Interfaces:**
- Consumes: `parseBCBP`, `bcbpToSemantics`, `showBcbpPreview`, `scanBarcode`, `harvestSemantics`, `suggestDisplayValues`.
- `buildIssueRequest` gains an optional `barcodeMessage` param; when a non-empty (trimmed) string, it is added to `data.barcodeMessage` (the reserved key already handled server-side by `applyTemplateData`). A per-row "Scan / paste boarding pass" button sets `rows[i].semantics` (merged from `bcbpToSemantics`), `rows[i].barcodeMessage` (the raw scan), and fills `rows[i].values` via the row's binding map; then re-renders.

- [ ] **Step 1: Write the failing test**

```js
// add to tests/issue-template.test.js (import buildIssueRequest at top if not already imported)
import { buildIssueRequest } from "../apps/designer/src/issue.js";

describe("buildIssueRequest barcodeMessage", () => {
  it("includes a non-empty barcodeMessage as a reserved data key", () => {
    const req = buildIssueRequest({
      template: "cebpac", groupId: "G1", serial: "S1",
      values: { gate: "B7" }, semantics: {}, barcodeMessage: "M1DESMARAIS/LUC..."
    });
    expect(req.data.barcodeMessage).toBe("M1DESMARAIS/LUC...");
    expect(req.data.gate).toBe("B7");
  });

  it("omits barcodeMessage when blank", () => {
    const req = buildIssueRequest({ template: "t", groupId: "G", serial: "S", values: {}, semantics: {}, barcodeMessage: "  " });
    expect(req.data.barcodeMessage).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/issue-template.test.js`
Expected: FAIL — `req.data.barcodeMessage` is `undefined`.

- [ ] **Step 3: Implement**

Add imports near the top of `apps/designer/src/issue.js` (it already imports `scanBarcode`? confirm — if not, add it):

```js
import { parseBCBP, bcbpToSemantics } from "@wpd/pass-builder/bcbp.js";
import { showBcbpPreview } from "./bcbp-preview.js";
// add the next line only if scanBarcode is not already imported in this file:
import { scanBarcode } from "./scan.js";
```

Extend `buildIssueRequest` (keep the rest of its body identical) to accept and forward `barcodeMessage`:

```js
export function buildIssueRequest({ template, groupId, serial, values, semantics, barcodeMessage }) {
  const data = {};
  for (const [key, raw] of Object.entries(values ?? {})) {
    const v = (raw ?? "").trim();
    if (v) data[key] = v;
  }
  const sem = harvestSemantics(semantics ?? {});
  if (Object.keys(sem).length) data.semantics = sem;
  const bc = (barcodeMessage ?? "").trim();
  if (bc) data.barcodeMessage = bc;
  return { template, serialNumber: (serial ?? "").trim(), groupId: (groupId ?? "").trim(), data };
}
```

In `issueAll`, where each row's request is built (~line 512), add the row's barcode message:

```js
        buildIssueRequest({ template, groupId, serial: rows[i].serial, values, semantics: rows[i].semantics, barcodeMessage: rows[i].barcodeMessage })
```

In `rowHtml`, add a per-row button beside the existing per-row "Suggest values" button (mirror that button's markup; give the new one `data-scan-row="${i}"` and label "📷 Scan / paste boarding pass"). Then, in the same place the per-row suggest-button listeners are wired after render (~lines 585-591), add:

```js
  root.querySelectorAll("[data-scan-row]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = Number(btn.dataset.scanRow);
      syncFromInputs();
      const text = await scanBarcode();
      if (!text) return;
      let parsed = null;
      try { parsed = parseBCBP(text); } catch { /* not BCBP */ }
      if (!parsed) { alert("Not a recognized boarding pass — barcode not autofilled."); return; }
      if (!(await showBcbpPreview(parsed))) return;
      rows[i] = {
        ...rows[i],
        semantics: { ...(rows[i].semantics ?? {}), ...bcbpToSemantics(parsed) },
        barcodeMessage: text
      };
      const map = Object.fromEntries(Object.entries(current()?.bindings ?? {}).map(([sem, b]) => [sem, b.fieldKey]));
      const filled = suggestDisplayValues(rows[i].semantics, map);
      rows[i].values = { ...(rows[i].values ?? {}), ...filled };
      render();
    });
  });
```

NOTE for the implementer: this snippet assumes the file's existing re-render function is `render()`, its current-template accessor is `current()`, and the per-row state-sync is `syncFromInputs()` — confirm these exact names in `issue.js` (the per-row "Suggest values" button uses them) and substitute the real names if they differ. Do not invent new ones.

- [ ] **Step 4: Run tests + verify**

Run: `npx vitest run tests/issue-template.test.js` → PASS, then `npx vitest run` and `npm run build:designer` → PASS / SUCCEEDS.

- [ ] **Step 5: Manual check**

`npm run dev` → Issue → pick a template → per-passenger row → "Scan / paste boarding pass" → paste a sample BCBP → confirm → that row's passenger/seat/route fill and its barcode message is the scanned string. Issue and confirm the built pass carries that barcode.

- [ ] **Step 6: Commit**

```bash
git add apps/designer/src/issue.js tests/issue-template.test.js
git commit -m "feat(issue): per-passenger boarding-pass scan autofill + barcode message"
```

---

## Validation

```bash
npx vitest run                 # full suite green (new: bcbp, bcbp-preview, issue barcodeMessage)
npm run build:designer         # Vite resolves new subpath imports
npm run check                  # fixtures still validate
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| BCBP version variance (v6–v8 field shifts) | Medium | Parse only the fixed-position mandatory header + leg 1; ignore the conditional block. Throw clearly on non-"M" records → caller falls back to raw message. |
| Julian date year wrong near Jan/Dec | Medium | Nearest-year inference across [y-1, y, y+1]; tested at the boundary. Date is preview-only/manual, never auto-applied as a timestamp. |
| Browser PDF417 camera decode unreliable | Medium | Paste is the primary path; photo upload second; camera on-demand. |
| Issue `render()`/`current()`/`syncFromInputs()` accessor names differ | Low | Task says match the existing per-row suggest button's calls; implementer confirms names from issue.js before wiring. |
| Pasted text has stray whitespace/newlines | Low | `parseBCBP` strips surrounding whitespace; positions inside the record preserved. |

## Acceptance

- [ ] `parseBCBP` + `bcbpToSemantics` unit-tested (valid decode, year boundary, bad input, empty-omit).
- [ ] Preview modal resolves true/false and lists detected fields (tested).
- [ ] Paste is the primary scan input; upload + camera still work.
- [ ] Designer: confirmed scan autofills semantics + display fields and sets barcode message.
- [ ] Issue: per-row confirmed scan autofills the row's semantics/values and sets that row's `barcodeMessage` (via the existing reserved key).
- [ ] Full `vitest` suite + `npm run build:designer` + `npm run check` green. No new dependencies.

## Out of scope (separate streams)

- Issue-time barcode **format/altText** controls → the `feat/issue-barcode-controls` plan (already spec'd).
- Flight schedule/gate/terminal lookup → P3, deferred (no free API).

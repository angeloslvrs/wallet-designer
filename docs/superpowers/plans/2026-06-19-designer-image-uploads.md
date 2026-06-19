# Designer Image Uploads (Logo/Icon/Footer/PrimaryLogo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make uploaded images in the Designer (logo + icon + footer + iOS 26 primaryLogo) actually reach the emitted `.pkpass` — fixing the silent-drop bug where an uploaded logo is stored in FormState but never written into the pass bundle.

**Architecture:** A single pure helper (`form-assets.js`) decodes each `branding.*DataUrl` data URL into PNG bytes and emits `<slot>.png` + `<slot>@2x.png` + `<slot>@3x.png` entries. `buildPkpass` overlays those onto the disk-default asset map (uploads win) before signing. The slot↔filename↔label mapping is defined once and shared by the builder and the Designer form (DRY).

**Tech Stack:** Vanilla ESM JavaScript, Node ≥ 24, vitest. No new dependencies.

## Global Constraints

- Node ≥ 24; ESM (`"type": "module"`) vanilla JS — no TypeScript, no frontend framework.
- **No new dependencies** (decided: in-browser canvas resize rejected as YAGNI; bytes written to base+@2x+@3x, dimensions not downscaled — consistent with `ensureBaseImageVariants`' existing policy "no Apple validator enforces image dimensions").
- Immutable updates only — return new objects, never mutate inputs.
- Tests live in `tests/` at repo root; run with `npx vitest run tests/<file>`.
- `npm run check` must still pass (validates `fixtures/*` against `schema.json`).
- Boarding passes support only **logo, icon, footer** images (+ iOS 26 **primaryLogo**). Do NOT add strip / thumbnail / background — Apple boarding passes don't render them.
- Apple image files are **PNG**. Form inputs accept `image/png`.
- Server forces pass identity in `pass-build.js`; image work must not touch the `overrides` path.

---

### Task 1: Pure image-decode helper + shared slot table

**Files:**
- Create: `packages/pass-builder/form-assets.js`
- Modify: `packages/pass-builder/index.js` (add re-export)
- Test: `tests/form-assets.test.js`

**Interfaces:**
- Produces: `BRANDING_IMAGE_SLOTS: Array<{key:string, slot:string, label:string}>` — the single source of truth mapping a FormState `branding` key to its Apple image slot filename and its Designer form label.
- Produces: `imageAssetsFromBranding(branding: object|undefined): Record<string, Buffer>` — for each present `branding[key]` that is a valid `data:image/...;base64,...` URL, returns `{ "<slot>.png": Buffer, "<slot>@2x.png": Buffer, "<slot>@3x.png": Buffer }`. Invalid/empty/missing values are skipped. Never throws; never mutates input.

- [ ] **Step 1: Write the failing test**

```js
// tests/form-assets.test.js
import { describe, it, expect } from "vitest";
import { imageAssetsFromBranding, BRANDING_IMAGE_SLOTS } from "../packages/pass-builder/form-assets.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG signature
const dataUrl = `data:image/png;base64,${PNG.toString("base64")}`;

describe("BRANDING_IMAGE_SLOTS", () => {
  it("covers exactly the boarding-pass image slots (no strip/thumbnail/background)", () => {
    expect(BRANDING_IMAGE_SLOTS.map(s => s.slot).sort())
      .toEqual(["footer", "icon", "logo", "primaryLogo"]);
    for (const s of BRANDING_IMAGE_SLOTS) {
      expect(s.key).toMatch(/DataUrl$/);
      expect(typeof s.label).toBe("string");
    }
  });
});

describe("imageAssetsFromBranding", () => {
  it("decodes one upload into base + @2x + @3x png entries", () => {
    const out = imageAssetsFromBranding({ logoDataUrl: dataUrl });
    expect(out["logo.png"]).toEqual(PNG);
    expect(out["logo@2x.png"]).toEqual(PNG);
    expect(out["logo@3x.png"]).toEqual(PNG);
    expect(Object.keys(out)).toHaveLength(3);
  });

  it("maps each slot independently and ignores empty / non-image values", () => {
    const out = imageAssetsFromBranding({ iconDataUrl: dataUrl, footerDataUrl: "", logoText: "RP" });
    expect(Object.keys(out).sort()).toEqual(["icon.png", "icon@2x.png", "icon@3x.png"]);
  });

  it("ignores a non-data-URL value", () => {
    expect(imageAssetsFromBranding({ logoDataUrl: "https://x/y.png" })).toEqual({});
  });

  it("returns {} for missing / non-object branding", () => {
    expect(imageAssetsFromBranding(undefined)).toEqual({});
    expect(imageAssetsFromBranding({})).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/form-assets.test.js`
Expected: FAIL — `Failed to resolve import "../packages/pass-builder/form-assets.js"`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/pass-builder/form-assets.js
// Single source of truth for the Designer's branding image slots: which
// FormState `branding` key carries each Apple pass image, its on-disk slot
// filename, and the label shown in the Designer form. Imported by both the
// builder (to emit bytes) and apps/designer/src/form.js (to render inputs).
//
// Boarding passes render only logo, icon, footer (+ iOS 26 primaryLogo) — no
// strip/thumbnail/background.

/** @type {Array<{key:string, slot:string, label:string}>} */
export const BRANDING_IMAGE_SLOTS = [
  { key: "logoDataUrl",        slot: "logo",        label: "Logo (top-left)" },
  { key: "iconDataUrl",        slot: "icon",        label: "Icon — lock screen & Mail (required by iOS)" },
  { key: "footerDataUrl",      slot: "footer",      label: "Footer (above the barcode)" },
  { key: "primaryLogoDataUrl", slot: "primaryLogo", label: "Primary logo (iOS 26 expanded view)" }
];

const DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i;

/**
 * Decode every uploaded branding image into PNG bundle entries.
 * Writes identical bytes to base/@2x/@3x (dimensions are not downscaled — iOS
 * scales to fit and no Apple validator enforces image dimensions).
 * @param {object|undefined} branding  FormState.branding
 * @returns {Record<string, Buffer>}  filename → bytes (new object; input untouched)
 */
export function imageAssetsFromBranding(branding) {
  /** @type {Record<string, Buffer>} */
  const out = {};
  if (!branding || typeof branding !== "object") return out;
  for (const { key, slot } of BRANDING_IMAGE_SLOTS) {
    const val = branding[key];
    if (typeof val !== "string" || !val) continue;
    const m = DATA_URL_RE.exec(val.trim());
    if (!m) continue;
    const buf = Buffer.from(m[1].replace(/\s+/g, ""), "base64");
    if (!buf.length) continue;
    out[`${slot}.png`] = buf;
    out[`${slot}@2x.png`] = buf;
    out[`${slot}@3x.png`] = buf;
  }
  return out;
}
```

- [ ] **Step 4: Add re-export to the package barrel**

In `packages/pass-builder/index.js`, after the existing `export { ... } from "./bindings.js";` line (line 11), add:

```js
export { imageAssetsFromBranding, BRANDING_IMAGE_SLOTS } from "./form-assets.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/form-assets.test.js`
Expected: PASS (all 6 assertions).

- [ ] **Step 6: Commit**

```bash
git add packages/pass-builder/form-assets.js packages/pass-builder/index.js tests/form-assets.test.js
git commit -m "feat(pass-builder): decode branding image uploads into pass bundle entries"
```

---

### Task 2: Wire uploads into `buildPkpass` (the bug fix) + integration test

**Files:**
- Modify: `packages/pass-builder/index.js:26-45` (`buildPkpass`)
- Test: `tests/form-assets-build.test.js`

**Interfaces:**
- Consumes: `imageAssetsFromBranding` (Task 1).
- Behaviour change: after loading disk-default assets, `buildPkpass` overlays `imageAssetsFromBranding(state.branding)` so an uploaded logo/icon/footer/primaryLogo wins over the `assets/` default and is included in the signed bundle.

- [ ] **Step 1: Write the failing test**

```js
// tests/form-assets-build.test.js
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import AdmZip from "adm-zip";
import { buildPkpass } from "../packages/pass-builder/index.js";
import { migrateFormState } from "../packages/pass-builder/migrate.js";

const certDir = "certs/dev";

// A 1x1 transparent PNG, distinct from the assets/ default logo bytes.
const UPLOAD = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

let state;
beforeAll(() => {
  if (!existsSync(`${certDir}/signerCert.pem`)) {
    throw new Error("dev cert missing — run `npm run init` first");
  }
  state = migrateFormState(JSON.parse(readFileSync("fixtures/fully-loaded.json", "utf8")));
});

describe("buildPkpass image uploads", () => {
  it("emits the uploaded logo bytes as logo.png/@2x/@3x in the .pkpass", async () => {
    const withLogo = { ...state, branding: { ...state.branding, logoDataUrl: `data:image/png;base64,${UPLOAD.toString("base64")}` } };
    const pkpass = await buildPkpass({ state: withLogo, certDir });
    const zip = new AdmZip(pkpass);
    const names = zip.getEntries().map(e => e.entryName);
    expect(names).toContain("logo.png");
    expect(names).toContain("logo@2x.png");
    expect(names).toContain("logo@3x.png");
    expect(zip.getEntry("logo.png").getData().equals(UPLOAD)).toBe(true);
  });

  it("falls back to disk assets when no upload is present", async () => {
    const pkpass = await buildPkpass({ state, certDir });
    const names = new AdmZip(pkpass).getEntries().map(e => e.entryName);
    expect(names).toContain("icon.png"); // from assets/
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/form-assets-build.test.js`
Expected: FAIL — `expect(names).toContain("logo.png")` (or the bytes-equal assertion) fails, because `buildPkpass` never reads `branding.logoDataUrl` and `assets/` has no `logo@3x.png`.

- [ ] **Step 3: Write minimal implementation**

In `packages/pass-builder/index.js`, add the import near the top of the file (after the `signPkpass` import on line 4):

```js
import { imageAssetsFromBranding } from "./form-assets.js";
```

Replace lines 38-44 (the asset-load block through the `return`) with:

```js
  const assetNames = ["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png"];
  /** @type {Record<string,Buffer>} */
  const assets = {};
  for (const name of assetNames) {
    try { assets[name] = await readFile(join(assetsDir, name)); } catch { /* optional */ }
  }
  // Uploaded branding images (logo/icon/footer/primaryLogo) win over the disk
  // defaults — without this the designer's uploaded logo was silently dropped.
  Object.assign(assets, imageAssetsFromBranding(state.branding));
  return signPkpass({ certDir, passphrase, passJson, assets });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/form-assets-build.test.js`
Expected: PASS (both cases).

- [ ] **Step 5: Run the full builder suite for regressions**

Run: `npx vitest run tests/manifest.test.js tests/template-load-build.test.js tests/form-to-pass.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/pass-builder/index.js tests/form-assets-build.test.js
git commit -m "fix(pass-builder): include uploaded branding images in built .pkpass"
```

---

### Task 3: Extend FormState schema + typedef for the new image slots

**Files:**
- Modify: `packages/pass-schema/schema.json:26-32` (branding properties)
- Modify: `packages/pass-schema/index.js:17` (FormState typedef)
- Test: `tests/branding-images-schema.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: a FormState whose `branding` may carry `iconDataUrl`, `footerDataUrl`, `primaryLogoDataUrl` (all optional strings) passes `validate()`. (`logoDataUrl` already allowed.) Required because `branding` is `additionalProperties: false`.

- [ ] **Step 1: Write the failing test**

```js
// tests/branding-images-schema.test.js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validate } from "../packages/pass-builder/validate.js";
import { migrateFormState } from "../packages/pass-builder/migrate.js";

const base = () => migrateFormState(JSON.parse(readFileSync("fixtures/fully-loaded.json", "utf8")));

describe("branding image fields", () => {
  it("accepts iconDataUrl / footerDataUrl / primaryLogoDataUrl", () => {
    const state = base();
    state.branding = {
      ...state.branding,
      iconDataUrl: "data:image/png;base64,iVB",
      footerDataUrl: "data:image/png;base64,iVB",
      primaryLogoDataUrl: "data:image/png;base64,iVB"
    };
    const v = validate(state);
    expect(v.ok).toBe(true);
  });

  it("still rejects an unknown branding property", () => {
    const state = base();
    state.branding = { ...state.branding, bogusDataUrl: "x" };
    expect(validate(state).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/branding-images-schema.test.js`
Expected: FAIL — first case `v.ok` is `false` (`additionalProperties` rejects `iconDataUrl`).

- [ ] **Step 3: Write minimal implementation**

In `packages/pass-schema/schema.json`, replace the `logoDataUrl` line (line 31) with:

```json
        "logoDataUrl": { "type": "string" },
        "iconDataUrl": { "type": "string" },
        "footerDataUrl": { "type": "string" },
        "primaryLogoDataUrl": { "type": "string" }
```

In `packages/pass-schema/index.js`, replace the `branding` typedef line (line 17) with:

```js
 * @property {{logoText:string, foregroundColor:string, backgroundColor:string, labelColor:string, logoDataUrl?:string, iconDataUrl?:string, footerDataUrl?:string, primaryLogoDataUrl?:string}} branding
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/branding-images-schema.test.js`
Expected: PASS (both cases).

- [ ] **Step 5: Confirm fixtures still validate**

Run: `npm run check`
Expected: exit 0 (no fixture regressions).

- [ ] **Step 6: Commit**

```bash
git add packages/pass-schema/schema.json packages/pass-schema/index.js tests/branding-images-schema.test.js
git commit -m "feat(pass-schema): allow icon/footer/primaryLogo branding image fields"
```

---

### Task 4: Designer form — upload slots for all images + visual confirmation

**Files:**
- Modify: `apps/designer/src/form.js:1-5` (import), `:44-46` (Assets section), `:72-89` (file input renderer)
- Test: `tests/form-assets-ui.test.js`

**Interfaces:**
- Consumes: `BRANDING_IMAGE_SLOTS` (Task 1).
- Behaviour: the Assets fieldset renders one `image/png` file input per slot; once a value is set, a thumbnail `<img>` of the upload is shown (replacing the old logo-only text note) so the user sees the upload took.

- [ ] **Step 1: Write the failing test**

```js
// tests/form-assets-ui.test.js
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { BRANDING_IMAGE_SLOTS } from "../packages/pass-builder/form-assets.js";

describe("Designer asset slots", () => {
  it("exposes a form path for every builder image slot", () => {
    // form.js builds Assets inputs from BRANDING_IMAGE_SLOTS, so the contract
    // is: every slot the builder can emit has a matching branding.<key> path.
    const paths = BRANDING_IMAGE_SLOTS.map(s => `branding.${s.key}`);
    expect(paths).toContain("branding.logoDataUrl");
    expect(paths).toContain("branding.iconDataUrl");
    expect(paths).toContain("branding.footerDataUrl");
    expect(paths).toContain("branding.primaryLogoDataUrl");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/form-assets-ui.test.js`
Expected: FAIL — import resolves only after Task 1 is merged; if running this task in isolation it passes once `form-assets.js` exists. (If green immediately because Task 1 landed, that is expected — the behavioural change is verified manually in Step 5.)

- [ ] **Step 3: Implement the form changes**

In `apps/designer/src/form.js`, add the import near the top (after line 4):

```js
import { BRANDING_IMAGE_SLOTS } from "@wpd/pass-builder/form-assets.js";
```

Replace the static `"Assets"` section (lines 44-46) with a generated one:

```js
  ["Assets", BRANDING_IMAGE_SLOTS.map(s => ({ path: `branding.${s.key}`, label: s.label, type: "file" }))],
```

Replace the file-input block (lines 72-89) with:

```js
    if (f.type === "file") {
      const input = document.createElement("input");
      input.type = "file"; input.accept = "image/png";
      input.addEventListener("change", e => {
        const file = e.target.files?.[0];
        if (!file) { setPath(f.path, ""); return; }
        const reader = new FileReader();
        reader.onload = () => setPath(f.path, reader.result);
        reader.readAsDataURL(file);
      });
      fs.appendChild(input);
      const cur = getPath(f.path);
      if (cur) {
        const note = document.createElement("div");
        note.style.cssText = "font-size:11px;color:#888;margin-top:2px;display:flex;align-items:center;gap:8px";
        if (typeof cur === "string" && cur.startsWith("data:image/")) {
          const img = document.createElement("img");
          img.src = cur; img.alt = f.label;
          img.style.cssText = "height:28px;max-width:120px;object-fit:contain;background:#fff;border:1px solid #ddd;border-radius:4px;padding:2px";
          note.appendChild(img);
        }
        const span = document.createElement("span");
        span.textContent = "✓ set (choose a new file to replace)";
        note.appendChild(span);
        fs.appendChild(note);
      }
      continue;
    }
```

- [ ] **Step 4: Run the UI test + full suite**

Run: `npx vitest run tests/form-assets-ui.test.js && npx vitest run`
Expected: PASS (whole suite green).

- [ ] **Step 5: Manual verification in the running app**

```bash
npm run dev
```
Then in the Designer: open the Assets section, upload a PNG to each of Logo / Icon / Footer / Primary logo, confirm a thumbnail appears under each input. Build/issue a pass and confirm via `out/*.pkpass` (unzip) that `logo.png`, `icon.png`, `footer.png`, `primaryLogo.png` carry the uploaded bytes.

- [ ] **Step 6: Commit**

```bash
git add apps/designer/src/form.js tests/form-assets-ui.test.js
git commit -m "feat(designer): upload slots for logo/icon/footer/primaryLogo with thumbnail preview"
```

---

## Validation

```bash
npx vitest run                       # full unit/integration suite green
npm run check                        # fixtures validate against schema
npm run build:pass -- --in fixtures/fully-loaded.json   # headless build smoke
# then: unzip out/*.pkpass and confirm logo.png is present
npm run validate:apple               # Apple structural validator (CI gate)
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Non-PNG upload (SVG/JPEG) written as `.png` → iOS rejects | Low | Inputs set `accept="image/png"`; helper only emits bytes verbatim. Future: validate PNG magic bytes. |
| `primaryLogo` not rendered pre-iOS 26 / repo comment says "iOS never renders" | Medium | Harmless if ignored by older iOS; verify on an iOS 26 device. Slot is opt-in (only emitted when uploaded). |
| `fixtures/fully-loaded.json` drifts from schema and breaks the build test | Low | Test runs `migrateFormState` first; `npm run check` guards the fixture. |
| Integration test needs `certs/dev` | Low | `beforeAll` throws a clear "run `npm run init`" message; CI runs init. |

## Acceptance

- [ ] Uploaded logo/icon/footer/primaryLogo appear in the built `.pkpass` (Task 2 integration test proves it).
- [ ] New branding fields validate; unknown ones still rejected (Task 3).
- [ ] Designer shows an input + thumbnail per image slot (Task 4).
- [ ] Full `vitest` suite, `npm run check`, and `validate:apple` all green.
- [ ] No new dependencies added.

## Subsequent phases (separate plans)

- **P2 — Scan → structured autofill:** `scan.js` (zxing camera+photo decode) already exists and fills `barcode.message` raw. P2 adds a BCBP/IATA-792 parser, a paste-raw-string input (priority), maps parsed fields → semantics + display-field suggestions, and wires scanning into the Issue per-passenger flow. Folds in the already-spec'd issue-time barcode-format controls (`docs/superpowers/specs/2026-06-13-issue-time-barcode-controls-design.md`).
- **P3 — Flight lookup:** deferred — no flight API offers gate/terminal/scheduled-times by flight#+date on a free tier. Schedule/gate/terminal stay manual entry; leave a provider seam for later.

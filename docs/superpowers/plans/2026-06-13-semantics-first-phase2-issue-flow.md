# Semantics-first Phase 2 — Issue-flow inversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Issue (template) flow semantics-first: the user edits **typed semantics** as the primary surface, a **"Suggest values"** button fills the display fields from them, and the **server stops deriving semantics from field values** — accepting explicit semantics instead. This fixes the cebpac mis-binding (garbage `departureAirportCode: "12:15"`, non-ISO dates) and gives the Issue flow real typed inputs (the date picker you wanted).

**Architecture:** Builds on Phase 1's shared units (`SEMANTIC_CATALOG`, `REQUIRED_SEMANTICS`, `renderTypedInput`, `suggestDisplayValues`, `isEmptyTyped` — all in `@wpd/pass-builder` + `apps/designer/src/inputs.js`, already on `main`). The template's own `semantics` block becomes the editor's initial values; the editor emits **filled-only**; the server merges explicit semantics + clears volatile placeholders the user left unset.

**Tech Stack:** Vanilla ESM JS, vitest, happy-dom, Express. No new dependencies.

**Out of scope:** the Designer/FormState rework + `migrateFormState` — that's Phase 3.

---

### Task 1: Templates list exposes the template's baked semantics

The client editor pre-fills from the template's own `semantics`. Add it to the templates list response.

**Files:**
- Modify: `apps/server/src/routes/templates.js` (list handler, ~line 33-35)
- Test: `tests/template-semantics-list.test.js` (new)

- [ ] **Step 1: Write the failing test** (mirrors the harness in `tests/issue-semantics.test.js`)

`tests/template-semantics-list.test.js`:
```js
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";

let handleTemplateUpload, handleTemplateList;
const PASS_JSON = JSON.stringify({
  formatVersion: 1, passTypeIdentifier: "pass.dev.placeholder", description: "Boarding pass",
  boardingPass: { headerFields: [{ key: "gate", label: "GATE", value: "B7" }] },
  semantics: { airlineCode: "RP", departureGate: "B7" }
});
function zipOf(entries) { const z = new AdmZip(); for (const [n, c] of Object.entries(entries)) z.addFile(n, Buffer.from(c)); return z.toBuffer(); }
function mkRes() { return { statusCode: 0, payload: null, status(c){this.statusCode=c;return this;}, json(o){this.payload=o;return this;} }; }

beforeAll(async () => {
  process.env.TEMPLATES_DIR = await mkdtemp(join(tmpdir(), "wpd-tpl-sem-"));
  process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-state-sem-")), "passes.json");
  ({ handleTemplateUpload, handleTemplateList } = await import("../apps/server/src/routes/templates.js"));
  const res = mkRes();
  await handleTemplateUpload({ params: { id: "sem" }, body: zipOf({ "pass.json": PASS_JSON, "icon.png": "x" }) }, res);
  expect(res.statusCode).toBe(201);
});

describe("templates list", () => {
  it("includes each template's baked semantics", async () => {
    const res = mkRes();
    await handleTemplateList({}, res);
    const tpl = res.payload.find(t => t.id === "sem");
    expect(tpl.semantics).toEqual({ airlineCode: "RP", departureGate: "B7" });
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run tests/template-semantics-list.test.js` (either `handleTemplateList` isn't exported, or `tpl.semantics` is undefined).

- [ ] **Step 3: Implement.** In `apps/server/src/routes/templates.js`:
  - Ensure the list handler is exported as a named function `handleTemplateList` (if the route is currently an inline arrow `templatesRouter.get("/templates", …)`, extract it to `export async function handleTemplateList(req, res) { … }` and reference it in the route — mirror how `handleTemplateUpload` is structured).
  - In the per-template object (currently `{ id, fieldKeys: …, bindings: …, assets: … }` around line 33-35), add: `semantics: passJson.semantics ?? {},`.

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Full suite** — `npm test` (no regression).

- [ ] **Step 6: Commit**
```bash
git add apps/server/src/routes/templates.js tests/template-semantics-list.test.js
git commit -m "feat(templates): expose each template's baked semantics in the list response"
```

---

### Task 2: Invert issue-time semantics — accept explicit, stop deriving from fields

`issueTemplatePass` (apps/server/src/routes/admin.js) currently derives semantics from display-field values via `deriveIssueSemantics(data, bindings, …)`. Replace that with: use the explicit `data.semantics` the client now sends; still clear volatile placeholders the user did not set. Bindings stay (status path still uses them) but are no longer used at issue time.

**Files:**
- Modify: `apps/server/src/routes/admin.js` (imports line ~12; `issueTemplatePass` lines ~95-110)
- Modify (rewrite expectations): `tests/issue-semantics.test.js`
- Check/adjust: `tests/issue-cebpac.test.js` (if it asserts field-derived semantics)

- [ ] **Step 1: Rewrite the test to the new contract.** Replace the body of `tests/issue-semantics.test.js`'s `describe` with:
```js
describe("issueTemplatePass — explicit semantics, no field derivation", () => {
  it("stores the explicit semantics the client sends, untouched", async () => {
    await issueTemplatePass({
      template: "iss", serialNumber: "ISS-001", groupId: "ISS@2026-07-01",
      data: {
        passenger: "Ada Lovelace", seat: "14F", gate: "B9",
        semantics: {
          passengerName: { givenName: "Ada", familyName: "Lovelace" },
          seats: [{ seatRow: "14", seatNumber: "F" }],
          departureGate: "B9", confirmationNumber: "ZZTOP1"
        }
      }
    });
    const rec = await getPassRecord("ISS-001");
    expect(rec.data.semantics).toEqual({
      passengerName: { givenName: "Ada", familyName: "Lovelace" },
      seats: [{ seatRow: "14", seatNumber: "F" }],
      departureGate: "B9", confirmationNumber: "ZZTOP1",
      // volatile placeholders in the template the client did NOT set are cleared:
      originalBoardingDate: null, currentBoardingDate: null
    });
  });

  it("does NOT derive semantics from display fields (the cebpac bug)", async () => {
    await issueTemplatePass({
      template: "iss", serialNumber: "ISS-005", groupId: "ISS@2026-07-01",
      data: { gate: "12:15", seat: "67C" }   // raw fields, no data.semantics
    });
    const rec = await getPassRecord("ISS-005");
    // no field translated into a semantic; only volatile placeholders cleared
    expect(rec.data.semantics.departureGate).toBeUndefined();
    expect(rec.data.semantics).toEqual({
      passengerName: null, seats: null, originalBoardingDate: null, currentBoardingDate: null
    });
  });

  it("clears all volatile placeholders when no semantics provided", async () => {
    await issueTemplatePass({ template: "iss", serialNumber: "ISS-003", groupId: "ISS@2026-07-01", data: {} });
    const rec = await getPassRecord("ISS-003");
    expect(rec.data.semantics).toEqual({
      currentBoardingDate: null, originalBoardingDate: null, passengerName: null, seats: null
    });
    const merged = applyTemplateData(JSON.parse(PASS_JSON), rec.data);
    expect(merged.semantics.passengerName).toBeUndefined();
    expect(merged.semantics.confirmationNumber).toBe("GHK2X9");   // non-volatile template semantic survives
  });
});
```
(Keep the imports/`beforeAll`/`PASS_JSON`/helpers at the top of the file as-is.)

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run tests/issue-semantics.test.js` (old derivation still runs).

- [ ] **Step 3: Implement the inversion.** In `apps/server/src/routes/admin.js`:
  - Remove `deriveIssueSemantics` from the import on line ~12 (keep `applyStatusToTemplateData, normalizeStatusBody, transitStatusDisplay, VOLATILE_ISSUE_SEMANTICS`).
  - In `issueTemplatePass`, replace lines ~102-109:
```js
  const bindings = await bindingsForTemplate(template, passJson);
  const derived = deriveIssueSemantics(data, bindings, passJson.semantics ?? {});
  const clears = {};
  for (const k of VOLATILE_ISSUE_SEMANTICS) {
    if (passJson.semantics?.[k] !== undefined) clears[k] = null;
  }
  const semantics = { ...clears, ...derived, ...data.semantics };
  const stored = Object.keys(semantics).length ? { ...data, semantics } : data;
```
  with:
```js
  // Semantics-first: the client sends explicit `data.semantics` (filled-only,
  // typed via SEMANTIC_CATALOG). The server NEVER derives semantics from display
  // fields — that mis-mapped time fields onto airport codes and shipped non-ISO
  // dates. Volatile placeholders the user left unset are cleared (null deletes at
  // merge), so the template's sample values never ship.
  const explicit = (data.semantics && typeof data.semantics === "object") ? data.semantics : {};
  const clears = {};
  for (const k of VOLATILE_ISSUE_SEMANTICS) {
    if (passJson.semantics?.[k] !== undefined && explicit[k] === undefined) clears[k] = null;
  }
  const semantics = { ...clears, ...explicit };
  const stored = Object.keys(semantics).length ? { ...data, semantics } : data;
```
  (`deriveIssueSemantics` in `template-status.js` is now unused by the issue path; leave it exported — `template-status.js` tests may still cover it — or delete it + its test if nothing references it. Verify with `grep -rn deriveIssueSemantics`.)

- [ ] **Step 4: Run it, expect PASS** — `npx vitest run tests/issue-semantics.test.js`.

- [ ] **Step 5: Reconcile `tests/issue-cebpac.test.js`.** Run `npx vitest run tests/issue-cebpac.test.js`. If it asserted field-derived semantics, update those expectations to pass explicit `data.semantics` (or assert the no-derivation contract). Show the diff before changing.

- [ ] **Step 6: Full suite** — `npm test`. Fix any other test that depended on derivation. If `deriveIssueSemantics` is now unreferenced, remove it and its test file in this commit.

- [ ] **Step 7: Commit**
```bash
git add apps/server/src/routes/admin.js apps/server/src/template-status.js tests/issue-semantics.test.js tests/issue-cebpac.test.js
git commit -m "feat(issue): accept explicit semantics; stop deriving them from display fields"
```

---

### Task 3: Semantics editor component

A reusable editor: typed inputs for the **required** semantics (always shown), plus a grouped **"+ add semantic"** picker for optionals. Emits **filled-only**. State-in / change-out (no internal persistence).

**Files:**
- Create: `apps/designer/src/semantics-editor.js`
- Create: `tests/semantics-editor.test.js`

- [ ] **Step 1: Write the failing test** (happy-dom)

`tests/semantics-editor.test.js`:
```js
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderSemanticsEditor, harvestSemantics } from "../apps/designer/src/semantics-editor.js";

describe("renderSemanticsEditor", () => {
  it("renders an input for every required semantic, seeded from initial values", () => {
    const el = renderSemanticsEditor({ values: { airlineCode: "RP", passengerName: { givenName: "A", familyName: "B" } }, onChange() {} });
    document.body.appendChild(el);
    expect(el.querySelector('[data-sem="airlineCode"]')).toBeTruthy();
    expect(el.querySelector('[data-sem="passengerName"]')).toBeTruthy();
    // a required date semantic is present with the datetime widget
    expect(el.querySelector('[data-sem="originalBoardingDate"] input[type="datetime-local"]')).toBeTruthy();
  });
});

describe("harvestSemantics", () => {
  it("returns only filled values (drops empty optionals), keeping typed shapes", () => {
    const values = {
      airlineCode: "RP", flightNumber: 247,
      passengerName: { givenName: "Ada", familyName: "Lovelace" },
      seats: [{ seatRow: "14", seatNumber: "F" }],
      departureGate: "",                 // empty optional -> dropped
      internationalDocumentsAreVerified: false   // boolean false is real -> kept
    };
    expect(harvestSemantics(values)).toEqual({
      airlineCode: "RP", flightNumber: 247,
      passengerName: { givenName: "Ada", familyName: "Lovelace" },
      seats: [{ seatRow: "14", seatNumber: "F" }],
      internationalDocumentsAreVerified: false
    });
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** `apps/designer/src/semantics-editor.js`:
```js
import { SEMANTIC_CATALOG, REQUIRED_SEMANTICS, isEmptyTyped } from "@wpd/pass-builder";
import { renderTypedInput } from "./inputs.js";

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

/** Drop empty values (emit-only-filled); keep typed shapes and real falsey values. */
export function harvestSemantics(values = {}) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    const type = SEMANTIC_CATALOG[k]?.type ?? "text";
    if (!isEmptyTyped(type, v)) out[k] = v;
  }
  return out;
}

/**
 * Render the semantics editor.
 * @param {{values:Record<string,*>, onChange:(values:Record<string,*>)=>void}} opts
 *   `values` is the working object; a fresh copy is passed to onChange on each edit.
 */
export function renderSemanticsEditor({ values = {}, onChange }) {
  const wrap = el("div", { className: "sem-editor" });
  const state = { ...values };
  const shown = new Set([...REQUIRED_SEMANTICS, ...Object.keys(values)]);

  const fieldRow = (key) => {
    const { type, label, required, enumOptions } = SEMANTIC_CATALOG[key];
    const row = el("div", { className: "sem-row" });
    row.dataset.sem = key;
    const lbl = el("label", { textContent: label + (required ? " *" : "") });
    const input = renderTypedInput({
      type, value: state[key], enumOptions,
      onChange: (v) => { state[key] = v; onChange?.({ ...state }); }
    });
    row.append(lbl, input);
    return row;
  };

  const body = el("div", { className: "sem-body" });
  for (const key of [...shown].filter(k => SEMANTIC_CATALOG[k])) body.append(fieldRow(key));

  // "+ add semantic" picker for catalog keys not yet shown, grouped.
  const picker = el("select");
  picker.append(el("option", { value: "", textContent: "+ add semantic…" }));
  for (const [key, { label, group }] of Object.entries(SEMANTIC_CATALOG)) {
    if (shown.has(key)) continue;
    picker.append(el("option", { value: key, textContent: `${group} · ${label}` }));
  }
  picker.addEventListener("change", () => {
    const key = picker.value; if (!key) return;
    shown.add(key); body.append(fieldRow(key));
    picker.querySelector(`option[value="${key}"]`)?.remove();
    picker.value = "";
  });

  wrap.append(body, picker);
  return wrap;
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Full suite** — `npm test`.

- [ ] **Step 6: Commit**
```bash
git add apps/designer/src/semantics-editor.js tests/semantics-editor.test.js
git commit -m "feat(designer): typed semantics editor (required + add-optional, emit filled-only)"
```

---

### Task 4: Wire the semantics editor into the Issue flow (integration)

Make each passenger row semantics-first: a **Semantics** section (the editor, seeded from the template's baked semantics from Task 1) + the existing **display-field** inputs now rendered by `renderTypedInput` typed by each field's *bound* semantic + a **"Suggest values"** button (`suggestDisplayValues(rowSemantics, bindingMap)`), and send `data.semantics` in the issue payload. The shared↔per-passenger toggle (already built) applies to the semantics editor too.

**Files:**
- Modify: `apps/designer/src/issue.js` (state: add per-row + shared `semantics`; render: mount the editor + typed fields + Suggest button; `buildIssueRequest`: carry `semantics`; `issueAll`: send it; `load`: keep `current().semantics` + `current().bindings`)
- Modify: `apps/designer/src/styles.css` (`.sem-editor`, `.sem-row` minimal layout)
- Test: `tests/issue-template.test.js` (extend `buildIssueRequest` cases)

- [ ] **Step 1: Failing unit test for the payload shape.** Add to `tests/issue-template.test.js`:
```js
describe("buildIssueRequest with semantics", () => {
  it("includes a filled semantics object and trims empty field values", () => {
    const req = buildIssueRequest({
      template: "cebpac", groupId: "5J@2026-06-13", serial: "X-1",
      values: { gate: "B7", term: "" },
      semantics: { airlineCode: "5J", departureGate: "" }
    });
    expect(req).toEqual({
      template: "cebpac", serialNumber: "X-1", groupId: "5J@2026-06-13",
      data: { gate: "B7", semantics: { airlineCode: "5J" } }
    });
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run tests/issue-template.test.js` (`buildIssueRequest` ignores `semantics`).

- [ ] **Step 3: Update `buildIssueRequest`** (apps/designer/src/issue.js ~line 42) to accept and attach filled-only semantics:
```js
import { harvestSemantics } from "./semantics-editor.js";
// ...
export function buildIssueRequest({ template, groupId, serial, values, semantics }) {
  const data = {};
  for (const [key, raw] of Object.entries(values ?? {})) {
    const v = (raw ?? "").trim();
    if (v) data[key] = v;
  }
  const sem = harvestSemantics(semantics ?? {});
  if (Object.keys(sem).length) data.semantics = sem;
  return { template, serialNumber: (serial ?? "").trim(), groupId: (groupId ?? "").trim(), data };
}
```

- [ ] **Step 4: Run it, expect PASS** — `npx vitest run tests/issue-template.test.js`.

- [ ] **Step 5: Wire the UI (browser-verified; no unit test for the DOM wiring, consistent with prior phases).** In `apps/designer/src/issue.js`:
  - Per-row state gains `semantics: {}` (plus a shared `tripSemantics: {}` for the shared toggle, mirroring the existing `shared`/`individualKeys`).
  - Seed a row's semantics from `current().semantics` (the template's baked block, now in the templates list) the first time a template is selected (in `ensureFieldDefaults`).
  - In render, before the display-field inputs, mount `renderSemanticsEditor({ values: row.semantics, onChange: next => { row.semantics = next; } })` into a per-row container; render the display-field inputs via `renderTypedInput` typed by the field's bound semantic — build a reverse map `fieldKey → semanticKey` from `current().bindings`, then `SEMANTIC_CATALOG[sem]?.type ?? "text"`.
  - Add a per-row **"Suggest values"** button → `const map = Object.fromEntries(Object.entries(current().bindings).map(([sem, b]) => [sem, b.fieldKey])); Object.assign(row.values, suggestDisplayValues(row.semantics, map));` then re-render that row's field inputs.
  - `issueAll` passes `semantics` (shared trip semantics overlaid with the per-row semantics) into `buildIssueRequest`.
  - Imports: `renderSemanticsEditor` from `./semantics-editor.js`; `suggestDisplayValues`, `SEMANTIC_CATALOG` from `@wpd/pass-builder`; `renderTypedInput` from `./inputs.js`.

- [ ] **Step 6: Add minimal CSS** to `apps/designer/src/styles.css`:
```css
.sem-editor { border: 1px solid #ececf2; border-radius: 8px; padding: 8px; margin: 6px 0; }
.sem-row { display: flex; gap: 8px; align-items: center; margin: 3px 0; }
.sem-row label { flex: 0 0 170px; font-size: 12px; color: #444; }
.sem-row .typed-input { flex: 1; display: flex; gap: 6px; }
.sem-editor > select { margin-top: 6px; font-size: 12px; }
```

- [ ] **Step 7: Build + browser-verify.** `npm run build:designer`, then serve `apps/designer/dist` and (via chrome-devtools-axi) load the Issue view with a stubbed `/api/templates` (one template whose `semantics` has `airlineCode`/`originalBoardingDate` and `bindings` map a date semantic to a `boardingTime` field). Confirm: the Semantics section renders typed inputs (date → datetime-local), "Suggest values" fills `boardingTime`, required fields are marked `*`. Capture a screenshot.

- [ ] **Step 8: Full suite + commit**
```bash
npm test
git add apps/designer/src/issue.js apps/designer/src/styles.css tests/issue-template.test.js
git commit -m "feat(issue): semantics-first row editor + typed display fields + Suggest values"
```

---

## Self-review notes
- **Spec coverage (Phase 2):** typed semantics editor as primary surface (Tasks 3 + 4) ✓; typed display fields by bound semantic (Task 4) ✓; Suggest button (Task 4) ✓; explicit-semantics payload + server stops deriving + emit-only-filled (Task 2 + client harvest) ✓; template baked semantics surfaced for pre-fill (Task 1) ✓; shared↔per-passenger on semantics (Task 4) ✓.
- **Type consistency:** `harvestSemantics`, the editor, and Suggest all key off `SEMANTIC_CATALOG` types and `isEmptyTyped`, shared with Phase 1.
- **Risk:** Task 4 is the integration task — DOM wiring is browser-verified (the repo has no unit tests for `issue.js`'s DOM, consistent with prior phases). The pure parts (`buildIssueRequest`, `harvestSemantics`) are unit-tested.
- **Open item:** `REQUIRED_SEMANTICS` is still the Phase-1 seed; once a pass is built end-to-end here, run `buildpass validate` against it and tighten the required set if the validator demands more/less.

# Pass Expiry + Relevant-Date Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop passes from expiring early, and give every emitted pass a correct, intentional expiry. Root cause (confirmed): boarding passes carry a hand-entered/stale `relevantDate` (e.g. `2026-06-15`) and **no `expirationDate`**, so Apple Wallet buckets them into "Expired" once that relevant date passes — even when the flight is months away.

**Architecture:** One pure transform `applyPassDates(passJson, {expirationDate})` derives both dates from the pass's own flight semantics and is applied to the final `pass.json` in BOTH build paths (FormState via `formStateToPassJson`, template via `buildPkpassFromTemplate`). `relevantDate` ← `currentBoardingDate ?? currentDepartureDate` (and the stale `relevantDates` array is dropped); `expirationDate` ← a custom value if given, else **arrival + 1 day**. Customizable in the Designer (FormState `meta.expirationDate`) and at issue time (template reserved key `expirationDate`); empty everywhere = arrival + 1.

**Tech Stack:** Vanilla ESM JS, Node ≥24, vitest. No new dependencies.

## Global Constraints

- Node ≥24; ESM vanilla JS — no TypeScript, no framework. **No new dependencies.**
- Immutable updates only — `applyPassDates` returns a new object; never mutates inputs.
- Dates are ISO 8601 strings; **preserve the source's UTC offset** when adding a day (same wall-clock next day, e.g. `…T17:55:00+08:00` → next day `…T17:55:00+08:00`). Do NOT round-trip through epoch/local time.
- Boarding-pass semantic date keys (from `packages/pass-builder/semantics.js`): `currentDepartureDate`, `currentBoardingDate`, `currentArrivalDate`, and their `original*` twins.
- Derivation reads `semantics`; expiry/relevance therefore track gate/delay status pushes automatically (those edit the semantics, and the pass is rebuilt through these same paths).
- Server-controlled identity (`OVERRIDE_KEYS` in `template.js`, `overrides` in `buildPkpass`) must NOT be touched by this work.
- Tests in `tests/` at repo root; run `npx vitest run tests/<file>`.

---

### Task 1: Pure date-derivation transform (`expiry.js`)

**Files:**
- Create: `packages/pass-builder/expiry.js`
- Modify: `packages/pass-builder/index.js` (re-export)
- Test: `tests/expiry.test.js`

**Interfaces:**
- Produces: `addDaysPreservingOffset(iso: string, days: number): string|undefined` — adds whole days to the date portion of an ISO datetime, keeping the time-of-day and UTC offset (or `Z`) intact; returns `undefined` for unparseable input.
- Produces: `applyPassDates(passJson: object, opts?: {expirationDate?: string}): object` — returns a NEW pass.json with: `relevantDate` set from `semantics.currentBoardingDate ?? currentDepartureDate ?? originalBoardingDate ?? originalDepartureDate` (and the stale `relevantDates` array deleted) when a flight date exists; `expirationDate` set to a valid `opts.expirationDate` if given, else `addDaysPreservingOffset(currentArrivalDate ?? originalArrivalDate ?? currentDepartureDate ?? originalDepartureDate, 1)`. Leaves the pass untouched where no source date exists. Never mutates input.

- [ ] **Step 1: Write the failing test**

```js
// tests/expiry.test.js
import { describe, it, expect } from "vitest";
import { addDaysPreservingOffset, applyPassDates } from "../packages/pass-builder/expiry.js";

describe("addDaysPreservingOffset", () => {
  it("adds a day keeping wall-clock time + offset", () => {
    expect(addDaysPreservingOffset("2026-08-28T17:55:00+08:00", 1)).toBe("2026-08-29T17:55:00+08:00");
  });
  it("handles month/year rollover and Z", () => {
    expect(addDaysPreservingOffset("2026-12-31T23:00:00Z", 1)).toBe("2027-01-01T23:00:00Z");
  });
  it("handles naive (offset-less) ISO and HH:MM-only time", () => {
    expect(addDaysPreservingOffset("2026-08-28T15:45", 1)).toBe("2026-08-29T15:45:00");
  });
  it("returns undefined for junk", () => {
    expect(addDaysPreservingOffset("nope", 1)).toBeUndefined();
  });
});

describe("applyPassDates", () => {
  const base = () => ({
    serialNumber: "PAL",
    semantics: {
      currentBoardingDate: "2026-08-28T15:50:00+08:00",
      currentDepartureDate: "2026-08-28T16:35:00+08:00",
      currentArrivalDate: "2026-08-28T17:55:00+08:00"
    },
    relevantDates: [{ date: "2026-06-15T05:00:00+08:00", relevantDate: "2026-06-15T05:00:00+08:00" }] // the stale bug value
  });

  it("derives relevantDate from boarding and DROPS the stale relevantDates", () => {
    const out = applyPassDates(base());
    expect(out.relevantDate).toBe("2026-08-28T15:50:00+08:00");
    expect(out.relevantDates).toBeUndefined();
  });

  it("defaults expirationDate to arrival + 1 day", () => {
    expect(applyPassDates(base()).expirationDate).toBe("2026-08-29T17:55:00+08:00");
  });

  it("honors a custom expirationDate over the derived default", () => {
    const out = applyPassDates(base(), { expirationDate: "2026-09-01T00:00:00+08:00" });
    expect(out.expirationDate).toBe("2026-09-01T00:00:00+08:00");
  });

  it("ignores a blank/invalid custom value and falls back to arrival + 1", () => {
    expect(applyPassDates(base(), { expirationDate: "  " }).expirationDate).toBe("2026-08-29T17:55:00+08:00");
  });

  it("does not mutate the input and leaves a dateless pass alone", () => {
    const input = { semantics: {} };
    const out = applyPassDates(input);
    expect(out.expirationDate).toBeUndefined();
    expect(out.relevantDate).toBeUndefined();
    expect(input).toEqual({ semantics: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/expiry.test.js`
Expected: FAIL — `Failed to resolve import "../packages/pass-builder/expiry.js"`.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/pass-builder/expiry.js
// Pure derivation of a pass's relevantDate + expirationDate from its flight
// semantics. A boarding pass with no expirationDate and a stale hand-entered
// relevantDate gets bucketed into Wallet's "Expired" once that date passes —
// so we ALWAYS derive relevantDate from the flight (dropping any stale
// relevantDates) and emit an expirationDate (custom, or arrival + 1 day).

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}(?::\d{2})?)(\.\d+)?([+-]\d{2}:\d{2}|Z)?$/;
const pad = (n) => String(n).padStart(2, "0");

/**
 * Add whole days to the DATE part of an ISO datetime, preserving time-of-day
 * and UTC offset (wall-clock arithmetic — no epoch/local round-trip).
 * @param {string} iso
 * @param {number} days
 * @returns {string|undefined}
 */
export function addDaysPreservingOffset(iso, days) {
  const m = ISO_RE.exec(String(iso ?? "").trim());
  if (!m) return undefined;
  const [, y, mo, d, time, , offset] = m;
  const base = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  base.setUTCDate(base.getUTCDate() + days);
  const date = `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`;
  const hms = time.length === 5 ? `${time}:00` : time;
  return `${date}T${hms}${offset ?? ""}`;
}

const isIso = (v) => typeof v === "string" && ISO_RE.test(v.trim());

/**
 * Return a NEW pass.json with relevantDate + expirationDate derived from its
 * flight semantics. Custom expiry wins; otherwise arrival + 1 day. The stale
 * `relevantDates` array is dropped whenever a flight date is available.
 * @param {object} passJson
 * @param {{expirationDate?: string}} [opts]
 * @returns {object}
 */
export function applyPassDates(passJson, opts = {}) {
  const sem = passJson?.semantics ?? {};
  const out = { ...passJson };

  const rel = sem.currentBoardingDate ?? sem.currentDepartureDate ?? sem.originalBoardingDate ?? sem.originalDepartureDate;
  if (isIso(rel)) {
    out.relevantDate = rel.trim();
    delete out.relevantDates; // derive, never trust a hand-entered relevant date
  }

  const custom = opts.expirationDate;
  const arrival = sem.currentArrivalDate ?? sem.originalArrivalDate ?? sem.currentDepartureDate ?? sem.originalDepartureDate;
  const exp = isIso(custom) ? custom.trim() : addDaysPreservingOffset(arrival, 1);
  if (exp) out.expirationDate = exp;

  return out;
}
```

- [ ] **Step 4: Add re-export**

In `packages/pass-builder/index.js`, after the `bcbp.js` re-export line, add:

```js
export { applyPassDates, addDaysPreservingOffset } from "./expiry.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/expiry.test.js`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/pass-builder/expiry.js packages/pass-builder/index.js tests/expiry.test.js
git commit -m "feat(pass-builder): derive relevantDate + expirationDate from flight semantics"
```

---

### Task 2: Apply to the FormState path + customizable `meta.expirationDate`

**Files:**
- Modify: `packages/pass-builder/form-to-pass.js`
- Modify: `packages/pass-schema/schema.json` (meta), `packages/pass-schema/index.js` (typedef)
- Test: `tests/form-to-pass.test.js`

**Interfaces:**
- Consumes: `applyPassDates` (Task 1).
- `formStateToPassJson` returns its pass.json wrapped in `applyPassDates(obj, { expirationDate: meta.expirationDate })`, so FormState passes get a derived relevantDate (stale `relevantDates` from `iOS26.relevantDates` is overridden) and an expirationDate (custom `meta.expirationDate`, else arrival + 1). `meta.expirationDate` is a new optional ISO string.

- [ ] **Step 1: Write the failing test**

```js
// add to tests/form-to-pass.test.js
import { formStateToPassJson } from "../packages/pass-builder/form-to-pass.js";

describe("formStateToPassJson expiry/relevance", () => {
  const state = () => ({
    meta: { passTypeId: "p", teamId: "t", organizationName: "PAL", serialNumber: "PAL", description: "d" },
    branding: { logoText: "", foregroundColor: "rgb(0,0,0)", backgroundColor: "rgb(0,0,0)", labelColor: "rgb(0,0,0)" },
    barcode: { format: "PKBarcodeFormatQR", message: "x", altText: "" },
    semantics: {
      currentBoardingDate: "2026-08-28T15:50:00+08:00",
      currentDepartureDate: "2026-08-28T16:35:00+08:00",
      currentArrivalDate: "2026-08-28T17:55:00+08:00"
    },
    displayFields: {},
    iOS26: { relevantDates: ["2026-06-15T05:00:00+08:00"] } // stale — must NOT leak
  });

  it("derives relevantDate from the flight and drops the stale relevantDates", () => {
    const p = formStateToPassJson(state());
    expect(p.relevantDate).toBe("2026-08-28T15:50:00+08:00");
    expect(p.relevantDates).toBeUndefined();
  });

  it("defaults expirationDate to arrival + 1 day", () => {
    expect(formStateToPassJson(state()).expirationDate).toBe("2026-08-29T17:55:00+08:00");
  });

  it("uses a custom meta.expirationDate when set", () => {
    const s = state(); s.meta.expirationDate = "2026-09-05T12:00:00+08:00";
    expect(formStateToPassJson(s).expirationDate).toBe("2026-09-05T12:00:00+08:00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/form-to-pass.test.js`
Expected: FAIL — `p.relevantDate` undefined / `relevantDates` still present / no `expirationDate`.

- [ ] **Step 3: Write minimal implementation**

In `packages/pass-builder/form-to-pass.js`:

Add the import at the top (after the existing imports):

```js
import { applyPassDates } from "./expiry.js";
```

Change the function to wrap its return value. Replace `return {` (line 26) with `const passJson = {` and, after that object literal's closing `};` (line 48), add:

```js
  return applyPassDates(passJson, { expirationDate: meta.expirationDate });
```

(Leave the existing `relevantDates` line as-is — `applyPassDates` overrides it.)

- [ ] **Step 4: Add the schema + typedef field**

In `packages/pass-schema/schema.json`, inside `meta.properties`, add an `expirationDate` string beside `authenticationToken`:

```json
        "authenticationToken": { "type": "string", "minLength": 16 },
        "expirationDate": { "type": "string" }
```

In `packages/pass-schema/index.js`, append `expirationDate?:string` to the `meta` typedef object:

```js
 * @property {{passTypeId:string, teamId:string, organizationName:string, serialNumber:string, description:string, webServiceURL?:string, authenticationToken?:string, expirationDate?:string}} meta
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/form-to-pass.test.js && npm run check`
Expected: PASS, fixtures still validate.

- [ ] **Step 6: Commit**

```bash
git add packages/pass-builder/form-to-pass.js packages/pass-schema/schema.json packages/pass-schema/index.js tests/form-to-pass.test.js
git commit -m "feat(pass-builder): emit derived/custom expiry on FormState passes"
```

---

### Task 3: Apply to the template path + issue-time `expirationDate` reserved key

**Files:**
- Modify: `packages/pass-builder/template.js`
- Test: `tests/template-merge.test.js`

**Interfaces:**
- Consumes: `applyPassDates` (Task 1).
- `buildPkpassFromTemplate` applies `applyPassDates(merged, { expirationDate: data.expirationDate })` after the existing merge/mirror/strip pipeline and before `OVERRIDE_KEYS`. `expirationDate` is added to `RESERVED_KEYS` so issue-time `data.expirationDate` is accepted (not rejected as unknown) and consumed here (it is NOT a field-key patch).

- [ ] **Step 1: Write the failing test**

```js
// add to tests/template-merge.test.js (the file already imports applyTemplateData)
import { applyTemplateData } from "../packages/pass-builder/template.js";

describe("template expiry reserved key", () => {
  it("accepts expirationDate as a reserved key (does not throw as unknown)", () => {
    const passJson = { boardingPass: { primaryFields: [{ key: "depart", value: "MNL" }] }, semantics: {} };
    expect(() => applyTemplateData(passJson, { expirationDate: "2026-09-01T00:00:00+08:00" })).not.toThrow();
  });
});
```

(Build-level derivation for template passes is exercised by the `tests/template-load-build.test.js` build path through `buildPkpassFromTemplate`; this case locks in that the reserved key is accepted by the dry-run merge.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/template-merge.test.js`
Expected: FAIL — `applyTemplateData` throws an "unknown key: expirationDate" error.

- [ ] **Step 3: Write minimal implementation**

In `packages/pass-builder/template.js`:

Add the import (top of file, with the other pass-builder imports):

```js
import { applyPassDates } from "./expiry.js";
```

Add `expirationDate` to `RESERVED_KEYS` (line 37):

```js
const RESERVED_KEYS = new Set(["semantics", "additionalInfoFields", "barcodeMessage", "barcodeAltText", "expirationDate"]);
```

In `buildPkpassFromTemplate`, change the `merged` line (line 246) to apply the transform with the custom value from `data`:

```js
  const merged = applyPassDates(
    mirrorTimeZoneAliases(stripInternalIds(applyTemplateData(passJson, data))),
    { expirationDate: data.expirationDate }
  );
```

Also update the `TemplateData` JSDoc (around line 29) to document the new reserved key:

```js
 *  - `barcodeMessage` / `barcodeAltText`: string — applied to every barcode.
 *  - `expirationDate`: ISO string — custom pass expiry; when omitted the pass
 *    expires at arrival + 1 day (derived from the flight semantics).
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/template-merge.test.js tests/template-load-build.test.js`
Expected: PASS (reserved key accepted; existing build tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add packages/pass-builder/template.js tests/template-merge.test.js
git commit -m "feat(pass-builder): derive/custom expiry on template passes via reserved key"
```

---

### Task 4: Designer UI — expiry field

**Files:**
- Modify: `apps/designer/src/form.js`

**Interfaces:**
- Adds an optional "Pass expiry" text input to the Meta section bound to `meta.expirationDate`; empty = arrival + 1 day. No new exports.

- [ ] **Step 1: Implement**

In `apps/designer/src/form.js`, add a field to the `"Meta"` section array (after the `meta.description` entry):

```js
    { path: "meta.description", label: "Description", type: "text" },
    { path: "meta.expirationDate", label: "Pass expiry (ISO; blank = arrival + 1 day)", type: "text" }
```

(The generic text-input renderer already binds `f.path` via `setPath`/`getPath`; no other change needed. A free-text ISO field matches how other ISO values are entered in this app.)

- [ ] **Step 2: Verify**

Run: `npx vitest run` and `npm run build:designer`
Expected: full suite PASS, build SUCCEEDS.

- [ ] **Step 3: Manual check**

`npm run dev` → Designer → Meta → set/clear "Pass expiry"; build a pass and confirm `expirationDate` in the emitted `pass.json` (set value when filled; arrival + 1 when blank).

- [ ] **Step 4: Commit**

```bash
git add apps/designer/src/form.js
git commit -m "feat(designer): optional pass-expiry field (blank = arrival + 1 day)"
```

---

### Task 5: Issue UI — trip-level expiry override

**Files:**
- Modify: `apps/designer/src/issue.js`
- Test: `tests/issue-template.test.js`

**Interfaces:**
- `buildIssueRequest` gains an optional `expirationDate` param; when a non-empty (trimmed) string, it is added to `data.expirationDate` (the reserved key from Task 3). A trip-level "Pass expiry" input (shared across the trip, like barcode altText) feeds it; blank = server derives arrival + 1.

- [ ] **Step 1: Write the failing test**

```js
// add to tests/issue-template.test.js
import { buildIssueRequest } from "../apps/designer/src/issue.js";

describe("buildIssueRequest expirationDate", () => {
  it("includes a non-empty expirationDate as a reserved data key", () => {
    const req = buildIssueRequest({ template: "t", groupId: "G", serial: "S", values: {}, semantics: {}, expirationDate: "2026-09-01T00:00:00+08:00" });
    expect(req.data.expirationDate).toBe("2026-09-01T00:00:00+08:00");
  });
  it("omits expirationDate when blank", () => {
    const req = buildIssueRequest({ template: "t", groupId: "G", serial: "S", values: {}, semantics: {}, expirationDate: "  " });
    expect(req.data.expirationDate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/issue-template.test.js`
Expected: FAIL — `req.data.expirationDate` undefined.

- [ ] **Step 3: Implement**

In `apps/designer/src/issue.js`, extend `buildIssueRequest` (keep the rest of the body identical, including the `barcodeMessage` handling added in the prior phase) to accept and forward `expirationDate`:

```js
export function buildIssueRequest({ template, groupId, serial, values, semantics, barcodeMessage, expirationDate }) {
  const data = {};
  for (const [key, raw] of Object.entries(values ?? {})) {
    const v = (raw ?? "").trim();
    if (v) data[key] = v;
  }
  const sem = harvestSemantics(semantics ?? {});
  if (Object.keys(sem).length) data.semantics = sem;
  const bc = (barcodeMessage ?? "").trim();
  if (bc) data.barcodeMessage = bc;
  const exp = (expirationDate ?? "").trim();
  if (exp) data.expirationDate = exp;
  return { template, serialNumber: (serial ?? "").trim(), groupId: (groupId ?? "").trim(), data };
}
```

Add a trip-level expiry input near the existing shared/trip-wide controls, store it in a trip-level variable (e.g. `let tripExpiry = ""`), read it in `syncFromInputs` (mirror how the shared barcode altText / shared field values are read), and pass it into the per-row `buildIssueRequest({...})` call in `issueAll` as `expirationDate: tripExpiry`. Label it "Pass expiry (blank = arrival + 1 day)". Confirm the exact shared-control render/read pattern in `issue.js` before wiring (match the barcode altText / shared-values pattern); do not invent new helpers.

- [ ] **Step 4: Run tests + verify**

Run: `npx vitest run tests/issue-template.test.js` → PASS, then `npx vitest run` and `npm run build:designer` → PASS / SUCCEEDS.

- [ ] **Step 5: Commit**

```bash
git add apps/designer/src/issue.js tests/issue-template.test.js
git commit -m "feat(issue): trip-level pass-expiry override (blank = arrival + 1 day)"
```

---

## Validation

```bash
npx vitest run                 # full suite green (new: expiry; updated form-to-pass, template-merge, issue-template)
npm run check                  # fixtures validate
npm run build:designer         # SPA builds
# spot-check: build any pass with arrival semantics → pass.json has expirationDate = arrival+1, relevantDate = boarding, no stale relevantDates
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Dropping `relevantDates` breaks a legit multi-relevant-date use | Low | Only dropped when a flight date is derivable; this is a boarding-pass app and a single boarding-time relevantDate is the correct behavior. |
| Naive (offset-less) ISO arithmetic | Low | `addDaysPreservingOffset` does wall-clock date math and re-emits the same offset/`Z`/none; tested for offset, `Z`, and naive. |
| Custom expiry typo'd as non-ISO | Low | `applyPassDates` validates with the ISO regex and falls back to arrival + 1. |
| Status-push (gate/delay) leaves expiry stale | Low | Expiry/relevance are derived at build time from semantics; a delay that shifts arrival re-derives on the next build/push. |

## Acceptance

- [ ] `applyPassDates`: derives relevantDate from boarding, drops stale `relevantDates`, defaults expiry to arrival + 1, honors valid custom, ignores invalid custom, pure (tested).
- [ ] FormState passes emit derived relevantDate + expirationDate; `meta.expirationDate` customizes; stale `iOS26.relevantDates` no longer leaks.
- [ ] Template passes derive the same; `data.expirationDate` reserved key customizes at issue time.
- [ ] Designer + Issue expose an optional expiry field (blank = arrival + 1).
- [ ] Full `vitest` suite + `npm run check` + `npm run build:designer` green. No new deps.

## Post-merge operational follow-up (not code)

The already-issued pass `PAL` / `PR2987@2026-08-28` is stored with correct Aug-28 semantics, so once this ships, rebuilding it derives `relevantDate = 2026-08-28` boarding + `expirationDate = 2026-08-29`. Trigger a push (Manage tab, or re-issue) so the installed copy updates and leaves the "Expired" bucket on the device.

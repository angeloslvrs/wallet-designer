# Semantics-first Phase 1 — Shared Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three reusable, independently-tested units the semantics-first redesign needs — a typed-input renderer, a typed semantics catalog, and a pure Suggest engine — without wiring them into either authoring flow yet.

**Architecture:** Approach A from `docs/superpowers/specs/2026-06-13-semantics-first-authoring-design.md`. Pure logic (ISO parse/compose, catalog data, Suggest formatters) lives in unit-tested modules; the one DOM piece (`renderTypedInput`) is tested under happy-dom. Nothing in this phase changes pass output or the API — it only adds modules + extracts the existing ISO helpers.

**Tech Stack:** Vanilla ESM JS, vitest, happy-dom (new devDependency for DOM tests).

**Out of scope (later phases):** wiring the semantics editor into the Issue/Designer flows, the `semantics` issue payload, `formStateToPassJson` rewrite, and `migrateFormState`. Those are Phases 2–3, planned after this lands.

---

### Task 1: Extract shared ISO datetime helpers into `inputs.js`

The Designer's `form.js` already has `splitIso`/`joinIso`. Move them to a new shared module so the semantics editor and the Issue flow reuse one implementation, and add an emptiness test used by "emit only filled".

**Files:**
- Create: `apps/designer/src/inputs.js`
- Create: `tests/inputs.test.js`
- Modify: `apps/designer/src/form.js` (remove local `splitIso`/`joinIso`, import from `inputs.js`)

- [ ] **Step 1: Write the failing test**

`tests/inputs.test.js`:
```js
import { describe, it, expect } from "vitest";
import { splitIso, joinIso, isEmptyTyped } from "../apps/designer/src/inputs.js";

describe("splitIso / joinIso", () => {
  it("splits an offset ISO into wall-clock + offset and rejoins it", () => {
    expect(splitIso("2026-06-01T07:30:00-07:00")).toEqual({ local: "2026-06-01T07:30", offset: "-07:00" });
    expect(joinIso("2026-06-01T07:30", "-07:00")).toBe("2026-06-01T07:30:00-07:00");
  });
  it("handles Z, naive, fractional seconds, and garbage", () => {
    expect(splitIso("2026-06-01T07:30:00Z")).toEqual({ local: "2026-06-01T07:30", offset: "Z" });
    expect(splitIso("2026-06-01T07:30")).toEqual({ local: "2026-06-01T07:30", offset: "" });
    expect(splitIso("2026-06-01T07:30:00.000+09:30")).toEqual({ local: "2026-06-01T07:30", offset: "+09:30" });
    expect(splitIso("not-a-date")).toEqual({ local: "", offset: "" });
    expect(joinIso("", "-07:00")).toBe("");
  });
});

describe("isEmptyTyped", () => {
  it("treats blank string / null / undefined as empty for every type", () => {
    for (const t of ["text", "date", "number", "boolean", "personName", "seats", "stringArray", "enum", "location", "currency"]) {
      expect(isEmptyTyped(t, undefined)).toBe(true);
      expect(isEmptyTyped(t, null)).toBe(true);
    }
    expect(isEmptyTyped("text", "")).toBe(true);
    expect(isEmptyTyped("text", "x")).toBe(false);
  });
  it("applies type-specific emptiness", () => {
    expect(isEmptyTyped("boolean", false)).toBe(false);          // false is a real value
    expect(isEmptyTyped("number", 0)).toBe(false);
    expect(isEmptyTyped("personName", { givenName: "", familyName: "" })).toBe(true);
    expect(isEmptyTyped("personName", { givenName: "A", familyName: "" })).toBe(false);
    expect(isEmptyTyped("seats", [])).toBe(true);
    expect(isEmptyTyped("seats", [{ seatNumber: "C" }])).toBe(false);
    expect(isEmptyTyped("stringArray", [])).toBe(true);
    expect(isEmptyTyped("stringArray", ["X"])).toBe(false);
    expect(isEmptyTyped("location", { latitude: 0, longitude: 0 })).toBe(false);
    expect(isEmptyTyped("location", {})).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/inputs.test.js`
Expected: FAIL — cannot resolve `../apps/designer/src/inputs.js`.

- [ ] **Step 3: Write minimal implementation**

`apps/designer/src/inputs.js`:
```js
// Shared typed-input helpers. Pure functions here are unit-tested; the DOM
// renderer (renderTypedInput) is added in Task 4 and tested under happy-dom.

// ISO-8601 <-> datetime-local. <input type=datetime-local> only edits the
// wall-clock part, so the UTC offset is parsed/preserved separately.
export const splitIso = (v) => {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(v || "");
  return m ? { local: m[1], offset: m[2] || "" } : { local: "", offset: "" };
};
export const joinIso = (local, offset) => (local ? `${local}:00${offset || ""}` : "");

/** True when a typed value carries nothing worth emitting (drives emit-only-filled). */
export function isEmptyTyped(type, value) {
  if (value === undefined || value === null) return true;
  switch (type) {
    case "boolean": return false;                       // both true and false are real
    case "number":  return value === "" || Number.isNaN(value);
    case "personName": return !value.givenName && !value.familyName;
    case "seats":
    case "stringArray": return !Array.isArray(value) || value.length === 0;
    case "location": return typeof value.latitude !== "number" || typeof value.longitude !== "number";
    case "currency": return value.amount === undefined || value.amount === "" || !value.currencyCode;
    default: return String(value).trim() === "";        // text, date, enum
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/inputs.test.js`
Expected: PASS (2 describe blocks).

- [ ] **Step 5: Point `form.js` at the shared helpers**

In `apps/designer/src/form.js`, delete the local `splitIso` and `joinIso` definitions (the `const splitIso = …` / `const joinIso = …` block added with the date picker) and add to the imports at the top:
```js
import { splitIso, joinIso } from "./inputs.js";
```

- [ ] **Step 6: Verify the whole suite still passes**

Run: `npm test`
Expected: PASS, count = previous total + 2 (the two new `inputs.test.js` blocks). No regressions in `form.js`-driven behaviour (build still green).

- [ ] **Step 7: Commit**

```bash
git add apps/designer/src/inputs.js tests/inputs.test.js apps/designer/src/form.js
git commit -m "refactor(designer): extract shared ISO datetime + isEmptyTyped helpers into inputs.js"
```

---

### Task 2: Typed semantics catalog + required set

Extend `semantics.js` with `SEMANTIC_CATALOG` (every boarding-relevant key tagged `{type, required, label, group}`) and `REQUIRED_SEMANTICS`. Keep `BOARDING_SEMANTICS` (existing consumers like `bindings.js` use it) and derive `SEMANTIC_DATE_KEYS` from the catalog so there's a single source of truth.

**Files:**
- Modify: `packages/pass-builder/semantics.js`
- Modify: `packages/pass-builder/index.js` (export `SEMANTIC_CATALOG`, `REQUIRED_SEMANTICS`)
- Create: `tests/semantics-catalog.test.js`

- [ ] **Step 1: Write the failing test**

`tests/semantics-catalog.test.js`:
```js
import { describe, it, expect } from "vitest";
import { SEMANTIC_CATALOG, REQUIRED_SEMANTICS, BOARDING_SEMANTICS, SEMANTIC_DATE_KEYS } from "../packages/pass-builder/semantics.js";

const VALID_TYPES = new Set(["text", "date", "number", "boolean", "personName", "seats", "stringArray", "enum", "location", "currency"]);

describe("SEMANTIC_CATALOG", () => {
  it("covers every BOARDING_SEMANTICS key", () => {
    for (const k of Object.keys(BOARDING_SEMANTICS)) expect(SEMANTIC_CATALOG[k], k).toBeDefined();
  });
  it("gives every entry a valid type, a group, and a label", () => {
    for (const [k, e] of Object.entries(SEMANTIC_CATALOG)) {
      expect(VALID_TYPES.has(e.type), `${k}:${e.type}`).toBe(true);
      expect(typeof e.group).toBe("string");
      expect(typeof e.label).toBe("string");
    }
  });
  it("maps the legacy string/date/number/personName/seats types consistently", () => {
    // BOARDING_SEMANTICS used the same type names except 'string' -> catalog 'text'.
    for (const [k, t] of Object.entries(BOARDING_SEMANTICS)) {
      const expected = t === "string" ? "text" : t;
      expect(SEMANTIC_CATALOG[k].type, k).toBe(expected);
    }
  });
});

describe("REQUIRED_SEMANTICS", () => {
  it("is a subset of the catalog and matches the entries' required flag", () => {
    for (const k of REQUIRED_SEMANTICS) expect(SEMANTIC_CATALOG[k], k).toBeDefined();
    const flagged = Object.entries(SEMANTIC_CATALOG).filter(([, e]) => e.required).map(([k]) => k).sort();
    expect(flagged).toEqual([...REQUIRED_SEMANTICS].sort());
  });
  it("includes the core boarding fields", () => {
    for (const k of ["airlineCode", "departureAirportCode", "destinationAirportCode", "originalBoardingDate", "passengerName", "seats"]) {
      expect(REQUIRED_SEMANTICS).toContain(k);
    }
  });
});

describe("SEMANTIC_DATE_KEYS", () => {
  it("equals the catalog keys whose type is date", () => {
    const fromCatalog = Object.entries(SEMANTIC_CATALOG).filter(([, e]) => e.type === "date").map(([k]) => k).sort();
    expect([...SEMANTIC_DATE_KEYS].sort()).toEqual(fromCatalog);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/semantics-catalog.test.js`
Expected: FAIL — `SEMANTIC_CATALOG` is not exported.

- [ ] **Step 3: Write the catalog**

In `packages/pass-builder/semantics.js`, after the existing `BOARDING_SEMANTICS` declaration add:
```js
// Richer typed catalog for the semantics-first editor. Built from
// BOARDING_SEMANTICS (its "string" maps to the "text" widget) plus the
// remaining boarding-relevant keys with their richer widget types. Rail- and
// event-only keys are intentionally excluded (see spec non-goals).
const CATALOG_TYPE = { string: "text", date: "date", number: "number", personName: "personName", seats: "seats" };

const EXTRA_SEMANTICS = {
  eventType:                 { type: "enum",        group: "flight",    label: "Event type",
                               enumOptions: ["PKEventTypeGeneric", "PKEventTypeBoarding"] },
  departureLocation:         { type: "location",    group: "route",     label: "Departure location" },
  destinationLocation:       { type: "location",    group: "route",     label: "Destination location" },
  duration:                  { type: "number",      group: "schedule",  label: "Duration (seconds)" },
  silenceRequested:          { type: "boolean",     group: "status",    label: "Silence requested" },
  internationalDocumentsAreVerified: { type: "boolean", group: "passenger", label: "Intl. documents verified" },
  internationalDocumentsVerifiedDeclarationName: { type: "text", group: "passenger", label: "Docs declaration name" },
  passengerCapabilities:     { type: "stringArray", group: "passenger", label: "Passenger capabilities" },
  passengerEligibleSecurityPrograms:   { type: "stringArray", group: "passenger", label: "Eligible security programs" },
  departureAirportSecurityPrograms:    { type: "stringArray", group: "route",     label: "Departure security programs" },
  destinationAirportSecurityPrograms:  { type: "stringArray", group: "route",     label: "Destination security programs" },
  totalPrice:                { type: "currency",    group: "pricing",   label: "Total price" },
  balance:                   { type: "currency",    group: "pricing",   label: "Balance" }
};

const SEMANTIC_GROUP = {
  airlineCode: "flight", flightCode: "flight", flightNumber: "flight",
  originalDepartureDate: "schedule", currentDepartureDate: "schedule",
  originalBoardingDate: "schedule", currentBoardingDate: "schedule",
  originalArrivalDate: "schedule", currentArrivalDate: "schedule",
  boardingGroup: "passenger", boardingZone: "passenger", boardingSequenceNumber: "passenger",
  passengerName: "passenger", seats: "passenger", confirmationNumber: "passenger",
  ticketFareClass: "passenger", priorityStatus: "passenger",
  membershipProgramName: "passenger", membershipProgramNumber: "passenger",
  transitStatus: "status", transitStatusReason: "status", transitProvider: "status", securityScreening: "status"
  // everything else (departure*/destination*) falls through to "route"
};

const humanize = (k) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();

// The required boarding set. SEED — pinned precisely against the validator in
// Phase 2/3; see spec "Required vs optional".
export const REQUIRED_SEMANTICS = Object.freeze([
  "airlineCode", "flightCode", "flightNumber",
  "departureAirportCode", "destinationAirportCode",
  "originalDepartureDate", "currentDepartureDate",
  "originalBoardingDate", "currentBoardingDate",
  "passengerName", "seats"
]);
const REQUIRED_SET = new Set(REQUIRED_SEMANTICS);

export const SEMANTIC_CATALOG = Object.freeze({
  ...Object.fromEntries(Object.entries(BOARDING_SEMANTICS).map(([k, t]) => [k, {
    type: CATALOG_TYPE[t] ?? "text",
    group: SEMANTIC_GROUP[k] ?? "route",
    label: humanize(k),
    required: REQUIRED_SET.has(k)
  }])),
  ...Object.fromEntries(Object.entries(EXTRA_SEMANTICS).map(([k, e]) => [k, { ...e, required: REQUIRED_SET.has(k) }]))
});
```

Then replace the existing `SEMANTIC_DATE_KEYS` definition with one derived from the catalog:
```js
/** The schedule-date semantic keys, derived from the catalog (single source of truth). */
export const SEMANTIC_DATE_KEYS = Object.freeze(
  Object.keys(SEMANTIC_CATALOG).filter(k => SEMANTIC_CATALOG[k].type === "date")
);
```

- [ ] **Step 4: Export from the package entry**

In `packages/pass-builder/index.js`, add `SEMANTIC_CATALOG` and `REQUIRED_SEMANTICS` to the `semantics.js` re-export line:
```js
export { seatSemantics, splitPersonName, BOARDING_SEMANTICS, SEMANTIC_CATALOG, REQUIRED_SEMANTICS, SEMANTIC_DATE_KEYS, TIMEZONE_KEY_ALIASES } from "./semantics.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/semantics-catalog.test.js`
Expected: PASS (all blocks).

- [ ] **Step 6: Verify no regression (SEMANTIC_DATE_KEYS consumers)**

Run: `npm test`
Expected: PASS — full suite green (the date-keys derivation change must not alter behaviour in `form-to-pass`/status tests).

- [ ] **Step 7: Commit**

```bash
git add packages/pass-builder/semantics.js packages/pass-builder/index.js tests/semantics-catalog.test.js
git commit -m "feat(pass-builder): typed SEMANTIC_CATALOG + REQUIRED_SEMANTICS; derive date keys from catalog"
```

---

### Task 3: Suggest engine

Pure `suggestDisplayValues(semantics, mapping)` that fills display-field values from semantics via a `{semanticKey: fieldKey}` mapping, formatting each by the semantic's catalog type.

**Files:**
- Create: `packages/pass-builder/suggest-empty.js` (package-local `isEmptyTyped`)
- Create: `packages/pass-builder/suggest.js`
- Modify: `packages/pass-builder/index.js` (export `suggestDisplayValues`, `formatSemanticValue`)
- Modify: `apps/designer/src/inputs.js` (re-export `isEmptyTyped` from the package)
- Create: `tests/suggest.test.js`

- [ ] **Step 1: Write the failing test**

`tests/suggest.test.js`:
```js
import { describe, it, expect } from "vitest";
import { suggestDisplayValues, formatSemanticValue } from "../packages/pass-builder/suggest.js";

describe("formatSemanticValue", () => {
  it("formats by catalog type", () => {
    expect(formatSemanticValue("originalBoardingDate", "2026-06-13T07:30:00-07:00")).toBe("7:30 AM");
    expect(formatSemanticValue("passengerName", { givenName: "Juan", familyName: "Dela Cruz" })).toBe("JUAN DELA CRUZ");
    expect(formatSemanticValue("seats", [{ seatRow: "14", seatNumber: "A" }])).toBe("14A");
    expect(formatSemanticValue("seats", [{ seatRow: "14", seatNumber: "A" }, { seatRow: "14", seatNumber: "B" }])).toBe("14A, 14B");
    expect(formatSemanticValue("internationalDocumentsAreVerified", true)).toBe("Yes");
    expect(formatSemanticValue("internationalDocumentsAreVerified", false)).toBe("No");
    expect(formatSemanticValue("passengerCapabilities", ["A", "B"])).toBe("A, B");
    expect(formatSemanticValue("flightNumber", 5057)).toBe("5057");
    expect(formatSemanticValue("departureAirportCode", "MNL")).toBe("MNL");
  });
});

describe("suggestDisplayValues", () => {
  it("fills mapped fields from semantics, formatted", () => {
    const semantics = { departureAirportCode: "MNL", originalBoardingDate: "2026-06-13T07:30:00-07:00" };
    const mapping = { departureAirportCode: "from", originalBoardingDate: "boardingTime" };
    expect(suggestDisplayValues(semantics, mapping)).toEqual({ from: "MNL", boardingTime: "7:30 AM" });
  });
  it("skips semantics that are absent or unmapped", () => {
    expect(suggestDisplayValues({ departureGate: "B7" }, { departureAirportCode: "from" })).toEqual({});
    expect(suggestDisplayValues({ departureAirportCode: "" }, { departureAirportCode: "from" })).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/suggest.test.js`
Expected: FAIL — cannot resolve `suggest.js`.

- [ ] **Step 3: Write the package-local emptiness helper**

`packages/pass-builder/suggest-empty.js`:
```js
/** Type-aware emptiness — package-local twin of the designer's inputs.isEmptyTyped. */
export function isEmptyTyped(type, value) {
  if (value === undefined || value === null) return true;
  switch (type) {
    case "boolean": return false;
    case "number":  return value === "" || Number.isNaN(value);
    case "personName": return !value.givenName && !value.familyName;
    case "seats":
    case "stringArray": return !Array.isArray(value) || value.length === 0;
    case "location": return typeof value.latitude !== "number" || typeof value.longitude !== "number";
    case "currency": return value.amount === undefined || value.amount === "" || !value.currencyCode;
    default: return String(value).trim() === "";
  }
}
```

- [ ] **Step 4: Write the Suggest engine**

`packages/pass-builder/suggest.js`:
```js
import { SEMANTIC_CATALOG } from "./semantics.js";
import { isEmptyTyped } from "./suggest-empty.js";

// Deterministic 12-hour wall-clock from an ISO string (no locale dependence).
function formatTime(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || "");
  if (!m) return String(iso ?? "");
  let h = Number(m[1]); const min = m[2]; const ampm = h < 12 ? "AM" : "PM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

/** Format one semantic value into a human display string, keyed by its catalog type. */
export function formatSemanticValue(key, value) {
  const type = SEMANTIC_CATALOG[key]?.type ?? "text";
  switch (type) {
    case "date": return formatTime(value);
    case "personName": return [value?.givenName, value?.familyName].filter(Boolean).join(" ").toUpperCase();
    case "seats": return (value ?? []).map(s => `${s.seatRow ?? ""}${s.seatNumber ?? ""}`).join(", ");
    case "boolean": return value ? "Yes" : "No";
    case "stringArray": return (value ?? []).join(", ");
    case "number": return String(value);
    default: return String(value ?? "");
  }
}

/**
 * Suggested display-field values from semantics.
 * @param {Record<string,unknown>} semantics
 * @param {Record<string,string>} mapping  semanticKey -> fieldKey
 * @returns {Record<string,string>} fieldKey -> formatted value (only mapped, non-empty semantics)
 */
export function suggestDisplayValues(semantics, mapping) {
  const out = {};
  for (const [sem, fieldKey] of Object.entries(mapping ?? {})) {
    const v = semantics?.[sem];
    const type = SEMANTIC_CATALOG[sem]?.type ?? "text";
    if (isEmptyTyped(type, v)) continue;
    out[fieldKey] = formatSemanticValue(sem, v);
  }
  return out;
}
```

- [ ] **Step 5: Re-point the designer's `isEmptyTyped` at the package (DRY)**

In `apps/designer/src/inputs.js`, replace the `isEmptyTyped` function body with a re-export so there is one implementation:
```js
export { isEmptyTyped } from "@wpd/pass-builder/suggest-empty.js";
```
(The Task 1 `tests/inputs.test.js` still passes — identical behaviour, now sourced from the package.)

- [ ] **Step 6: Export from the package entry**

In `packages/pass-builder/index.js` add:
```js
export { suggestDisplayValues, formatSemanticValue } from "./suggest.js";
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/suggest.test.js tests/inputs.test.js`
Expected: PASS — both files green (inputs still passes via the re-export).

- [ ] **Step 8: Commit**

```bash
git add packages/pass-builder/suggest.js packages/pass-builder/suggest-empty.js packages/pass-builder/index.js apps/designer/src/inputs.js tests/suggest.test.js
git commit -m "feat(pass-builder): pure Suggest engine (semantics -> formatted display values)"
```

---

### Task 4: Typed-input DOM renderer (`renderTypedInput`)

Add the DOM renderer for every catalog type. Tested under happy-dom (new devDependency) so we get real round-trip coverage without a browser.

**Files:**
- Modify: `apps/designer/src/inputs.js` (add `renderTypedInput`)
- Modify: `package.json` (add `happy-dom` devDependency)
- Create: `tests/inputs-dom.test.js`

- [ ] **Step 1: Add the test environment dependency**

Run: `npm install -D happy-dom`
Expected: `happy-dom` appears under `devDependencies` in `package.json`.

- [ ] **Step 2: Write the failing test**

`tests/inputs-dom.test.js`:
```js
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderTypedInput } from "../apps/designer/src/inputs.js";

function mount(opts) {
  let last;
  const el = renderTypedInput({ ...opts, onChange: (v) => { last = v; } });
  document.body.appendChild(el);
  return { el, get: () => last };
}

describe("renderTypedInput", () => {
  it("date: edits wall-clock + offset, emits ISO with offset preserved", () => {
    const { el, get } = mount({ type: "date", value: "2026-06-13T07:30:00-07:00" });
    const [dt, off] = el.querySelectorAll("input");
    expect(dt.value).toBe("2026-06-13T07:30");
    expect(off.value).toBe("-07:00");
    dt.value = "2026-06-13T09:45"; dt.dispatchEvent(new Event("input", { bubbles: true }));
    expect(get()).toBe("2026-06-13T09:45:00-07:00");
  });
  it("number: emits a Number", () => {
    const { el, get } = mount({ type: "number", value: 5 });
    const inp = el.querySelector("input");
    inp.value = "5057"; inp.dispatchEvent(new Event("input", { bubbles: true }));
    expect(get()).toBe(5057);
  });
  it("boolean: emits true/false from a select", () => {
    const { el, get } = mount({ type: "boolean", value: false });
    const sel = el.querySelector("select");
    sel.value = "true"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(get()).toBe(true);
  });
  it("personName: emits {givenName, familyName}", () => {
    const { el, get } = mount({ type: "personName", value: { givenName: "Juan", familyName: "Cruz" } });
    const [g, f] = el.querySelectorAll("input");
    expect(g.value).toBe("Juan"); expect(f.value).toBe("Cruz");
    f.value = "Dela Cruz"; f.dispatchEvent(new Event("input", { bubbles: true }));
    expect(get()).toEqual({ givenName: "Juan", familyName: "Dela Cruz" });
  });
  it("stringArray: emits an array from a comma list", () => {
    const { el, get } = mount({ type: "stringArray", value: ["A"] });
    const inp = el.querySelector("input");
    inp.value = "A, B , C"; inp.dispatchEvent(new Event("input", { bubbles: true }));
    expect(get()).toEqual(["A", "B", "C"]);
  });
  it("enum: emits the chosen option", () => {
    const { el, get } = mount({ type: "enum", value: "PKEventTypeGeneric", enumOptions: ["PKEventTypeGeneric", "PKEventTypeBoarding"] });
    const sel = el.querySelector("select");
    sel.value = "PKEventTypeBoarding"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(get()).toBe("PKEventTypeBoarding");
  });
  it("text: emits the string", () => {
    const { el, get } = mount({ type: "text", value: "MNL" });
    const inp = el.querySelector("input");
    inp.value = "NRT"; inp.dispatchEvent(new Event("input", { bubbles: true }));
    expect(get()).toBe("NRT");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/inputs-dom.test.js`
Expected: FAIL — `renderTypedInput` is not exported.

- [ ] **Step 4: Implement `renderTypedInput`**

Append to `apps/designer/src/inputs.js`:
```js
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

/**
 * Render one typed input. Returns a wrapper element; reports the typed value via onChange.
 * @param {{type:string, value:*, onChange:(v:*)=>void, enumOptions?:string[]}} opts
 */
export function renderTypedInput({ type, value, onChange, enumOptions = [] }) {
  const wrap = el("div", { className: "typed-input" });
  const fire = (v) => onChange?.(v);

  switch (type) {
    case "date": {
      wrap.style.cssText = "display:flex;gap:6px;align-items:center";
      const { local, offset } = splitIso(value);
      const dt = el("input", { type: "datetime-local", step: "60", value: local });
      const off = el("input", { type: "text", value: offset, placeholder: "-07:00", title: "UTC offset (blank = none)" });
      off.style.cssText = "width:78px;flex:none"; dt.style.flex = "1";
      const sync = () => fire(joinIso(dt.value, off.value.trim()));
      dt.addEventListener("input", sync); off.addEventListener("input", sync);
      wrap.append(dt, off); break;
    }
    case "number": {
      const inp = el("input", { type: "number", value: value ?? "" });
      inp.addEventListener("input", () => fire(inp.value === "" ? "" : Number(inp.value)));
      wrap.append(inp); break;
    }
    case "boolean": {
      const sel = el("select");
      for (const [v, t] of [["false", "No / false"], ["true", "Yes / true"]]) sel.append(el("option", { value: v, textContent: t }));
      sel.value = value ? "true" : "false";
      sel.addEventListener("change", () => fire(sel.value === "true"));
      wrap.append(sel); break;
    }
    case "personName": {
      wrap.style.cssText = "display:flex;gap:6px";
      const g = el("input", { placeholder: "Given", value: value?.givenName ?? "" });
      const f = el("input", { placeholder: "Family", value: value?.familyName ?? "" });
      const sync = () => fire({ givenName: g.value, familyName: f.value });
      g.addEventListener("input", sync); f.addEventListener("input", sync);
      wrap.append(g, f); break;
    }
    case "seats": {
      // Minimal seats editor: comma list of "row+letter" tokens (e.g. "14A, 14B").
      const inp = el("input", { placeholder: "14A, 14B", value: (value ?? []).map(s => `${s.seatRow ?? ""}${s.seatNumber ?? ""}`).join(", ") });
      inp.addEventListener("input", () => fire(
        inp.value.split(",").map(t => t.trim()).filter(Boolean).map(t => {
          const m = /^(\d+)\s*([A-Za-z]+)$/.exec(t);
          return m ? { seatRow: m[1], seatNumber: m[2].toUpperCase() } : { seatNumber: t };
        })
      ));
      wrap.append(inp); break;
    }
    case "stringArray": {
      const inp = el("input", { placeholder: "comma, separated", value: (value ?? []).join(", ") });
      inp.addEventListener("input", () => fire(inp.value.split(",").map(s => s.trim()).filter(Boolean)));
      wrap.append(inp); break;
    }
    case "enum": {
      const sel = el("select");
      for (const o of enumOptions) sel.append(el("option", { value: o, textContent: o }));
      if (value != null) sel.value = value;
      sel.addEventListener("change", () => fire(sel.value));
      wrap.append(sel); break;
    }
    case "location": {
      wrap.style.cssText = "display:flex;gap:6px";
      const lat = el("input", { type: "number", placeholder: "lat", value: value?.latitude ?? "" });
      const lng = el("input", { type: "number", placeholder: "lng", value: value?.longitude ?? "" });
      const sync = () => fire({ latitude: Number(lat.value), longitude: Number(lng.value) });
      lat.addEventListener("input", sync); lng.addEventListener("input", sync);
      wrap.append(lat, lng); break;
    }
    case "currency": {
      wrap.style.cssText = "display:flex;gap:6px";
      const amt = el("input", { type: "number", placeholder: "amount", value: value?.amount ?? "" });
      const cur = el("input", { placeholder: "USD", value: value?.currencyCode ?? "" });
      const sync = () => fire({ amount: amt.value === "" ? "" : Number(amt.value), currencyCode: cur.value });
      amt.addEventListener("input", sync); cur.addEventListener("input", sync);
      wrap.append(amt, cur); break;
    }
    default: {
      const inp = el("input", { type: "text", value: value ?? "" });
      inp.addEventListener("input", () => fire(inp.value));
      wrap.append(inp);
    }
  }
  return wrap;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/inputs-dom.test.js`
Expected: PASS (all type cases).

- [ ] **Step 6: Full suite + build**

Run: `npm test && npm run build:designer`
Expected: full suite PASS; SPA builds clean (the new module is tree-shaken out until wired, so the bundle still compiles).

- [ ] **Step 7: Commit**

```bash
git add apps/designer/src/inputs.js tests/inputs-dom.test.js package.json package-lock.json
git commit -m "feat(designer): renderTypedInput for every catalog type (happy-dom tested)"
```

---

## Self-review notes

- **Spec coverage (Phase 1 portion):** typed-input renderer (Task 4) ✓; semantics catalog + types + required (Task 2) ✓; Suggest engine + formatters (Task 3) ✓; shared ISO helpers / emit-only-filled primitive `isEmptyTyped` (Task 1, deduped to the package in Task 3) ✓. Phases 2–3 (Issue wiring, payload/server, Designer FormState + `migrateFormState`, preview) are explicitly deferred to their own plans.
- **Type consistency:** `isEmptyTyped` ends up defined once in `suggest-empty.js` and re-exported by `inputs.js`; `renderTypedInput`, `formatSemanticValue`, and the catalog all use the same 10-type vocabulary (`text/date/number/boolean/personName/seats/stringArray/enum/location/currency`).
- **No placeholders:** every step has complete code/commands.
- **Open item carried from spec:** `REQUIRED_SEMANTICS` is a seed; it is pinned against `buildpass validate` in Phase 2/3, where a real pass is built.

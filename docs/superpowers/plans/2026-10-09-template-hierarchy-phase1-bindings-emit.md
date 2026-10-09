# Template Hierarchy — Phase 1: Persisted Studio Bindings + Emit Layer

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Work task-by-task, test-first; run the named test file after each step and the full suite (`npm test`) at the end of each task.

**Spec:** `docs/superpowers/specs/2026-10-09-airline-route-flight-hierarchy.md` (sections "Persisted bindings for Studio designs", "Emit-layer changes"). Branch: `feat/template-hierarchy`.

**Goal:** Make a Studio design usable as a value-less *Airline* template, the prerequisite for routes (phase 2) and conversion (phase 4):

1. **Persisted Studio bindings** — a design's `semanticKey → fieldKey` map can be confirmed and stored (same `template_bindings` table as bundles), so it survives the design's sample values being blank.
2. **Label tokens** — `{semanticKey}` / `{semanticKey:upper}` in field labels resolve from the pass's semantics.
3. **Fixed 24 h time fields** — `timeFormat: "24h"` on a field whose value is an ISO date renders `HH:mm` text at emit; the stored value stays ISO so Issue and status updates keep writing dates.

**Architecture:** One pure transform, `resolvePassFields(passJson)` (new `packages/pass-builder/field-render.js`), turns tokens + `timeFormat` fields into plain Apple fields. It runs at the end of `formStateToPassJson` (every FormState build, preview and rebuild-at-fetch) and in the wallet preview's entry points (so previews of *unresolved* pass.json — the Issue workspace's merged preview — render the same). Binding discovery and field descriptors for Studio designs run on the **unresolved** surface (`formStateToPassJson(state, {resolveFields: false})`), where time fields still hold ISO values. Studio bindings are stored under `studio:<name>` in `template_bindings`; when none are stored, discovery stays live (not persisted), so unconverted designs behave exactly as today.

**Tech Stack:** Vanilla ESM JS, Node ≥24, vitest (+ happy-dom for DOM tests). No new dependencies.

## Global Constraints

- ESM vanilla JS — no TypeScript, no framework, **no new dependencies**. Pure functions return new objects; never mutate inputs.
- **Polarity rule:** no code may assume field-key names. Tokens name *semantic* keys; bindings map semantics → field keys.
- `packages/pass-builder/migrate.js` is frozen — do not touch it. (`migrateFormState` passes new-shape states through untouched, so `timeFormat` survives it; Task 3 pins this with a test.)
- Bundles (`.pkpasstemplate`) are out of scope: their build path (`buildPkpassFromTemplate`) is unchanged; bundle bindings keep their current behaviour (persist-on-first-use).
- Server-controlled identity and the access guard are untouched. `/api/designs/*` is already control plane.
- `timeFormat` and label tokens must never reach an emitted `pass.json` (Apple's validator / iOS must see plain fields).
- Status-code and push behaviour unchanged; a status update on a 24 h field must still carry its `changeMessage`.
- Tests live in `tests/` at the repo root; run one with `npx vitest run tests/<file>`.

---

### Task 1: Binding discovery and descriptors see `timeFormat` fields as dates

**Files:**
- Modify: `packages/pass-builder/bindings.js` (`collectFields`)
- Modify: `packages/pass-builder/template.js` (`templateFieldDescriptors` fallback, ~line 111)
- Test: `tests/bindings.test.js`, `tests/field-descriptors.test.js`

**Why:** a 24 h field has no `dateStyle`/`timeStyle` (Apple would format it otherwise), so today it would be neither date-proximity-bound nor given the `date` kind.

- [ ] **Step 1: Failing tests**

```js
// tests/bindings.test.js — add
it("treats a timeFormat field holding an ISO date as a date (date-proximity binds it)", () => {
  const passJson = {
    boardingPass: { auxiliaryFields: [{ key: "boarding", label: "BOARDING", value: "2026-10-12T16:05:00+08:00", timeFormat: "24h" }] },
    semantics: { currentBoardingDate: "2026-10-12T16:05:00+08:00" }
  };
  expect(discoverBindings(passJson).currentBoardingDate).toMatchObject({ fieldKey: "boarding", source: "date-proximity" });
});

// tests/field-descriptors.test.js — add
it("an unbound timeFormat field gets the date kind", () => {
  const passJson = { boardingPass: { auxiliaryFields: [{ key: "boarding", label: "B", value: "2026-10-12T16:05:00+08:00", timeFormat: "24h" }] } };
  expect(templateFieldDescriptors(passJson, {}).find(d => d.key === "boarding").kind).toBe("date");
});
```

- [ ] **Step 2:** run both files → FAIL.
- [ ] **Step 3: Implement** — in `collectFields`: `const isDate = Boolean(f.dateStyle || f.timeStyle || f.timeFormat) && !Number.isNaN(dateMs);`. In `templateFieldDescriptors`: extend the fallback condition with `|| field.timeFormat !== undefined`; update the JSDoc rule 2 to mention `timeFormat`.
- [ ] **Step 4:** run → PASS; `npm test` green.

---

### Task 2: `resolvePassFields` — label tokens + 24 h rendering (pure)

**Files:**
- Create: `packages/pass-builder/field-render.js`
- Modify: `packages/pass-builder/index.js` (re-export `resolvePassFields`, `LABEL_TOKEN_RE`)
- Test: `tests/field-render.test.js` (new)

**Interfaces:**
- Produces: `resolvePassFields(passJson: object): object` — returns a NEW pass.json where, in every zone of `FIELD_ZONES` under the style key (`boardingPass` etc.):
  - each `label` string has tokens `{key}` / `{key:upper}` replaced **only when `key` is in `SEMANTIC_CATALOG`**; value = `passJson.semantics[key]` — strings as-is, numbers via `String()`, anything else (objects, missing, null) → `""`. `:upper` → `toUpperCase()`. If at least one token was replaced, collapse whitespace runs to one space and trim. Unknown keys / other braces stay literal.
  - each field with `timeFormat === "24h"`: if `value` is a loose ISO datetime (`isLooseIsoDateTime`), `value` becomes the `HH:mm` read **from the string itself** (its own offset is the airport's — do not convert through `Date`); `timeFormat` is deleted; `dateStyle`/`timeStyle` are deleted. A non-ISO value (blank, already-rendered "16:05") is kept as-is and `timeFormat` is still deleted.
  - idempotent: `resolvePassFields(resolvePassFields(x))` deep-equals `resolvePassFields(x)`.
- Produces: `LABEL_TOKEN_RE = /\{([A-Za-z][A-Za-z0-9]*)(?::(upper))?\}/g` (exported for the Design hint/preview).

- [ ] **Step 1: Failing tests**

```js
// tests/field-render.test.js
import { describe, it, expect } from "vitest";
import { resolvePassFields } from "../packages/pass-builder/field-render.js";

const pass = (fields, semantics = {}) => ({ boardingPass: { primaryFields: fields }, semantics });

describe("label tokens", () => {
  it("resolves {key:upper} and {key} from semantics, collapsing whitespace", () => {
    const out = resolvePassFields(pass(
      [{ key: "depart", label: "{departureCityName:upper} {departureAirportName:upper}", value: "MNL" }],
      { departureCityName: "Manila", departureAirportName: "Ninoy Aquino Intl" }));
    expect(out.boardingPass.primaryFields[0].label).toBe("MANILA NINOY AQUINO INTL");
  });
  it("a missing semantic resolves empty and the label is trimmed", () => {
    const out = resolvePassFields(pass([{ key: "a", label: "{departureCityName:upper}  {departureAirportName}", value: "" }], { departureCityName: "Tacloban" }));
    expect(out.boardingPass.primaryFields[0].label).toBe("TACLOBAN");
  });
  it("numbers stringify; unknown keys and plain braces stay literal", () => {
    const out = resolvePassFields(pass([{ key: "f", label: "PR {flightNumber} {notASemantic} {x", value: "" }], { flightNumber: 2987 }));
    expect(out.boardingPass.primaryFields[0].label).toBe("PR 2987 {notASemantic} {x");
  });
  it("leaves labels without tokens byte-identical", () => {
    const out = resolvePassFields(pass([{ key: "g", label: "GATE  ", value: "12" }]));
    expect(out.boardingPass.primaryFields[0].label).toBe("GATE  ");
  });
});

describe("timeFormat 24h", () => {
  it("renders HH:mm from the ISO string's own local time and strips the attrs", () => {
    const out = resolvePassFields(pass([{ key: "b", label: "BOARDING", value: "2026-10-12T16:05:00+08:00", timeFormat: "24h", timeStyle: "PKDateStyleShort" }]));
    expect(out.boardingPass.primaryFields[0]).toEqual({ key: "b", label: "BOARDING", value: "16:05" });
  });
  it("keeps a non-ISO value and still strips timeFormat", () => {
    const out = resolvePassFields(pass([{ key: "b", label: "B", value: "", timeFormat: "24h" }]));
    expect(out.boardingPass.primaryFields[0]).toEqual({ key: "b", label: "B", value: "" });
  });
  it("keeps changeMessage", () => {
    const out = resolvePassFields(pass([{ key: "b", label: "B", value: "2026-10-12T07:40:00+08:00", timeFormat: "24h", changeMessage: "Boarding now %@" }]));
    expect(out.boardingPass.primaryFields[0].changeMessage).toBe("Boarding now %@");
  });
});

it("is pure and idempotent", () => {
  const input = pass([{ key: "b", label: "{departureCityName:upper}", value: "2026-10-12T16:05:00+08:00", timeFormat: "24h" }], { departureCityName: "Manila" });
  const snapshot = structuredClone(input);
  const once = resolvePassFields(input);
  expect(input).toEqual(snapshot);
  expect(resolvePassFields(once)).toEqual(once);
});

it("covers additionalInfoFields and backFields too", () => {
  const out = resolvePassFields({ boardingPass: { backFields: [{ key: "t", label: "{departureTerminal}", value: "" }], additionalInfoFields: [{ key: "x", label: "{departureCityName}", value: "" }] }, semantics: { departureTerminal: "3", departureCityName: "Manila" } });
  expect(out.boardingPass.backFields[0].label).toBe("3");
  expect(out.boardingPass.additionalInfoFields[0].label).toBe("Manila");
});
```

- [ ] **Step 2:** `npx vitest run tests/field-render.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement** `field-render.js` using `styleKey` + `FIELD_ZONES` from `template.js`, `SEMANTIC_CATALOG` from `semantics.js`, `isLooseIsoDateTime` from `iso-date.js`. `HH:mm` = the `THH:MM` digits sliced from the string. Clone with `structuredClone` once, then rewrite fields.
- [ ] **Step 4:** run → PASS; re-export from `index.js`; `npm test` green.

---

### Task 3: Wire into `formStateToPassJson` + schema

**Files:**
- Modify: `packages/pass-builder/form-to-pass.js`
- Modify: `packages/pass-schema/schema.json` (`definitions.fieldList.items.properties` and `iOS26.additionalInfoFields.items.properties`)
- Modify: `packages/pass-schema/index.js` JSDoc typedef for a field (add `timeFormat?: "24h"`)
- Test: `tests/form-to-pass.test.js`, `tests/migrate.test.js`

**Interfaces:**
- Changes: `formStateToPassJson(s, { resolveFields = true } = {})` — when `true` (default, all existing callers), the returned pass.json has gone through `resolvePassFields` **after** `applyPassDates`. When `false`, labels keep tokens and 24 h fields keep their ISO value + `timeFormat` (the *binding surface* — used by Task 5).
- Schema: field items gain `"timeFormat": { "enum": ["24h"] }`.

- [ ] **Step 1: Failing tests**

```js
// tests/form-to-pass.test.js — add (reuse the file's existing fixture loader for a valid FormState `base`)
it("resolves label tokens and 24h time fields by default; raw with resolveFields:false", () => {
  const s = structuredClone(base);
  s.semantics = { ...s.semantics, departureCityName: "Manila", currentBoardingDate: "2026-10-12T16:05:00+08:00" };
  s.displayFields.primary = [{ key: "depart", label: "{departureCityName:upper}", value: "MNL" }];
  s.displayFields.auxiliary = [{ key: "boarding", label: "BOARDING", value: "2026-10-12T16:05:00+08:00", timeFormat: "24h" }];
  const built = formStateToPassJson(s);
  expect(built.boardingPass.primaryFields[0].label).toBe("MANILA");
  expect(built.boardingPass.auxiliaryFields[0]).toEqual({ key: "boarding", label: "BOARDING", value: "16:05" });
  const raw = formStateToPassJson(s, { resolveFields: false });
  expect(raw.boardingPass.primaryFields[0].label).toBe("{departureCityName:upper}");
  expect(raw.boardingPass.auxiliaryFields[0].timeFormat).toBe("24h");
});
it("schema accepts timeFormat 24h and rejects other values", () => {
  const s = structuredClone(base);
  s.displayFields.auxiliary = [{ key: "b", label: "B", value: "2026-10-12T16:05:00+08:00", timeFormat: "24h" }];
  expect(validate(s).valid).toBe(true);          // match validate()'s actual return shape in validate.js
  s.displayFields.auxiliary[0].timeFormat = "12h";
  expect(validate(s).valid).toBe(false);
});

// tests/migrate.test.js — add
it("passes a new-shape state with timeFormat through untouched", () => {
  const s = { meta: {}, branding: {}, barcode: {}, semantics: {}, displayFields: { auxiliary: [{ key: "b", label: "B", value: "x", timeFormat: "24h" }] } };
  expect(migrateFormState(s)).toBe(s);
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** the option + schema entries. Check `validate.js`'s return shape and adjust the assertion to it before running.
- [ ] **Step 4:** run → PASS. Also run `npm run check` (all fixtures still validate) and `npm run build:pass -- --in fixtures/fully-loaded.json` (CERT_PROFILE=dev) to confirm a build still emits.

---

### Task 4: Wallet preview resolves too

**Files:**
- Modify: `apps/designer/src/preview/wallet/model.js` (`toPassView`), `apps/designer/src/preview/wallet/detail.js` (`renderDetail`)
- Test: `tests/wallet-model.test.js`

**Why:** the Issue workspace previews `previewFor(t.preview, …)` — a template's pass.json with this passenger's ISO dates merged into bound fields. For a Studio design `t.preview` will be the *unresolved* surface (Task 5), so the renderer must resolve it. Already-resolved input is a no-op (idempotent).

- [ ] **Step 1: Failing test** — `toPassView` on a pass with a `{departureCityName:upper}` label and a 24 h ISO field yields the label "MANILA" and value "16:05" in the mapped field.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** — first line of both functions: `pass = resolvePassFields(pass);` (import from `@wpd/pass-builder/field-render.js`, the same way `preview/index.js` imports `form-to-pass.js`).
- [ ] **Step 4:** run → PASS; `npx vitest run tests/wallet-*.test.js tests/issue-*.test.js` green.

---

### Task 5: Persisted Studio bindings (server)

**Files:**
- Modify: `apps/server/src/template-bindings.js`
- Modify: `apps/server/src/routes/designs.js` (bindings PUT/DELETE; delete bindings with the design)
- Modify: `apps/server/src/routes/templates.js` (`handleStudioTemplateList`)
- Test: `tests/designs-route.test.js` (extend; it already sets up `DESIGNS_DIR`, `STATE_PATH`)

**Interfaces:**
- Produces (`template-bindings.js`):
  - `studioBindingsId(name) → "studio:" + name` (no collision: `TEMPLATE_ID_RE` forbids `:`).
  - `designBindingSurface(state) → formStateToPassJson(migrateFormState(state), { resolveFields: false })`.
  - `bindingsForDesign(name, surface) → Promise<{ bindings, saved: boolean }>` — stored map filtered to field keys the surface still declares (`templateFieldKeys`), `saved: true`; else `discoverBindings(surface)`, `saved: false`, **not persisted** (live discovery keeps tracking an unconverted design as it's edited).
- Produces routes (control plane, under the existing guard):
  - `PUT /api/designs/:name/bindings` — body `{semanticKey: fieldKey}`; 404 if no design; validated with the existing `sanitizeBindingEdits(body, surface)`; stores under `studio:<name>`; responds `{name, bindings}`.
  - `DELETE /api/designs/:name/bindings` — drops the stored map (back to live discovery); 200 `{ok: true}` even when none was stored.
  - `DELETE /api/designs/:name` also drops `studio:<name>` bindings.
- Changes `GET /api/studio-templates` entries: `fieldKeys`, `fields` (descriptors), `bindings`, and **`preview`** come from the unresolved surface; new `bindingsSaved: boolean`. (`preview` must be unresolved so Issue can merge ISO values into 24 h fields; the renderer resolves it — Task 4.)

- [ ] **Step 1: Failing tests** (in `designs-route.test.js`, reusing its `call` helper; import `handleDesignBindingsPut`, `handleDesignBindingsDelete` from `designs.js`):
  1. A design whose fields carry no sample values (blank `boarding` with `timeFormat: "24h"`, blank semantics) lists with `bindingsSaved: false` and no `currentBoardingDate` binding.
  2. `PUT …/bindings {currentBoardingDate: "boarding"}` → 200; the list now shows `bindingsSaved: true`, `bindings.currentBoardingDate.fieldKey === "boarding"`, `source: "manual"`, and that field's descriptor kind is `"date"`.
  3. PUT with an undeclared field key → 400; unknown semantic → 400; unknown design → 404.
  4. Re-saving the design (PUT `/api/designs/:name`) keeps the stored bindings; removing the bound field from the design drops that entry from the listed bindings (filtered, not deleted from storage).
  5. `DELETE …/bindings` → list back to `bindingsSaved: false`; `DELETE /api/designs/:name` then re-creating it shows `bindingsSaved: false`.
  6. `preview` of a design with a token label still contains the token (unresolved).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Import storage helpers into `designs.js`; keep the write-then-rename design save untouched.
- [ ] **Step 4:** run → PASS; `npx vitest run tests/templates-view.test.js tests/issue-workspace.test.js` still green (they consume `/api/studio-templates`).

---

### Task 6: Status updates use the design's stored bindings

**Files:**
- Modify: `apps/server/src/routes/admin.js` (`applyStatus`, `applyStatusToStoredPass`)
- Test: `tests/admin-status.test.js`

**Interfaces:**
- Changes: `applyStatus(state, body, { bindings } = {})` — uses `bindings` when given, else today's `discoverBindings(stateDiscoveryJson(next))`.
- `applyStatusToStoredPass`: for a FormState record with `rec.designName`, look up `getTemplateBindings(studioBindingsId(rec.designName))`; pass it when stored, else omit (today's behaviour). Discovery from the pass's own state remains the fallback because an issued pass carries real values.

- [ ] **Step 1: Failing tests**
  1. Pure: a state whose `boarding` field holds `"2026-10-12T16:05:00+08:00"` with `timeFormat: "24h"` (semantics in sync): `applyStatus(state, {currentBoardingDate: "2026-10-12T16:45:00+08:00"})` sets the field value to the new ISO string, keeps `timeFormat`, sets the default `changeMessage`, and `skipped` is empty. (Proves Task 1's discovery fix covers status.)
  2. Pure: with `{bindings: {currentBoardingDate: {fieldKey: "boarding"}}}` and a field value that does NOT match the semantic (drifted), the field is still updated.
  3. Rebuild: `formStateToPassJson(updatedState)` shows `"16:45"` in that field with the changeMessage intact.
- [ ] **Step 2:** run → FAIL (2 fails; 1 may already pass after Task 1 — keep it as a regression pin).
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npx vitest run tests/admin-*.test.js tests/status-validation.test.js` → PASS.

---

### Task 7: Designer UI — Bindings for Studio cards

**Files:**
- Modify: `apps/designer/src/templates.js`
- Test: `tests/templates-view.test.js`

**Behaviour:**
- Studio cards get a **Bindings** link next to Edit design (same `data-act="bindings"`, plus `data-kind="studio"`), with the same "N to review" hint designer cards show when `bindingsSaved` is false and guesses exist.
- `mode` for the bindings screen becomes `{ view: "bindings", kind, id }`; the template is looked up in `designer` or `studio` by kind. `bindingsFor` (deep-link) keeps meaning a designer template.
- Confirm PUTs to `/api/templates/:id/bindings` (designer) or `/api/designs/:name/bindings` (studio).
- Studio only: a **Reset to automatic** link (DELETE) shown when `bindingsSaved`, with a one-line explanation: "Automatic bindings follow the design's sample values; confirmed ones stay fixed when you clear them."
- The screen title for a studio design reads `<name> · bindings`, with a "Studio design" kind chip.

- [ ] **Step 1: Failing DOM tests** (stub `fetch` as the file already does): studio card renders a Bindings action; clicking it opens the screen with the design's fields in the dropdowns; Confirm issues `PUT /api/designs/pal/bindings` with the draft; Reset issues `DELETE /api/designs/pal/bindings`; designer flow still PUTs `/api/templates/:id/bindings`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.

---

### Task 8: Designer UI — 24 h toggle and label-token hint in Design → Fields

**Files:**
- Modify: `apps/designer/src/form.js` (`isDateField`, `fieldRow`, `applySuggestions`)
- Test: `tests/design-editor.test.js`

**Behaviour:**
- `isDateField(f)` also true for `f.timeFormat !== undefined` (the typed date picker keeps the value ISO).
- A date row gets a compact segmented toggle **Phone format · 24-hour**:
  - 24-hour → set `timeFormat: "24h"`, delete `dateStyle`/`timeStyle`.
  - Phone format → delete `timeFormat`, set `timeStyle: "PKDateStyleShort"` (keep an existing `dateStyle`).
- `applySuggestions` treats a `timeFormat` field as a date field (keeps the ISO value, keeps `timeFormat`).
- Under the Fields section header, one hint line: "Labels can show flight values: `{departureCityName:upper}`, `{destinationAirportName}` …" — the label input's `title` lists the same. The preview already shows the resolved label (Task 3), which is the feedback loop; no autocomplete in this phase.

- [ ] **Step 1: Failing DOM tests:** a `timeFormat` field renders the date picker and the toggle with 24-hour active; toggling to Phone format writes `timeStyle` and removes `timeFormat` in state; `applySuggestions` keeps `timeFormat` + ISO.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (style the toggle with the existing segmented-control tokens in `styles.css`). **Step 4:** run → PASS.

---

### Task 9: Issue round-trip pin (tests only)

**Files:**
- Test: `tests/issue-model.test.js`

- [ ] **Step 1:** Using a studio template entry shaped like `/api/studio-templates` (unresolved preview, bindings `{currentBoardingDate: {fieldKey: "boarding"}}`, `boarding` field with `timeFormat: "24h"` and blank value): `templateSlots` exposes a boarding-time slot; `buildStudioIssueBody` with a typed boarding date writes the ISO into `displayFields.auxiliary[boarding].value` and keeps `timeFormat`; `formStateToPassJson(body)` renders `"16:05"`; `toPassView(previewFor(t.preview, …))` renders `"16:05"` too.
- [ ] **Step 2:** run. If anything fails, fix in `issue/model.js` (expected: no change needed — `passengerFieldValues` already writes ISO for date-kind slots).

---

### Task 10: Docs, browser check, review

- [ ] `AGENTS.md` → Architecture: Studio designs' bindings may be persisted (`studio:<name>` in `template_bindings`, `PUT/DELETE /api/designs/:name/bindings`), else live-discovered; label tokens + `timeFormat: "24h"` resolved by `resolvePassFields` (pass-builder) in `formStateToPassJson` and the wallet preview; Studio shelf entries ship the unresolved surface.
- [ ] `README.md` route table: the two new routes.
- [ ] Browser check on the dev server (`designer-dev` in `.claude/launch.json`; `CERT_PROFILE=dev`): a design with `{departureCityName:upper}` label and a 24-hour boarding field previews "MANILA" / "16:05"; Bindings from its Studio card confirms + survives a re-save; issuing one pass from it and pushing a boarding-time change shows the new `HH:mm` in the Flights panel's pass preview.
- [ ] `npm test`, `npm run check`, `npm run build:designer` green.
- [ ] HANDOFF.md session entry (what shipped, deploy notes: no DB migration — same table; rsync `packages/pass-schema/`, `packages/pass-builder/`, `apps/server/`, rebuilt `apps/designer/dist/`).

## Out of scope (later phases)

Routes store and API, `passes.route_id`, shelf grouping, Issue-from-route, conversion of the box's PAL/EVA designs, optional fields, label tokens for bundles.

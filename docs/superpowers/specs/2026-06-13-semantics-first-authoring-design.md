# Semantics-first pass authoring — design

- **Date:** 2026-06-13
- **Status:** Approved (design); implementation pending (`writing-plans` next)
- **Scope:** Both authoring flows — the Designer (FormState) and the Issue/template flow.

## Problem

Today the pass-builder derives Apple **semantics from display-field values** via a discovered
`semanticKey → fieldKey` binding map. This inverts Apple's own model (Pass Designer treats
semantics as first-class, typed inputs) and causes real breakage:

- The cebpac template's auto-discovered bindings mapped the **depart/arrive time** fields onto
  `departureAirportCode`/`destinationAirportCode`, and the human `date` field onto the
  `*DepartureDate` **date** semantics — emitting garbage (`departureAirportCode: "12:15"`) and
  **non-ISO semantic dates**, which iOS rejects.
- The Issue flow renders every template field as a plain **text box** — no type awareness, so a
  date field is hand-typed ISO (the "boardingTime isn't a picker" complaint). The ISO datetime
  picker added earlier lives only in the Designer form.
- There is no way to author/edit semantics directly; they are a side effect of fields + bindings.

## Goals

1. **Semantics are the primary, typed authoring surface** in both flows (Pass-Designer-style).
2. **Typed inputs everywhere:** each input renders by its expected type — `date` → datetime
   picker, `boolean` → true/false, `number` → number, `personName`/`seats` → structured, etc.
3. **Emit only filled semantics;** require the Apple-required set, drop empty optionals
   (mirrors how the cebpac export behaves).
4. **"Suggest values"** button fills the non-semantic **display fields** *from* the semantics
   (smart-formatted, editable) — replacing server-side field→semantics derivation.
5. One shared implementation used by both flows.

## Non-goals

- No change to the signing pipeline, the PassKit web service, push, or storage transport.
- No redesign of branding/barcode/asset authoring (kept as-is).
- Not adding event-ticket / transit (rail) semantics beyond what's boarding-relevant.

## Architecture (Approach A — shared components, FormState evolves)

Three isolated, independently testable units, consumed by both flows:

### a. `typed-input` renderer — `apps/designer/src/inputs.js`
Renders one input for a `(type, value)` pair and reports changes via callback. Supported types:

| type | widget | value shape |
|---|---|---|
| `text` | text box | `string` |
| `date` | `datetime-local` + UTC-offset field (extracted from `form.js`) | ISO-8601 string |
| `number` | number input | `number` |
| `boolean` | true/false select | `boolean` |
| `personName` | given + family inputs | `{givenName, familyName}` |
| `seats` | list of row + number + type rows | `PassSeat[]` |
| `stringArray` | chips / comma list | `string[]` |
| `enum` | select of allowed values | `string` |
| `location` | latitude + longitude | `{latitude, longitude}` |
| `currency` | amount + ISO currency code | `{amount, currencyCode}` |

The date widget is the single source of the ISO parse/compose helpers (`splitIso`/`joinIso`),
moved out of `form.js` so the Designer and Issue flow share one implementation.

### b. Semantics catalog — extend `packages/pass-builder/semantics.js`
`SEMANTIC_CATALOG = { key: { type, required, label, group } }` covering the boarding-relevant
key universe (~60 keys from `docs/field-coverage.md`), each tagged with a `typed-input` type and
a `group` (`flight` / `route` / `schedule` / `passenger` / `status`). The existing
`BOARDING_SEMANTICS` (string/date/number/personName/seats) is the seed; the catalog adds the
remaining boarding-relevant keys and the richer types (`boolean`, `location`, `stringArray`,
`enum`, `currency`). `SEMANTIC_DATE_KEYS` and `TIMEZONE_KEY_ALIASES` continue to derive from it.

### c. Semantics editor — `apps/designer/src/semantics-editor.js`
Renders `typed-input`s for semantics, grouped. **Required** keys always shown and validated
non-empty; **optional** keys added via a grouped "+ add semantic" picker. Emits an object of
**filled values only**. In a trip context (Issue flow) it carries the existing
**shared ↔ per-passenger** toggle.

### d. `Suggest` engine — `packages/pass-builder/suggest.js` (pure, unit-tested)
`suggestDisplayValues(semantics, mapping) → { fieldKey: string }`. `mapping` is the template's
bindings (Issue flow) or a built-in semantic→displayField map (Designer). Per-type formatters:
`date` → readable (`formatDate`), `personName` → `"GIVEN FAMILY"`, `seats` → composite
(`"14A"`), `boolean` → `Yes/No`, `stringArray` → joined, `number` → `String`, `string` → as-is.

## Required vs optional

`REQUIRED_SEMANTICS` = the minimal set Apple's `BoardingPassValidator` enforces. **Seed** from
dev-sample's core (`airlineCode`, `flightCode`/`flightNumber`, `departureAirportCode`,
`destinationAirportCode`, `originalDepartureDate`/`currentDepartureDate`,
`originalBoardingDate`/`currentBoardingDate`, `passengerName`, `seats`) and **pin precisely**
during implementation by running the validator (the same pinned-SHA `buildpass validate` the CI
gate uses) against minimal fixtures. Emit rule: a semantic appears in `pass.json` only if it has
a non-empty value; required keys must be filled or build/issue is blocked client-side AND
validated server-side.

## Issue flow (templates)

Per-passenger row becomes: **Semantics editor** (primary, typed, required/optional, shared
toggle) + the **display-field inputs** (now typed by each field's *bound* semantic; unbound →
text) + a **"Suggest values"** button (fills display fields from the row's semantics via the
template's bindings). Trip-level shared semantics entered once; per-passenger ones per row.

Issue payload: `POST /api/passes { template, serialNumber, groupId, semantics, data }`.

- `semantics` — explicit, deep-merged into the template's semantics (`null` deletes a key);
  emit-only-filled enforced server-side.
- `data` — display-field values (suggested or manual), applied by key as today.
- **Server stops deriving semantics from fields.** `template-bindings`/`template-status`
  derivation is removed from the issue path; bindings remain only as the client-side Suggest map
  and for status-update targeting. The dry-run unknown-key check stays.

## Designer flow (FormState evolves)

`FormState` keeps `meta`, `branding`, `barcode`, assets. It replaces the structured
`flight`/`passenger` (and the `iOS26` semantic-ish fields) with:

- **`semantics`** — a first-class object over the catalog (typed, filled-only).
- **`displayFields`** — the boarding-pass layout: `{ header[], primary[], secondary[],
  auxiliary[], back[] }`, each entry `{ key, label, value }` (value Suggest-fillable).

The Designer form (`form.js`) becomes: Meta + Branding + Assets + Barcode (structured, as today)
+ **Semantics editor** + **Display-fields editor** (with Suggest). `formStateToPassJson` is
rewritten to emit `semantics` (filled-only, with the seat/personName/timezone-alias handling
moved into the catalog layer) and `boardingPass.*Fields` from `displayFields`. The preview
(`src/preview/wallet/`) reads the new shape.

## Data model & migration (highest risk)

- `packages/pass-schema` schema + JSDoc updated to the new `FormState` shape.
- Stored passes persist `rec.state` in the **old** shape. `migrateFormState(old) → new`
  runs on read (in `pass-build.js` / `storage.js` rowToRec path) so every already-issued
  FormState pass keeps building. The migration is pure and unit-tested against the existing
  `fixtures/*.json` (which are old-shape) — those fixtures are migrated in place as part of the
  work so the test suite exercises the new shape directly.
- Template `data` payload gains the reserved `semantics` key (already partially supported as a
  deep-merge reserved key; formalize it).

## Sequencing (within this one spec)

1. **Shared units** — `typed-input`, `SEMANTIC_CATALOG` (+ required set), `Suggest` engine, with
   unit tests. No flow wired yet. (Lowest risk, unblocks both flows.)
2. **Issue flow** — semantics editor + typed display fields + Suggest + payload/server changes.
   Independently shippable and testable; fixes the immediate cebpac breakage and the picker.
3. **Designer flow** — FormState evolution, `formStateToPassJson` rewrite, preview, and the
   `migrateFormState` converter. Gated behind the full test suite + a built-pass validation.

## Testing

- **Unit:** catalog types & required set; `Suggest` formatters per type; emit-only-filled;
  `typed-input` value round-trips (esp. `date` offset preservation); `migrateFormState` old→new;
  `formStateToPassJson` from the new shape.
- **Integration:** build a `.pkpass` from the new FormState and re-parse; issue a template pass
  with explicit `semantics` and assert the emitted `pass.json` (ISO dates, no garbage airport
  codes, required keys present, optionals absent when empty).
- **Validator:** run `buildpass validate` (pinned SHA) over a built pass to pin/confirm
  `REQUIRED_SEMANTICS`.
- **Browser E2E:** editors render the right widget per type; Suggest fills display fields;
  required-empty blocks issue/build.

## Open items (resolve during implementation)

- Pin the exact `REQUIRED_SEMANTICS` via the validator (seed above is a starting point).
- Confirm the boarding-relevant catalog subset to surface (start from `field-coverage.md`'s
  boarding-relevant list; exclude rail/event-only keys).
- Decide whether `migrateFormState` also rewrites the committed `fixtures/*.json` to the new
  shape (preferred) or only converts on read.

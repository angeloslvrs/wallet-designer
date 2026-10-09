# UI/UX overhaul — "Studio dark" (direction F)

**Status:** approved 2026-10-09 (direction F chosen from six interactive mockups in `docs/mockups/`; open `docs/mockups/f-studio-dark.html` for the reference prototype, `compare.html` for the alternatives).

## Why

The current SPA is organised by code module (Design = FormState editor, Issue = template merge, Manage = ops), not by what an operator is doing. Concretely:

1. Two parallel object models with no bridge: Design saves *FormState* snapshots ("saved designs", `/api/fixtures`); Issue consumes `.pkpasstemplate` bundles (`/api/templates`). The nav presents them as siblings, so users expect "design → save → issue the saved one" and can't.
2. "Build .pkpass" on the Design tab secretly issues (`POST /api/passes`) — a second issue path with different rules.
3. Four nouns for two things: saved design, fixture, template, bundle.
4. Dead-end empty states ("Nothing issued yet — build or issue passes in the Designer" points at the wrong tab).
5. Every page is a wall of equal-weight sections; no primary action above the fold.

## Direction

**Flights-first ops console with a studio canvas.** B's departures board as the landing view, C's rounded three-pane canvas for issuing and designing, iOS-dark palette with a light theme on the same tokens.

### Object model (one vocabulary)

| Noun | Definition | Backed by |
|---|---|---|
| **Template** | A look + default fields. Two kinds: `designer` (Pass Designer `.pkpasstemplate` bundle) and `studio` (a FormState design built in-app). Both appear on one shelf; both can be issued from. | `templates/<id>.pkpasstemplate/` · `fixtures/<name>.json` |
| **Flight** (trip) | A `groupId`; shared schedule/route/gate; owns passes. | `groupId` on stored passes |
| **Pass** | One passenger's issued, signed pass. | `passes` row |
| **Device** | A registration. | `registrations` |

"Saved design", "fixture", "bundle" disappear from the UI. The word **template** covers both kinds; a `kind` badge distinguishes them.

### Information architecture

Top-level nav (segmented control in the masthead): **Flights · Templates · Device log**. Two full-screen *workspaces* replace the masthead nav while open and offer `‹ Back`: **Issue** (template → flight → passengers → issued) and **Design** (studio template editor).

| Screen | Purpose | Replaces |
|---|---|---|
| Flights (landing) | Departures board (flight · gate · destination · departs/boards · status · passes/on-device) + docked control panel for the selected flight: status keys, gate/terminal/boarding/departure, reason, **Push to N devices**, passenger list, recent activity. | Manage |
| Templates | Shelf of template cards (pass thumbnail, kind badge, live count, Issue / Edit / Bindings / Duplicate / Delete) + "Design a new look" + "Upload .pkpasstemplate". | Issue step 1 + Templates card + Design's fixture picker |
| Bindings | Review of discovered `semanticKey → fieldKey` bindings with confidence flags, sample values, preview; Confirm / Later. Entered after an upload or from a card. | the "Advanced — semantic bindings" drawer |
| Issue · Flight | Shared trip fields (airline, number, trip id, from/to, gate/terminal, boarding/departure/arrival, time zones, expiry) with a live preview of shared values and derived facts (duration, relevantDate, expirationDate, semantics bound). Chips move a field to per-passenger. | Issue step 2 |
| Issue · Passengers | Three-pane canvas: left = input modes (Scan/paste · Type · Roster · CSV) + passenger list; centre = the pass (Front/Back flip, iOS 26 detail, lock screen); right = this passenger's fields + what's inherited from the flight. | Issue step 3 |
| Issue · Issued | Confirmation with per-pass QR + Add to Apple Wallet badge, copy links, add more, open flight. | Issue step 3's inline results |
| Design | Same three-pane canvas: left = Look / Fields / Flight data / Barcode / Advanced; centre = pass; right = fields on the front + semantics health. Save template (studio kind). | Design tab |
| Device log | Table of PassKit web-service events and pushes. | Manage's log card |

Rules carried over from the mockup:
- One primary action per screen (blue). Everything else is a quiet button.
- Validation errors appear on blur or submit, never before the user touches a field. The global "N fields need attention" counter is gone; the step's footer shows readiness.
- Every empty state contains the button that fixes it.
- The Add-to-Wallet badge is Apple's artwork, verbatim (unchanged rule).

### Visual system

Tokens live in `apps/designer/src/styles.css` `:root` (dark) and `[data-theme=light]`. Toggle persisted in `localStorage("wpd:theme")`; `prefers-color-scheme` seeds the default.

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#000` | `#F2F2F7` |
| `--card` | `#1C1C1E` | `#fff` |
| `--fill` (segmented track, hover) | `#2C2C2E` | `#E3E3E8` |
| `--field` (inputs) | `#121214` | `#FAFAFC` |
| `--pill` (segmented thumb) | `#636366` | `#fff` |
| `--line` | `#2C2C2E` | `#E5E5EA` |
| `--ink` / `--muted` / `--faint` | `#F2F2F7` / `#98989D` / `#636366` | `#1C1C1E` / `#6E6E73` / `#AEAEB2` |
| `--blue` (primary) | `#0A84FF` | `#0A84FF` |
| `--green` / `--amber` / `--red` | `#30D158` / `#FFB020` / `#FF453A` | `#30B356` / `#C07C00` / `#FF453A` |
| soft variants `--blue-soft --ok-soft --warn-soft --err-soft` | dark tints | light tints |
| `--shadow` | deep | soft |

Type: Inter (UI) + JetBrains Mono (flight numbers, serials, times, eyebrows). Radius: 9px controls, 12px rows, 16px cards. Status pills: mono caps on a soft tint. Gates in amber mono. The Wallet pass preview (`src/preview/wallet/*`) stays Apple-faithful and is **not** themed.

Motion (all CSS, all under 450 ms, `prefers-reduced-motion` disables): screen enter fade+rise with 45 ms stagger; segmented thumb slides; status pill "flap" on change; push button → Pushing… → ✓ Pushed + toast; pass 3D flip Front/Back; card lift on hover; drawer/panel slide.

### Data & API changes

1. **Template shelf** — `GET /api/templates` gains `kind: "designer"` on every bundle; a new `GET /api/library` (or the same route with `?all=1`) also returns studio templates: `{ id, kind: "studio", name, fieldKeys, preview: FormState summary, issued: n }` derived from `/api/fixtures`. Issue counts come from `GET /api/passes` grouped by `template` (designer) or `designName` (studio; new optional field stored on FormState passes at issue time).
2. **Issue from a studio template** — the Issue workspace, when the selected template is `studio`, loads the FormState, applies the flight step's values into `semantics`/fields, and posts one `POST /api/passes` (FormState body) per passenger. No new server route; `designName` is recorded on the stored pass so the shelf can count it.
3. **Flights board** — `GET /api/passes` already returns `groupId, passenger, seat, status, deviceCount, current{departureGate,currentBoardingDate,currentDepartureDate,...}, template`. The board derives per-flight rows client-side (status = most severe across passes; departs/boards from `current`; destination from a new `route` field). Add `route: { from, to, fromCity?, toCity? }` to the list response (from semantics, both shapes). No schema change.
4. **Design → Save template** = `PUT /api/fixtures/:name` (unchanged), labelled "template".
5. Everything in `AGENTS.md`'s security model is untouched: guard, no CORS, stable auth tokens, server-forced identity.

### Phases

Each phase ships green (`npm test`, `npm run check`, SPA build) and is deployable on its own. Old views stay reachable until their replacement lands, then are deleted with their tests.

1. **Tokens + shell + Flights board** — new `styles.css` tokens (dark/light), masthead with segmented nav, theme toggle, `flights.js` (board + panel) reusing `ops.js`, `route` in `GET /api/passes`. Manage becomes the Flights view; old `manage.js` deleted. *(done 2026-10-09)*
2. **Templates shelf + Bindings** — `templates.js` view, bindings screen (extracted from `issue.js`). *(done 2026-10-09: shipped as `kind`/`preview`/`logo` on `GET /api/templates` plus `GET /api/studio-templates`, not a single `/api/library`.)*
3. **Issue workspace** — `issue/` split into `flight.js`, `passengers.js`, `issued.js`; three-pane canvas; studio-template issuing; old `issue.js` deleted. *(done 2026-10-09: semantics-first `issue/model.js`; saved designs moved to `designs/` with `/api/designs`, studio cards gained Delete; `designName` stored in `passes.design_name`.)*
4. **Design workspace** — `form.js`/`semantics-editor.js` re-homed into the canvas layout (left tabs), Save template.
5. **Device log page + polish** — reduced-motion, keyboard nav, mobile collapse (board → cards; canvas → stacked), empty states, remove dead CSS.

### Invariants (do not break)

- View mounts abort the previous mount (`root._mountAbort`) — keep for every new view.
- Status API vocabulary is semantic keys; the panel's typed date fields use the same picker as today (`inputs.js`), validated by `ops.js: validateStatusValues`.
- No new npm deps. Vanilla JS, ESM, Vite.
- CSP in `index.html` stays as is (Inter is added to the Google Fonts stylesheet already allowed).

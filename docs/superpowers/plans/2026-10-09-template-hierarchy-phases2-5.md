# Template Hierarchy — Phases 2–5: Routes, Shelf + Issue, Conversion, Optional Fields

> Steps use checkbox (`- [ ]`) syntax. Test-first per task; `npm test` green after each.

**Spec:** `docs/superpowers/specs/2026-10-09-airline-route-flight-hierarchy.md`. Builds on phase 1 (persisted Studio bindings, label tokens, `timeFormat: "24h"`). Branch `feat/template-hierarchy`.

## Decisions taken while planning (defaults; revisit if wrong)

- **Route vocabulary** (`ROUTE_SEMANTICS`): flight identity (`airlineCode`, `flightCode`, `flightNumber`), the route group minus gates (gates are flight-level), and `duration`. Schedule is times of day in `schedule`, never ISO dates.
- **Overnight:** `arrivalDayOffset` 0–3.
- **Airline display name** on the grouped shelf: grouped by `semantics.airlineCode`; the name is the first non-generic `organizationName` among that code's templates (Studio first), where generic = "Airline"; else the code.
- **Route-owned values in Issue** are pre-filled as ordinary typed values (editable per flight; editing doesn't touch the route). The Flight step gains a **Date** field that composes the schedule from the route's times in each airport's zone.
- **Route editor** = the Issue workspace in route mode (Flight step only, primary "Save route"; dates in the pickers only contribute their times).
- **Re-parent:** a route row's "Move to" select lists the airline's other templates.
- **Deleting a route** is always allowed (issued passes are snapshots; their `route_id` stays as a label).

## Phase 2 — Routes store

### Task 2.1: `packages/pass-builder/route.js` (pure, browser-safe)
- `ROUTE_ID_RE` (= design-name rule), `ROUTE_SEMANTICS` (Set), `validateRoute(body) → string[]` (template `{kind: "studio"|"designer", id}`, values keys ⊂ ROUTE_SEMANTICS, schedule `HH:MM` strings, `arrivalDayOffset` int 0–3, `fields` string map).
- `routeSchedule(route, date, offsetFor) → {currentBoardingDate, currentDepartureDate, currentArrivalDate}` — `offsetFor(localIso, zone) → "+08:00"`; departure zone for boarding/departure, destination zone for arrival (falls back to departure zone).
- `suggestRouteId(values)` — `PR2987-MNL-TAC` style.
- Tests: `tests/route-model.test.js`.

### Task 2.2: server store + API (`apps/server/src/routes/flight-routes.js`)
- Files in `routes/<id>.json` (`ROUTES_DIR` env, gitignored), write-then-rename like designs.
- `GET /api/routes`, `GET/PUT/DELETE /api/routes/:id`; PUT validates (`validateRoute`) and that the referenced template exists (bundle dir / design file).
- Template DELETE and design DELETE 409 while a route references them.
- Tests: `tests/routes-route.test.js`.

### Task 2.3: passes carry `routeId`
- `passes.route_id` column (auto `ALTER TABLE`), `rec.routeId`; `POST /api/passes` accepts an envelope `routeId` on both shapes (must match `ROUTE_ID_RE`; existence not required — routes can be deleted later); echoed in the response and in `GET /api/passes`.
- Tests in `tests/issue-design-name.test.js` style.

## Phase 3 — Shelf + Issue

### Task 3.1: Issue model helpers (`issue/model.js`)
- `routeToShared(route, slots) → shared values` (semantic slots by canonical sem; `field:<key>` slots from `route.fields`).
- `routeFromShared(slots, shared, individual) → {values, schedule, fields}` — typed (non-blank) shared values only; semantics outside `ROUTE_SEMANTICS` and per-passenger slots excluded; schedule = `HH:MM` of the typed date slots + day offset arrival vs departure.
- Tests in `tests/issue-model.test.js`.

### Task 3.2: Issue workspace route support
- `mountIssue({ route, routeMode })`: loads `/api/routes/:id`; seeds shared values; **Date** field (normal mode with a route) fills the schedule; issue bodies carry `routeId`.
- Route mode: title "Route", trip id/expiry/per-passenger hidden, route id input, footer primary **Save route** (PUT), back to Templates.
- Normal mode Flight footer: quiet **Save as route** (opens route mode pre-filled from the current values).
- Tests: `tests/issue-workspace.test.js`.

### Task 3.3: grouped shelf + route rows
- Sections per airline (see decision); each template card lists its routes (flight, `DEP → DEST`, departure time, issued count) with Issue → / Edit / Move to / Delete, and **+ Route**.
- `main.js`: `onIssue(id, kind, route)`, `onRoute(id, kind, route?)`.
- Tests: `tests/templates-view.test.js`.

## Phase 4 — Conversion

### Task 4.1: `packages/pass-builder/convert.js` (pure)
- `planConversion(state, bindings) → { items, airlineCode, suggestedName, suggestedRouteId }` — every value classified with a suggested tier (`airline` keep · `route` move · `drop`), flags: foreign URL/SSID, route data in a label (proposes tokens + lifts the remainder into `*AirportName`), typed time text matching a schedule time (proposes a bound time field, 24h or phone format by the text's shape).
- `applyConversion(state, bindings, plan, decisions) → { airline, bindings, route }`.
- Tests: `tests/convert.test.js` — fixture modelled on the box's `PR2987MNL-TAC` (no real data needed).

### Task 4.2: conversion screen (Templates)
- "Make airline" on Studio cards → review list (tier select per item, flags shown), airline name (new) **or** an existing airline template to add the route to, route id; Create writes design (new only) + bindings + route. Source design untouched.
- Tests: `tests/templates-view.test.js`.

## Phase 5 — Optional fields

- Field property `optional: true` (schema); `resolvePassFields` omits optional fields whose value is blank after rendering. Design → Fields: "Hide when blank" toggle per row.
- Tests: `tests/field-render.test.js`, `tests/design-editor.test.js`.

## Wrap-up

AGENTS.md / README routes, HANDOFF entry, spec status, browser check of shelf → route → issue → convert, full suite + `npm run check` + `build:designer`.

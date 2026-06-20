# Plan: UI/UX polish — semantic compliance, push reliability, typed+labeled fields

Date: 2026-06-20 · Status: P0–P4 implemented (branch feat/semantics-compliance,
5 commits, 327 tests green) — pending on-device verification + merge/deploy.

## Goal
Polish the whole designer UI/UX: (1) verify Apple semantic-tag compliance, (2) make
gate/delay push updates reliable, (3) on BOTH Designer + Issue require the bare-minimum
semantic tags with an easy "add optional" path, (4) type every value input to its
expected shape (ISO-8601 picker, IANA tz, number, IATA, seat, enum, boolean, …), (5)
label everything + intuitive UX.

## Grounding (verified this session)
- Apple `BoardingPassValidator.swift` @ pinned SHA `170f2a11` (the CI SHA) enforces:
  - **errors (true minimum):** airlineCode, flightNumber, originalDepartureDate,
    originalBoardingDate, originalArrivalDate, departureAirportCode,
    departureAirportTimeZone, destinationAirportCode, passengerName
  - **warnings (recommended):** departureCityName, destinationCityName,
    destinationAirportTimeZone, seats
- Our `REQUIRED_SEMANTICS` was a self-described SEED and is WRONG: it omits the two
  required errors `originalArrivalDate` + `departureAirportTimeZone`, and over-requires
  `flightCode` / `currentDepartureDate` / `currentBoardingDate` / `seats`.
- `REQUIRED_SEMANTICS` drives Designer default-shown fields (`semantics-editor.js`) AND
  Issue required-by-binding markers (`template.js:118`) → one fix covers both surfaces.
- Web service (`routes/wallet.js`, `storage.js`) is spec-correct: `lastModified` is an
  RFC-1123 date, bumped by `updatePassData`/`updatePassState` before push; 304 +
  `passesUpdatedSince` comparisons are right. DO NOT churn it.
- Flakiness root cause is APNs delivery in `apns.js`: one cached http2 session, no
  reconnect/retry on GOAWAY, no 410-token pruning, no expiration/collapse-id; failures
  are not surfaced in the ops console.

## Phases
- **P0 Compliance baseline (pass-builder/semantics.js + tests)** — pin REQUIRED to the
  validator error set, add RECOMMENDED = warning set, export it, fix tests. Add a
  compliance test documenting the validator sets @ the SHA.
- **P1 Push reliability (apns.js + routes/admin.js + ops UI)** — reconnect+retry on dead
  session, keepalive ping, 410->unregister, apns-expiration + apns-collapse-id; surface
  sent/failed/pruned in the ops console. Mock-http2 unit tests.
- **P2 Designer semantics editor (semantics-editor.js, inputs.js, css)** — group by
  semantic group w/ headers; required first+marked, recommended section, optionals via
  grouped "+ add"; inline validation (validateFieldValue); per-field format hints; apply
  kindAttrs; new `timezone` (IANA) widget; date<->airport-tz helper.
- **P3 Issue per-passenger form (issue.js)** — group by semantic group, required-by-
  binding first+marked, typed inputs+hints+inline errors; "Advanced -> add semantic"
  disclosure to set unbound optionals via data.semantics.
- **P4 Shared consistency + a11y** — one shared field-row renderer for Designer/Issue/
  Manage; replace Manage prompt() quick-actions with the inline typed editor; labels/
  tooltips/empty-states/focus/aria.

## Decisions
- Sequence P0+P1 first, then P2->P4. Deploy after on-device verification.
- iOS 26 device available -> on-device checkpoints after P1 (push) and P2/P3 (rendering).
- Issue gets an "Advanced -> add semantic" disclosure (data.semantics path).
- Manage prompt() actions replaced by inline typed editor.
- Scope = semantics/forms/push + shared consistency. Preview-pane rendering polish is a
  separate follow-up (out of scope here).

## Conventions
No new deps. ESM vanilla JS. DOM tests via happy-dom. Immutability. semantics.js +
field-kinds.js are the single source of truth (never hardcode template key names).
`npm run check` + `npm test` + (CI) `buildpass validate` are the gates.

## On-device checklist (iOS 26)
- [ ] Issue a pass, install; push a gate change -> banner + gate updates within minutes.
- [ ] Push a delay/status -> STATUS row + transitStatus reflected in expanded view.
- [ ] Uninstall a pass -> next push prunes the 410 token (no permanent failures).
- [ ] Minimal-required pass installs and shows the semantic expanded boarding view.

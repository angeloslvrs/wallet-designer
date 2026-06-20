# Plan — status updates must change the visible field + carry a changeMessage (lock-screen banners)

**Date:** 2026-06-20
**Status:** in progress
**Branch:** `feat/status-change-banners`

## Problem (diagnosed from prod logs + the live signed pass)

Flight-delay / gate-change updates never appear on the iPhone. Investigation of
the deployed server (`10.1.2.237`, prod profile) proved the **push pipeline is
healthy**: every `POST …/status` is followed by `[apns] … -> 200` for each
registered device and an immediate device re-fetch
(`…/registrations?passesUpdatedSince=…` + `GET …/passes/…`). No 410s, no
transport errors, empty error log.

The fault is in the **pass content**. A Wallet lock-screen banner fires only when
a **rendered field** (`boardingPass.{header,primary,secondary,auxiliary,back}Fields`)
that carries a `changeMessage` containing `%@` changes value between the old and
new pass. Semantics-only changes never notify. Inspecting the live signed
`pass.json` for serial `PAL`:

- Visible `gate` header field = `132`, but `semantics.departureGate` = `b4` — the
  status update wrote **only** semantics; the visible field never changed
  (stale + no banner).
- `delay` additionalInfoField had **no** `changeMessage`.
- The **only** `changeMessage` in the entire pass was on the `status`
  additionalInfoField — and `additionalInfoFields` banner behavior is iOS-26-new
  and unproven vs. the classic rendered-field mechanism.

## Root cause

- **FormState path** (`apps/server/src/routes/admin.js: applyStatus`):
  deliberately stopped re-syncing the compact display fields, betting iOS 26
  renders gate/time from semantics. That bet yields neither a face update nor a
  banner.
- **Template path** (`apps/server/src/template-status.js: applyStatusToTemplateData`):
  `setBoundField` updates the bound visible field but writes a plain value with
  **no** `changeMessage`, so the value changes silently.

## Scope (chosen: "best-effort now")

- **Template/Issue flow — full fix.** Bindings (`semanticKey → fieldKey`) are
  persisted and dates are stored ISO, so gate/time/delay/status all update the
  visible bound field **and** fire a banner.
- **Designer/FormState flow — best-effort.** Display fields are free-form with no
  declared semantic link and times are pre-formatted strings (`"3:50 PM"`,
  unbindable). So: bind by value-match (gate + text fields), update the visible
  field + banner + keep semantics in lockstep; delay/status rows get banners;
  **unbindable keys (all flight times, unmatched fields) stay semantics-only and
  are reported** as "not on pass face". Fully-robust designer support (explicit
  field-level semantics + ISO date display fields) is deferred follow-up.

## Changes

1. **`apps/server/src/template-status.js`**
   - Add `STATUS_CHANGE_MESSAGES` (per-semantic default banner text, all `%@`) +
     `changeMessageFor(key)` (fallback `"%@"`). Exported (shared with admin.js).
   - `setBoundField`: always emit object form; attach `changeMessageFor(semKey)`
     unless the caller's patch **or** the existing field already has a
     `changeMessage`.
   - `delay` info row gains `changeMessage: "%@"`.

2. **`apps/server/src/routes/admin.js` (`applyStatus`, FormState)**
   - Discover bindings from a minimal `{boardingPass, semantics}` built from
     `state.displayFields` + `state.semantics` (`discoverBindings`), no `meta`
     needed.
   - For each generic string/date semantic (gate/times/transitProvider/
     securityScreening): write semantics, and if bound, update the visible
     display field's `value` + default `changeMessage` (lockstep). Unbound →
     semantics-only, push key to `skipped`.
   - `delay` row gains `changeMessage: "%@"`.
   - Return `{ state, skipped }` (was: bare state). Update the one route caller
     to surface `skipped` honestly (no `isSemanticDriven` suppression for
     FormState — that's the point of the reporting).

3. **`apps/designer/src/ops.js` (`describePushResult`)**
   - Reword `template lacks: X` → `not on pass face: X` (accurate for both
     shapes).

## Tests (TDD; vitest + happy-dom)

- `tests/template-status.test.js` — bound fields now object-form `{value,
  changeMessage}` with the default; explicit changeMessage still wins; existing
  changeMessage preserved when caller sends a plain value; delay row carries
  `%@`.
- `tests/admin-status.test.js` — destructure `{state, skipped}`; bound gate
  display field updates + gets changeMessage + semantics stays in sync; a
  value-match gate binds while a formatted-time field does not (reported in
  `skipped`); delay row carries `%@`; immutability preserved.
- New regression: realistic FormState with a `gate` header field whose value
  equals `semantics.departureGate` → apply a gate status → `formStateToPassJson`
  → `boardingPass.headerFields` gate value changed **and** carries a
  `changeMessage`.
- `tests/ops.test.js` — wording assertions updated.

## Verify / deploy

- `npx vitest run` green; `npm run check` (fixtures vs schema); `npm run
  build:designer`.
- rsync `apps/server/`, `packages/pass-builder/`, `packages/pass-schema/`, built
  `dist/` to `10.1.2.237` per `docs/deploy.md`; `pm2 restart boardingpass`.
- Server-side proof: trigger a gate/delay status update, rebuild the pass, confirm
  the visible field changed **and** carries a `changeMessage`.
- On-device banner confirmation (gate + delay within ~minutes) is the user's to
  do — closes the long-standing HANDOFF backlog item.

## Out of scope / follow-up

- Designer-model overhaul for fully-robust FormState time updates (field-level
  semantics on display fields + ISO date/time display fields + preview +
  migration).
- Already-desynced existing FormState passes (e.g. `PAL`) need a re-issue to pick
  up the binding; the fix keeps display↔semantics in sync going forward.

# HANDOFF.md — session handoff for wallet-designer

**What this is:** context handoff from a claude.ai session (2026-06-10) into Claude Code, for sessions running **inside an existing clone of `angeloslvrs/wallet-designer`**. The code in this directory is ground truth — read the files listed below to verify anything here. This doc carries only what the repo cannot tell you: external context, decisions, invariants, environment state, and the backlog.

> **2026-06-10 Claude Code session:** the template pipeline below is now **implemented** (without a real Designer export — see the annotated backlog). Format was grounded on `apple/pass-builder`'s own personalization docs/protobufs instead. Stand-in template: `templates/dev-sample.pkpasstemplate` (see `templates/README.md` for the swap procedure when a real export lands).

---

## What this repo is

A self-hosted Apple Wallet **boarding-pass platform**: build/sign pipeline, full PassKit web service, APNs push, and admin routes — deployed on a Proxmox LXC behind Nginx Proxy Manager + pm2.

Ground-truth files to skim before changing anything:

| File | What it actually does |
|---|---|
| `apps/server/src/routes/wallet.js` | All five PassKit `/v1/*` endpoints, mounted at `/api/wallet` |
| `apps/server/src/apns.js` | APNs HTTP/2 push; dev profile logs, `prod` pushes for real |
| `apps/server/src/storage.js` | SQLite store (`state/passes.sqlite`, built-in `node:sqlite`; legacy `state/passes.json` imported once on first boot): passes (FormState- or template-backed), registrations, device log |
| `apps/server/src/routes/admin.js` | Issue + update triggers, incl. `POST /api/groups/:groupId/status` (whole-flight push) |
| `apps/server/src/routes/templates.js` | Upload/list `.pkpasstemplate` bundles |
| `apps/server/src/pass-build.js` | Stored record → signed `.pkpass` (branches FormState vs template) |
| `apps/server/src/template-status.js` | Status/issue semantics, map-driven (vocabulary = Apple semantic keys; NO template key conventions assumed) |
| `apps/server/src/template-bindings.js` | Stored-or-discovered binding map per template (+ edit validation) |
| `packages/pass-builder/bindings.js` | `semanticKey → fieldKey` binding discovery from a template's sample values |
| `apps/server/src/index.js` | Route mounting, access guard (`/api/wallet/*` public, rest LAN/Basic-Auth), rate limiting |
| `packages/pass-builder/` | `form-to-pass.js`, `template.js`, `template-zip.js`, `manifest.js`, `sign.js`, `validate.js` |
| `packages/pass-schema/schema.json` | FormState shape (incl. `webServiceURL`, `authenticationToken`) |
| `docs/cert-day.md`, `docs/deploy.md` | Real-cert workflow; LXC/NPM/pm2 deployment |

Commands: `npm install` · `npm run init` · `npm run dev` (designer :4318, API :4317) · `npm run build:pass -- --in fixtures/fully-loaded.json` · `npm test`

## External context the repo doesn't know (June 2026)

Apple shipped two first-party pass tools. Both are early/beta — re-verify before depending on details:

- **Pass Designer** (free Mac app, **requires macOS 27 beta**): visual pass editor whose preview is the *actual iOS renderer*; edits iOS 26 semantic tags in-UI; saves a `.pkpasstemplate` — a macOS bundle, i.e. a folder of skeleton `pass.json` + images. **No API, no server features** — the file is the only integration point.
- **`apple/pass-builder`** (github.com/apple/pass-builder, Apache-2.0, Swift 6.3+, macOS 14+/**Linux**): library + `buildpass` CLI with `personalize` (applies a protobuf payload to a template), `sign`, and `validate` (Apple's own validators: BoardingPassValidator, SeatValidator, FieldFormattingValidator, RequiredImagesValidator). Its `Protobufs/*.proto` and `Sources/.../Pass.swift` double as living documentation of valid pass.json/semantics fields. Its `Personalizing_Pass_Templates.md` + `PassPackage.proto` are what this repo's template-merge contract was grounded on.

Neither tool serves passes, tracks registrations, or pushes updates. Those exist only in this repo.

## Direction (decided — supersedes anything older)

**Pass Designer becomes the design surface. This repo becomes the platform + ops console.**

1. **Design**: Pass Designer → `.pkpasstemplate`, stored under `templates/` or uploaded via `POST /api/templates/:id` (zipped bundle as raw body).
2. **Build**: template-merge path in Node — `packages/pass-builder/template.js`: load template `pass.json` → merge per-pass data by field key (+ reserved keys `semantics`, `additionalInfoFields`, `barcodeMessage`, `barcodeAltText`) → copy template assets → existing `manifest.js`/`sign.js` (untouched). `buildpass validate` stays an external QA gate only.
3. **Serve + update**: unchanged (`wallet.js`, `apns.js`, `storage.js`). `pass-build.js` branches per record shape at rebuild time.
4. **SPA pivot**: `apps/designer` becomes the **operations console** — issued-pass tables, gate/status editing, push buttons, registration counts, `/v1/log` viewer. The admin API routes exist (incl. `skippedFields` reporting and `GET /api/templates` field-key listing); they need a face.

**Field-key contract:** the field keys in the template (`gate`, `seat`, `passengerName`, ...) are the API between Pass Designer and this server. `serialNumber`, `authenticationToken`, and `webServiceURL` are always injected server-side, never trusted from a template. Issue-time data is dry-run-merged so unknown keys fail at `POST /api/passes`, not at device fetch.

## Invariants — do not break

1. `authenticationToken` is **stable per serialNumber** across re-issues (rotating it 401s installed passes). `storage.js` enforces this — including across shape changes (FormState ↔ template re-issues). Covered by `tests/template-storage.test.js`.
2. Wallet auth comparison stays **timing-safe** (`util/timing-safe.js`).
3. `webServiceURL` must be public HTTPS with a publicly trusted cert; `/api/wallet/*` stays internet-reachable (access guard exempts it). Tailscale-only breaks updates off-tailnet.
4. `GET /v1/passes/...` **rebuilds the .pkpass at fetch time** from stored state (both shapes, via `pass-build.js`). Updating = mutate state, bump `lastModified`, push an **empty** APNs notification (topic = `passTypeIdentifier`, client TLS identity = the signing cert PEMs).
5. Wallet status codes are spec-mandated: 201 / 200 / 204 / 304 / 401 / 404 — devices depend on them exactly.
6. Keep server deps minimal; vanilla JS; no framework creep. (Only dep added for templates: `adm-zip`, already in the test toolchain.)
7. Minimal, targeted diffs over rewrites; match existing patterns.

## Environment state

- Apple Developer Program: **paid**. Real Pass Type ID cert per `docs/cert-day.md`.
- Dev profile uses a self-signed cert → builds pass tests but won't install on iOS. Real pushes require `profile=prod` + `signerCert.pem`/`signerKey.pem` in `certDir`.
- **Pass Designer not yet available** (needs macOS 27 beta) — hence the dev-sample stand-in template.

## Backlog

### Migration to template pipeline
- [x] Export a real boarding-pass template from Pass Designer; **inspect its `pass.json` first** (field-key naming is the one unknown — lock conventions from what Designer actually emits), then commit under `templates/`. *Done 2026-06-13: `templates/cebpac.pkpasstemplate` committed faithfully (Designer 1.0 export — `_id` UUIDs, `tooling.json`, pre-filled sample semantics, `preferredStyleSchemes`, letter-only `seatNumber`). The inspection killed the key-convention question for good: field keys are arbitrary per template, so the server now hardcodes APPLE's semantic vocabulary and DISCOVERS per-template `semanticKey → fieldKey` bindings instead (see the 2026-06-13 entry below).*
- [x] `template-loader` in `packages/pass-builder`: read a `.pkpasstemplate` bundle → `{ passJson, assets }` *(`template.js: loadTemplate`)*
- [x] Template-merge build path (FormState path untouched and still working) *(`template.js: applyTemplateData/buildPkpassFromTemplate`, served via `apps/server/src/pass-build.js`)*
- [x] Storage: per-pass data + template reference instead of full FormState (stable-token rule preserved, tested) *(`storage.js: saveTemplatePass/updatePassData/getPassRecord`)*
- [x] Admin route to upload a zipped `.pkpasstemplate` (Mac → LXC drag-and-drop) *(`POST /api/templates/:id`, zip-slip-guarded; `GET /api/templates` lists field keys)*

### Ops console *(done 2026-06-10 — Manage view in the SPA)*
- [x] Issued-passes table per flight/group: serial, passenger, registration count, lastModified, template badge
- [x] Gate/status editor (gate/boarding/depart/arrive/transit/screening/delay) wired to `POST /api/passes/:serial/status` + `POST /api/groups/:groupId/status`; `skippedFields` surfaced in push summaries (`apps/designer/src/ops.js`)
- [x] `/v1/log` viewer in the SPA (read side added as `GET /api/log` in `routes/admin.js`)
- [x] Template manager in the SPA *(2026-06-11: Templates card in the Issue view — list installed bundles (id/field keys/assets), browser upload (file input → raw-zip `POST /api/templates/:id`), and delete via new `DELETE /api/templates/:id`, which 409s while any stored pass references the bundle (installed passes rebuild from it on every fetch). Tested in `tests/template-delete.test.js`.)*
- [x] Issue-from-template UI (template picker + data form from `GET /api/templates` field keys) *(2026-06-11: Issue view in the SPA — `apps/designer/src/issue.js`; trip-id composer, per-passenger rows generated from field keys, suggested `<groupId>-<NNN>` serials (editable), one `POST /api/passes` per row with per-row inline errors, Add-to-Wallet/QR per issued pass. Template issuing no longer needs curl.)*

### Carried over
- [x] Fix README (wallet service, APNs, admin routes, prod profile, template pipeline) *(2026-06-10)*
- [~] Verify prod push end-to-end: real iPhone, gate change via group route, `changeMessage` lock-screen banner. *(2026-06-20: ROOT-CAUSED + fixed the content side — status updates now update the visible field AND auto-attach a `changeMessage`, on BOTH pass shapes; see the 2026-06-20 "status change banners" session below. Push transport was already proven healthy in the logs. **Only the on-device banner observation is left** — add a registered cebpac pass to the iPhone and change a boarding/departure time.)*
- [x] `buildpass validate` QA gate (build once in LXC/CI; pin the pass-builder commit) *(2026-06-11: `.github/workflows/apple-validate.yml` — builds a dev-sample pass headlessly (`build:pass --template`), unzips it, and runs `buildpass validate` built from `apple/pass-builder` pinned to `170f2a11` (cached Swift build, `swift:6.3-noble` container). What `validate` checks for us: BoardingPass/EventTicket/FieldFormatting/RequiredImages/Seat validators over the uncompressed bundle — structural + semantic only, NO signature verification, so the self-signed dev cert is irrelevant. Local companion `npm run validate:apple` uses `$BUILDPASS_BIN`/PATH and exits 0 with a "skipped" note when no binary exists.)*
- [x] Field-coverage diff vs `Protobufs/PassSemantics.proto` + `PassSeat.proto` *(2026-06-11: `scripts/field-coverage.mjs` → `docs/field-coverage.md`, protos read at the same pinned SHA as CI (`170f2a11`; `PASS_BUILDER_DIR` env for offline reruns). Coverage measured by executing the pipeline, not parsing source. Result: 29/103 semantics covered, 33 boarding-relevant missing (top gaps: `transitStatus`/`transitStatusReason`, `confirmationNumber`/`ticketFareClass`/`priorityStatus`, city-name fields), 2/9 PassSeat. Drift found: we emit `departure/destinationLocationTimeZone` which are NOT proto fields — proto names are `departure/destinationAirportTimeZone`; verify on-device before renaming.)*
- [x] Close the top field-coverage gaps *(2026-06-12: 41/103 semantics covered, 5/9 PassSeat (was 29 + 2). Status vocabulary gained `transitStatus`/`transitStatusReason` on both pass shapes — semantics plus a visible "status" row whose `changeMessage` ("%@") makes the push banner carry the why ("Delayed — crew availability"); status bodies may also pass any field as `{value, changeMessage}` (template path keeps the patch). Ops editor (Manage view) gained a status select + reason input and a per-pass "Status" quick action. Issue path: `deriveIssueSemantics` in `template-status.js` maps per-passenger data (passenger/seat/gate/confirmation/fare-class/priority) into stored semantics at issue time so template placeholder semantics never ship — explicit `data.semantics` wins; dev-sample declares `confirmation`/`fare-class`/`priority` backFields and the Issue view picked the new inputs up with ZERO form-code changes (design intent confirmed). Designer flow now also emits city names, membership program name/number, boardingZone, internationalDocumentsAreVerified, silenceRequested; seats emit `seatRow`/`seatSection` DERIVED from `seatNumber` (cannot disagree with it — the old doubled-seat bug was a stale row) plus optional `seatDescription`; shared helpers live in `packages/pass-builder/semantics.js`. New `fixtures/delayed.json` demos the post-delay state. Timezone drift/rename still parked (device-gated); seatRow/seatSection rendering likewise awaits the first real-iPhone check.)*
- [x] SQLite migration *(2026-06-12: `storage.js` now persists to `state/passes.sqlite` via built-in `node:sqlite` (zero new deps; resolved through `process.getBuiltinModule` because vitest's Vite v1.x can't resolve the static import). Public API + semantics unchanged — every pre-existing test passes unmodified; stable token per serial across shapes/reboots covered in `tests/storage-sqlite.test.js`. Schema: `passes` (serial PK, pass_type_identifier, authentication_token, group_id, template, state_json, data_json, last_modified — record shape = whichever columns are non-NULL, so FormState vs template records round-trip exactly; upsert keeps rowid → snapshot key order), `registrations` (PK device+serial), `device_log` (bounded ring of 1000, now durable — a single INSERT isn't the write-amplification DoS the old whole-file persist was), `meta`. WAL + synchronous=NORMAL for the single pm2 process. First boot one-shot imports a legacy `state/passes.json` (timestamped `.bak` first; `meta` flag makes it idempotent — verified against the real dev store: 4 passes, tokens intact, one backup across reboots); the JSON is never written again. ⚠ engines bumped to Node >=24 (`node:sqlite`) — the prod LXC needs a Node upgrade BEFORE the next redeploy; add to the deploy checklist.)*

- [x] Template reconciliation v2 — semantics-first, bindings discovered *(2026-06-13: the candidate-key-list approach is dead. Polarity fixed: semantic tags are APPLE's fixed vocabulary (boarding subset hardcoded as `BOARDING_SEMANTICS` in `packages/pass-builder/semantics.js`, cross-checked docs + protos); field keys are the DESIGNER's arbitrary vocabulary, so each template gets a discovered `semanticKey → fieldKey` binding map (`packages/pass-builder/bindings.js`: field-level `semantics` authoritative; exact value match; ±120s date proximity for `current*`; seat composite `seatRow+seatNumber`; passenger name tokens incl. `SURNAME/GIVEN`; ambiguous → unbound, confidence recorded so the UI flags guesses). Persisted in SQLite (`template_bindings`), recomputed on upload, computed on first use for pre-existing templates, editable in the Templates card (PUT `/api/templates/:id/bindings`); unbound is informational — iOS 26 renders `semanticBoardingPass` from semantics alone. Status API vocabulary = semantic keys on BOTH pass shapes; old verbs (`gate`, `boarding`, `depart`, `arrive`, `transitInfo`) are route-layer aliases (`normalizeStatusBody`). Issue path is map-driven: seat composites decompose into `{seatRow, seatNumber}` (the old `seatSection` guess is deleted — Designer 1.0 ground truth is letter-only seatNumber; PassSeat coverage is 4/9 by design now), date inputs fill `current*` AND `original*`, and VOLATILE template placeholders (six schedule dates, passengerName, seats) are null-cleared at issue unless re-derived (null deletes at merge) — `tests/issue-cebpac.test.js` proves no Designer sample timestamp/semantic survives. Hygiene: `tooling.json` excluded from builds and uploads; `_id` stripped from EMITTED pass.json only (bundles stay faithful). Time zones **resolved: emit both (docs and Designer disagree)** — `*LocationTimeZone` (docs) + `*AirportTimeZone` (Designer/protos), same IANA value, alias set in field-coverage so neither is drift; 43/103 semantics covered. CI validates every bundle under `templates/`.)*

- [x] Issue-time (and status-edit) input validation — typed inputs, inline errors, submit gate, server 400s *(2026-06-13: every issue/status input now validates against the type the template implies. Field validation derives from **bindings → semantics → kind**, NOT from hardcoded field-key names: `packages/pass-builder/field-kinds.js` maps each Apple semantic to a validation kind (`date`/`number`/`iata`/`name`/`seat`/`text` — airport-code semantics → `iata`, `boardingSequenceNumber` → `number` even though Apple types it a string), and `templateFieldDescriptors(passJson, bindings)` resolves each visible field's kind through the template's discovered binding map (style attrs `dateStyle`/`timeStyle`/`numberStyle` are the fallback when unbound). `GET /api/templates` now ships these descriptors. Issue UI (`issue.js`) renders the right input per kind (IATA uppercases + maxlength 3, sequence `inputmode=numeric`, dates keep the picker), shows an inline error on blur/submit, and disables **Issue** with a reason until valid; the Manage status editor (`ops.js: validateStatusValues` + `manage.js`) mirrors the same guardrails. Defense in depth: `issueTemplatePass` rejects malformed provided values (→ 400, per-field message) and uppercases IATA before storage; the status routes pre-validate via `template-status.js: validateStatusBody` (→ 400). Empty optional fields fall back to the template default; required-by-binding empties block the UI submit but the server only format-checks PROVIDED values. **IA:** the SPA now lands on **Issue** (template→issue→manage is the front door); the hand-designer is the secondary "Design (advanced)" tab, unchanged. Tests: `field-kinds`, `field-descriptors` (cebpac + dev-sample through their own bindings), `issue-validation`, `issue-validation-server`, `status-validation`, `ops` additions — 243 green; verified live against the real cebpac export.)*

## 2026-06-20 session — designer UX + early-expiry fix (main @ e09fa54, deployed + pushed)

Shipped (each has a plan in `docs/superpowers/plans/`):
- **Designer image uploads** (`2026-06-19-designer-image-uploads.md`): fixed uploaded
  images being silently dropped before signing. `packages/pass-builder/form-assets.js`
  (`imageAssetsFromBranding` + `BRANDING_IMAGE_SLOTS`) decodes data-URL uploads into
  bundle bytes; `buildPkpass` overlays them. Slots: logo/icon/footer/primaryLogo (iOS 26),
  PNG-only; Designer shows an upload + thumbnail per slot.
- **Scan → BCBP autofill** (`2026-06-19-scan-bcbp-autofill.md`):
  `packages/pass-builder/bcbp.js` (`parseBCBP` + `bcbpToSemantics`) parses IATA BCBP;
  `apps/designer/src/scan.js` is paste-first (paste→photo→camera);
  `apps/designer/src/bcbp-preview.js` is a shared preview-confirm modal; wired into BOTH
  Designer (`form.js`) and per-passenger Issue (`issue.js`) → autofill semantics + display
  fields and set the barcode message (reuses the existing `data.barcodeMessage` reserved key).
- **Pass expiry + relevantDate fix** (`2026-06-20-pass-expiry-relevant-date.md`): root cause
  of "pass expired months early" = stale hand-entered `relevantDate` + no `expirationDate`.
  `packages/pass-builder/expiry.js` (`applyPassDates`), applied in BOTH build paths, derives
  `relevantDate` from `currentBoardingDate ?? currentDepartureDate`, ALWAYS drops the legacy
  `relevantDates` array, and sets `expirationDate` = custom (`meta.expirationDate` /
  issue-time `data.expirationDate` reserved key) or **arrival + 1 day**. Verified live on the
  broken pass; the installed device copy was pushed.

Notes: no new deps; DOM tests use **happy-dom** (not jsdom). The prod LXC is now on
**Node v24.16.0** — the long-parked Node>=24 upgrade is DONE. Prod APNs push verified
end-to-end at the server (`sent:1`, no failures); on-device render confirmation still pending.

## 2026-06-20 session (cont.) — UI/UX polish (main @ 0341eb1, merged + deployed; CI green)

Full UI/UX pass — Apple semantic compliance, push reliability, typed/labeled fields.
Plan: `docs/superpowers/plans/2026-06-20-ui-ux-polish-semantics-push.md`. 5 phases, 327
tests, fixtures + SPA build green, `apple-validate` green on the merge. No new deps.

- **P0 compliance** (`packages/pass-builder/semantics.js`): `REQUIRED_SEMANTICS` was a SEED,
  never reconciled. Pinned it to Apple's `BoardingPassValidator.swift` @ `170f2a11` (the CI
  SHA): validator ERRORS → required, WARNINGS → new `RECOMMENDED_SEMANTICS`. **Correctness
  fix:** we were missing two hard-requirements (`originalArrivalDate`,
  `departureAirportTimeZone`) — a "minimal" pass would've failed Apple's validator — and
  over-requiring `flightCode`/`current{Departure,Boarding}Date`/`seats`. Drives BOTH the
  Designer editor's default-shown set AND the Issue form's required-by-binding markers
  (`template.js`). `tests/boarding-compliance.test.js` pins both sets to the SHA.
- **P1 push reliability** (`apps/server/src/apns.js` + `routes/admin.js` + `ops.js`): the web
  service was already spec-correct (lastModified RFC1123, 304, passesUpdatedSince) — the
  flakiness was APNs. Now: ping-check + reconnect on dead/GOAWAY session, retry-once,
  **410 "Unregistered" → unregister the device**, `apns-expiration` (24h) + `apns-collapse-id`
  (= serial). `pushUpdates` returns `{sent, failures, unregistered}`; `describePushResult`
  surfaces sent/failed/pruned in the Manage console. `deliver()` is factored to unit-test
  without mocking node:http2 (`tests/apns-deliver.test.js`).
- **P2 Designer editor** (`semantics-editor.js`, `inputs.js`): grouped sections
  (Flight/Route/Schedule/Passenger/Status/Pricing), required-first + required(*)/recommended
  markers, optionals via a grouped picker, inline validation, per-field hints, and
  expected-value widgets — new IANA **timezone picker** (datalist) for `*TimeZone` keys,
  `kindAttrs` affordances on text/number. Edits only the required `*AirportTimeZone` and
  mirrors to the hidden `*LocationTimeZone` twin (both spellings still emit). New pure
  helpers `widgetFor`/`fieldHint` in inputs.js (reused by Issue).
- **P3 Issue form** (`issue.js`): template display fields gained typed/timezone widgets,
  hints (from the bound semantic), required-first ordering, and friendly labels; each
  passenger's full semantics editor (inherits all P2 polish) is tucked into a collapsed
  **"Advanced — semantic tags"** disclosure.
- **P4 Manage** (`manage.js`): replaced the per-pass `prompt()` Gate/Delay/Status actions
  with the **same typed+validated inline editor** the trip level uses, scoped per serial
  behind an "Update this pass…" disclosure. One shared `statusEditorHtml(kind,id,acts)`;
  editorValues namespaced by scope (`grp:`/`pass:`).

Deferred deliberately: a fully unified field-row renderer across the three views (layouts
differ enough that sharing markup adds risk without user-visible gain — typed-input +
validation + hint logic is already shared via inputs.js/field-kinds.js). `AGENTS.md`
(Codex guidance mirror of CLAUDE.md, hook-generated) was committed on the branch — kept.

**Still device-pending (only you can confirm):** push reliability on a real iOS 26 device
(gate change + delay/status banner within ~minutes; 410-prune after uninstall); a
minimal-required pass installs + shows the semantic expanded view; the timezone picker.

## 2026-06-20 session — status change banners (main-bound; deployed @ 10.1.2.237)

Plan: `docs/superpowers/plans/2026-06-20-status-update-visible-fields-changemessage.md`.
Branch `feat/status-change-banners`, 332 tests green, rsynced + `pm2 restart`.

**Diagnosis (from prod logs + the live signed pass):** push pipeline is healthy —
every `POST …/status` → `[apns] … -> 200` for each device → device re-fetch. The
bug was the **pass content**: status updates wrote only `semantics` (or fields
with no `changeMessage`), so changes never showed on the pass face and never
raised a banner. A Wallet banner requires a **rendered** field carrying a
`changeMessage` (`%@`) to change value. The live `PAL` pass even had visible
`gate=132` while `semantics.departureGate=b4` (desynced by the old code).

**Fix (`packages`/server, no schema change):**
- `apps/server/src/template-status.js` — `STATUS_CHANGE_MESSAGES` + `changeMessageFor`;
  `setBoundField` now always emits object form and auto-attaches a per-semantic
  `changeMessage` (unless caller/field already has one); `delay` row gets `%@`.
- `apps/server/src/routes/admin.js` — `applyStatus` (FormState) now discovers
  `semantic→field` bindings from the in-sync state, updates the bound visible
  field + `changeMessage` in lockstep with semantics, and returns `{state, skipped}`
  (unbindable keys reported). Route surfaces `skipped`.
- `apps/designer/src/ops.js` — "template lacks:" → "not on pass face:".

**Verified on the box (deployed code):** cebpac `currentBoardingDate`→`boardingTime`
and `currentDepartureDate`→`date` render value + `changeMessage` ("Boarding now %@"
/ "Departure now %@"); delay row carries `%@`; FormState gate renders
`{value:"B4", changeMessage:"Gate changed to %@"}`.

**Known limits / next:** cebpac `departureGate` is **unbound** (sample value not
unique) → gate stays semantics-only; bind it in the Templates card for a gate
banner. FormState flight **times** are pre-formatted strings → unbindable, stay
semantics-only (the "best-effort" scope; full fix = designer emits field-level
semantics + ISO date fields). Already-desynced FormState passes (`PAL`,
`5J5056-001`) need a re-issue to pick up the binding.

**A/B RESULT (real iOS 26 device, 2026-06-20) — the banner mystery, solved:** a
`changeMessage` banner does NOT fire on a **semantic** pass
(`preferredStyleSchemes: ["semanticBoardingPass"]`, e.g. PAL): gate/delay changes
update the pass **silently**. An identical **classic** pass (no
`preferredStyleSchemes`, gate `changeMessage`) **DID** banner ("Gate changed to
Z9"). So iOS 26 routes semantic passes to the **Lock Screen Live Activity +
intelligent notifications** (semantics-driven, time-gated to near departure) and
suppresses the legacy banner — you can't have BOTH the iOS 26 rich view/Live
Activity AND classic banners on one pass. The `changeMessage` work is correct (it
drives classic passes). Test artifacts left on the box: template
`classic-ab.pkpasstemplate` + pass `CLASSIC-AB-1`; PAL was moved to a near-now
schedule + delayed during testing. See memory `ios26-semantic-pass-no-banner`.
Open product choice: add a "classic/banner mode" toggle (omit
`preferredStyleSchemes`) for users who want anytime banners over the iOS 26 look.

## Start here (next session)

1. Skim the ground-truth files above; confirm `main` is clean and `npx vitest run` is green.
2. Pick from the open roadmap (nothing in progress):
   - **Device verification (recommended):** real iOS 26 — (a) **push reliability** from the
     2026-06-20 polish: gate change + delay/status banner land within ~minutes, 410-prune
     after uninstall, Manage shows sent/failed/pruned; (b) a **minimal-required** pass installs
     + shows the semantic expanded view; (c) the new **timezone picker**; (d) carried over:
     `primaryLogo` render + PDF417/Aztec photo/camera decode (paste + parsing were
     unit-verified) and the prod e2e `changeMessage` lock-screen banner check.
   - **Issue-time barcode FORMAT/altText controls:** spec'd + planned, NOT implemented —
     branch `feat/issue-barcode-controls`
     (`docs/superpowers/specs/2026-06-13-issue-time-barcode-controls-design.md` +
     `docs/superpowers/plans/2026-06-14-issue-time-barcode-controls.md`). `data.barcodeMessage`
     already works; only `barcodeFormat` is missing.
   - **Flight lookup (P3): DEFERRED** — no flight API gives gate/terminal/scheduled times by
     flight# + date on a free tier, and paid keys are ruled out. Add behind a provider seam
     only if that changes.
   - **Polish (low priority):** render uploaded icon/footer in the wallet preview (only logo
     renders today); true hi-dpi @2x/@3x via in-browser canvas downscale; replace the
     `alert()` in `issue.js`'s scan handler with an inline note.
3. Apple PR #4 comment still parked (external, unrelated to the above).

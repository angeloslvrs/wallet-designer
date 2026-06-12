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
| `apps/server/src/storage.js` | JSON-file store (`state/passes.json`): passes (FormState- or template-backed), registrations, device log |
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
- [ ] Verify prod push end-to-end: real iPhone, gate change via group route, `changeMessage` lock-screen banner *(template path supports per-field `changeMessage` via the object form, e.g. `data.gate = {value, changeMessage}`)*
- [x] `buildpass validate` QA gate (build once in LXC/CI; pin the pass-builder commit) *(2026-06-11: `.github/workflows/apple-validate.yml` — builds a dev-sample pass headlessly (`build:pass --template`), unzips it, and runs `buildpass validate` built from `apple/pass-builder` pinned to `170f2a11` (cached Swift build, `swift:6.3-noble` container). What `validate` checks for us: BoardingPass/EventTicket/FieldFormatting/RequiredImages/Seat validators over the uncompressed bundle — structural + semantic only, NO signature verification, so the self-signed dev cert is irrelevant. Local companion `npm run validate:apple` uses `$BUILDPASS_BIN`/PATH and exits 0 with a "skipped" note when no binary exists.)*
- [x] Field-coverage diff vs `Protobufs/PassSemantics.proto` + `PassSeat.proto` *(2026-06-11: `scripts/field-coverage.mjs` → `docs/field-coverage.md`, protos read at the same pinned SHA as CI (`170f2a11`; `PASS_BUILDER_DIR` env for offline reruns). Coverage measured by executing the pipeline, not parsing source. Result: 29/103 semantics covered, 33 boarding-relevant missing (top gaps: `transitStatus`/`transitStatusReason`, `confirmationNumber`/`ticketFareClass`/`priorityStatus`, city-name fields), 2/9 PassSeat. Drift found: we emit `departure/destinationLocationTimeZone` which are NOT proto fields — proto names are `departure/destinationAirportTimeZone`; verify on-device before renaming.)*
- [x] Close the top field-coverage gaps *(2026-06-12: 41/103 semantics covered, 5/9 PassSeat (was 29 + 2). Status vocabulary gained `transitStatus`/`transitStatusReason` on both pass shapes — semantics plus a visible "status" row whose `changeMessage` ("%@") makes the push banner carry the why ("Delayed — crew availability"); status bodies may also pass any field as `{value, changeMessage}` (template path keeps the patch). Ops editor (Manage view) gained a status select + reason input and a per-pass "Status" quick action. Issue path: `deriveIssueSemantics` in `template-status.js` maps per-passenger data (passenger/seat/gate/confirmation/fare-class/priority) into stored semantics at issue time so template placeholder semantics never ship — explicit `data.semantics` wins; dev-sample declares `confirmation`/`fare-class`/`priority` backFields and the Issue view picked the new inputs up with ZERO form-code changes (design intent confirmed). Designer flow now also emits city names, membership program name/number, boardingZone, internationalDocumentsAreVerified, silenceRequested; seats emit `seatRow`/`seatSection` DERIVED from `seatNumber` (cannot disagree with it — the old doubled-seat bug was a stale row) plus optional `seatDescription`; shared helpers live in `packages/pass-builder/semantics.js`. New `fixtures/delayed.json` demos the post-delay state. Timezone drift/rename still parked (device-gated); seatRow/seatSection rendering likewise awaits the first real-iPhone check.)*
- [x] SQLite migration *(2026-06-12: `storage.js` now persists to `state/passes.sqlite` via built-in `node:sqlite` (zero new deps; resolved through `process.getBuiltinModule` because vitest's Vite v1.x can't resolve the static import). Public API + semantics unchanged — every pre-existing test passes unmodified; stable token per serial across shapes/reboots covered in `tests/storage-sqlite.test.js`. Schema: `passes` (serial PK, pass_type_identifier, authentication_token, group_id, template, state_json, data_json, last_modified — record shape = whichever columns are non-NULL, so FormState vs template records round-trip exactly; upsert keeps rowid → snapshot key order), `registrations` (PK device+serial), `device_log` (bounded ring of 1000, now durable — a single INSERT isn't the write-amplification DoS the old whole-file persist was), `meta`. WAL + synchronous=NORMAL for the single pm2 process. First boot one-shot imports a legacy `state/passes.json` (timestamped `.bak` first; `meta` flag makes it idempotent — verified against the real dev store: 4 passes, tokens intact, one backup across reboots); the JSON is never written again. ⚠ engines bumped to Node >=24 (`node:sqlite`) — the prod LXC needs a Node upgrade BEFORE the next redeploy; add to the deploy checklist.)*

- [x] Template reconciliation v2 — semantics-first, bindings discovered *(2026-06-13: the candidate-key-list approach is dead. Polarity fixed: semantic tags are APPLE's fixed vocabulary (boarding subset hardcoded as `BOARDING_SEMANTICS` in `packages/pass-builder/semantics.js`, cross-checked docs + protos); field keys are the DESIGNER's arbitrary vocabulary, so each template gets a discovered `semanticKey → fieldKey` binding map (`packages/pass-builder/bindings.js`: field-level `semantics` authoritative; exact value match; ±120s date proximity for `current*`; seat composite `seatRow+seatNumber`; passenger name tokens incl. `SURNAME/GIVEN`; ambiguous → unbound, confidence recorded so the UI flags guesses). Persisted in SQLite (`template_bindings`), recomputed on upload, computed on first use for pre-existing templates, editable in the Templates card (PUT `/api/templates/:id/bindings`); unbound is informational — iOS 26 renders `semanticBoardingPass` from semantics alone. Status API vocabulary = semantic keys on BOTH pass shapes; old verbs (`gate`, `boarding`, `depart`, `arrive`, `transitInfo`) are route-layer aliases (`normalizeStatusBody`). Issue path is map-driven: seat composites decompose into `{seatRow, seatNumber}` (the old `seatSection` guess is deleted — Designer 1.0 ground truth is letter-only seatNumber; PassSeat coverage is 4/9 by design now), date inputs fill `current*` AND `original*`, and VOLATILE template placeholders (six schedule dates, passengerName, seats) are null-cleared at issue unless re-derived (null deletes at merge) — `tests/issue-cebpac.test.js` proves no Designer sample timestamp/semantic survives. Hygiene: `tooling.json` excluded from builds and uploads; `_id` stripped from EMITTED pass.json only (bundles stay faithful). Time zones **resolved: emit both (docs and Designer disagree)** — `*LocationTimeZone` (docs) + `*AirportTimeZone` (Designer/protos), same IANA value, alias set in field-coverage so neither is drift; 43/103 semantics covered. CI validates every bundle under `templates/`.)*

## Start here (next session)

1. Skim the ground-truth files above.
2. Next up: **ops console** (SPA pivot) — the admin API is ready for it.
3. Deploy-day items parked: LXC Node >=24 upgrade, prod e2e push test, Apple PR #4 comment.

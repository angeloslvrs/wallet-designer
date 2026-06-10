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
| `apps/server/src/template-status.js` | Status vocabulary → template data (the ONE place template key conventions are assumed) |
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
- [ ] Export a real boarding-pass template from Pass Designer; **inspect its `pass.json` first** (field-key naming is the one unknown — lock conventions from what Designer actually emits), then commit under `templates/`. *Blocked on macOS 27 beta. Worked around 2026-06-10: pipeline grounded on `apple/pass-builder` docs/protobufs; `templates/dev-sample.pkpasstemplate` stands in. When the real export lands, the only code that may need adjusting is `apps/server/src/template-status.js` (key conventions) — the merge itself is convention-agnostic.*
- [x] `template-loader` in `packages/pass-builder`: read a `.pkpasstemplate` bundle → `{ passJson, assets }` *(`template.js: loadTemplate`)*
- [x] Template-merge build path (FormState path untouched and still working) *(`template.js: applyTemplateData/buildPkpassFromTemplate`, served via `apps/server/src/pass-build.js`)*
- [x] Storage: per-pass data + template reference instead of full FormState (stable-token rule preserved, tested) *(`storage.js: saveTemplatePass/updatePassData/getPassRecord`)*
- [x] Admin route to upload a zipped `.pkpasstemplate` (Mac → LXC drag-and-drop) *(`POST /api/templates/:id`, zip-slip-guarded; `GET /api/templates` lists field keys)*

### Ops console
- [ ] Issued-passes table per flight/group: serial, passenger, registration count, lastModified
- [ ] Gate/status editor wired to existing `POST /api/passes/:serial/status` + `POST /api/groups/:groupId/status` (responses now include `skippedFields` for template passes)
- [ ] `/v1/log` viewer in the SPA

### Carried over
- [x] Fix README (wallet service, APNs, admin routes, prod profile, template pipeline) *(2026-06-10)*
- [ ] Verify prod push end-to-end: real iPhone, gate change via group route, `changeMessage` lock-screen banner *(template path supports per-field `changeMessage` via the object form, e.g. `data.gate = {value, changeMessage}`)*
- [ ] `buildpass validate` QA gate (build once in LXC/CI; pin the pass-builder commit)
- [ ] Field-coverage diff vs `Protobufs/PassSemantics.proto` + `PassSeat.proto`
- [ ] SQLite migration when `state/passes.json` outgrows itself

## Start here (next session)

1. Skim the ground-truth files above.
2. Next up: **ops console** (SPA pivot) — the admin API is ready for it.
3. When Pass Designer becomes available: follow `templates/README.md` to swap the stand-in for a real export.

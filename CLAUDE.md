# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Designer + server for Apple Wallet airline boarding passes (including iOS 26 `semantics` expanded-view fields). Builds real, signed `.pkpass` files and implements the Apple PassKit Web Service so installed passes can be updated via APNs push.

## Commands

```bash
npm install
cp .env.example .env
npm run init                # one-time: generates self-signed dev cert + placeholder assets (required before any build)
npm run dev                 # designer SPA on :4318 (Vite) + API on :4317 (Express), via scripts/dev.js

npm test                    # vitest run (tests live in tests/ at repo root)
npx vitest run tests/manifest.test.js   # single test file
npm run check               # validate all fixtures/ against the JSON schema

npm run build:pass -- --in fixtures/fully-loaded.json   # headless CLI build → out/*.pkpass
npm run build:pass -- --template dev-sample             # headless template-path build (--serial, --data data.json)
npm run validate:apple      # Apple buildpass validators; exits 0 with a skip note if no binary (CI is the real gate)
node scripts/field-coverage.mjs   # regenerate docs/field-coverage.md from apple/pass-builder protos
npm run build:designer      # production SPA bundle → apps/designer/dist
npm start                   # production mode: one Express process serves built SPA + API on :4317
npm run cert:inspect        # inspect the active signing cert
```

Node >= 24 (the store uses built-in `node:sqlite`). Everything is ESM (`"type": "module"`) vanilla JavaScript — no TypeScript, no frontend framework.

## Architecture

npm-workspaces monorepo (`apps/*`, `packages/*`):

- **`packages/pass-schema`** — JSON Schema + JSDoc typedefs for `FormState`, the single source of truth for the pass data model shared by designer, server, and builder.
- **`packages/pass-builder`** — the core pipeline: `form-to-pass.js` (`formStateToPassJson`), `template.js` (load a `.pkpasstemplate` bundle + merge per-pass data by field key), `template-zip.js` (sanitize uploaded template zips), `manifest.js` (SHA1 manifest), `sign.js` (PKCS#7 detached signature via node-forge), zipped into `.pkpass` with archiver. `validate.js` checks FormState against the schema.
- **`apps/designer`** — Vite SPA with three views wired in `main.js`: **Designer** (form + tabbed preview; `src/preview/wallet/` renders the faithful Wallet-style preview), **Issue** (`issue.js` — issue template passes: picker from `GET /api/templates`, per-passenger rows from field keys, suggested serials, plus the template manager card for browser upload/delete), **Manage** (`manage.js`/`ops.js` — ops console: trip tables, status editor, group push, device log). View mounts abort the previous mount's listeners on re-mount (`root._mountAbort`) — keep that pattern or tab switches stack duplicate handlers.
- **`apps/server`** — Express API. Routes: `build.js` (build/download), `fixtures.js`, `admin.js` (issue passes, trigger pushes), `templates.js` (upload/list/delete `.pkpasstemplate` bundles; DELETE 409s while any stored pass references the template), `wallet.js` (Apple PassKit Web Service `/v1/*`). `apns.js` sends outbound push to `api.push.apple.com`. `storage.js` is a SQLite store (`state/passes.sqlite`, built-in `node:sqlite`; one-time imports a legacy `state/passes.json` on first boot) for issued passes + device registrations. `pass-build.js` turns a stored record into a signed `.pkpass` (branches FormState vs template). `template-status.js` maps the status-update vocabulary onto template data.

### Two build paths

Stored passes come in two shapes, both rebuilt at fetch time by `apps/server/src/pass-build.js`:

- **FormState** (`rec.state`) — the designer flow; `formStateToPassJson`.
- **Template** (`rec.template` + `rec.data`) — issue with `POST /api/passes {template, serialNumber, data, groupId}` against a bundle in `templates/<id>.pkpasstemplate/`. `data` addresses template fields **by key**; reserved keys: `semantics` (deep-merge; a `null` value DELETES the key — how issue-time clears placeholder semantics), `additionalInfoFields` (append/replace-by-key), `barcodeMessage`/`barcodeAltText`. Unknown keys fail at issue time (dry-run merge). `serialNumber`/`authenticationToken`/`webServiceURL`/`passTypeIdentifier`/`teamIdentifier` are always injected server-side, never trusted from a template.

### Semantics vs field keys (polarity rule)

Semantic tags are **Apple's** fixed vocabulary (boarding subset hardcoded in `packages/pass-builder/semantics.js` as `BOARDING_SEMANTICS`); field keys are the **designer's** arbitrary per-template vocabulary. NO code assumes template key names — each template gets a discovered `semanticKey → fieldKey` binding map (`packages/pass-builder/bindings.js`), persisted in SQLite (`template_bindings`), recomputed on upload, editable via `PUT /api/templates/:id/bindings` (Templates card). The status API vocabulary is semantic keys on both pass shapes (legacy verbs `gate`/`boarding`/`depart`/`arrive`/`transitInfo` are route-layer aliases); unbound semantics still update (iOS 26 renders `semanticBoardingPass` from semantics) and are reported in `skippedFields` as informational. At issue time, volatile template placeholders (the six schedule dates, `passengerName`, `seats`) are null-cleared unless re-derived from bound data; `tooling.json` and `_id` never reach an emitted pass (bundles on disk stay faithful to Designer's export). Time zones: emit **both** `*LocationTimeZone` (docs) and `*AirportTimeZone` (Designer/protos). `templates/cebpac.pkpasstemplate` is a real Pass Designer 1.0 export; `templates/dev-sample.pkpasstemplate` is the hand-written second naming convention exercising the same bindings path.

### QA gate

`.github/workflows/apple-validate.yml` runs on every push to `main`: builds a pass from `dev-sample` headlessly, unzips it, and runs Apple's `buildpass validate` (built from `apple/pass-builder` at a **pinned SHA** — `PASS_BUILDER_SHA` in the workflow). `scripts/field-coverage.mjs` reads protos at the **same SHA**; bump both together. `validate` checks structure/semantics only (no signature verification), and validation errors fail CI — `templates/dev-sample.pkpasstemplate/pass.json` carries sample semantics specifically to satisfy `BoardingPassValidator`; per-pass data overrides them at issue time.

### Cert profiles

`CERT_PROFILE` in `.env` selects `certs/dev/` (self-signed, from `npm run init`; passes build but won't install on iOS) or `certs/prod/` (real Apple Pass Type ID cert — signs passes **and** authenticates to APNs; see `docs/cert-day.md`). Prod certs, `.env`, and `state/` are gitignored and live only on the deploy box. The server forces `passTypeId`/`teamId` from env onto every issued pass.

### Security model (don't break these invariants)

- `apps/server/src/middleware/guard.js` is the access boundary: `/api/wallet/*` is **public** (Apple devices call it from the internet; each request is authenticated per-pass with the `ApplePass {authenticationToken}` header, compared timing-safely). **Everything else** (SPA, `/api/build`, `/api/passes`, `/api/fixtures`) is the control plane — private-IP/LAN only, or admin Basic Auth. Depends on `app.set("trust proxy", 1)` (exactly one proxy hop in front).
- No CORS on purpose — SPA is same-origin with the API, and PassKit calls are server-to-server. Don't add a wildcard.
- A pass's `authenticationToken` must stay **stable per serial** across re-issues — rotating it 401s copies already installed on devices (see `storage.js`).
- All token/credential comparisons go through `src/util/timing-safe.js`; user-supplied strings in the designer go through `src/esc.js` before hitting innerHTML.

### Production deploy

In production a single Express process serves the built SPA from `apps/designer/dist` and the API on one port, so one origin covers the UI, `/api`, and the pass `webServiceURL` callbacks. The dist bundle is gitignored — build locally with `npm run build:designer` and rsync it; the box runs prod deps only (no Vite). Full runbook (LXC + Nginx Proxy Manager + pm2, redeploy steps, caching gotchas): `docs/deploy.md`.

## Design docs

Specs and plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/` — check `2026-05-20-wallet-pass-designer-design.md` for original design decisions and `2026-06-05-faithful-wallet-pass-preview-design.md` for the preview renderer.

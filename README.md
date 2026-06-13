# wallet-pass-designer

Self-hosted Apple Wallet **boarding-pass platform**: build/sign pipeline, the
full Apple PassKit web service (installed passes update over APNs push), admin
routes to issue passes and drive gate/status changes for a whole flight, and a
designer SPA — including the iOS 26 `semantics` expanded-view fields.

Passes can be built two ways:

- **FormState path** — the designer SPA's JSON model (`packages/pass-schema`)
  → `formStateToPassJson` → sign.
- **Template path** — a `.pkpasstemplate` bundle (Pass Designer export, or the
  committed stand-in in [`templates/`](templates/README.md)) deep-merged with
  per-pass data by field key → sign. Apple's semantic vocabulary is fixed and
  hardcoded; each template's arbitrary field keys are mapped to it by a
  discovered, editable `semanticKey → fieldKey` binding map, so no code assumes
  a template's key names. `serialNumber`, `authenticationToken`,
  `webServiceURL`, `passTypeIdentifier`, `teamIdentifier` are always injected
  server-side, never trusted from a template.

Design specs live in `docs/superpowers/specs/`.

## Quick start

```bash
npm install
cp .env.example .env
npm run init          # generates dev cert + placeholder assets (incl. dev-sample template images)
npm run dev           # http://localhost:4318 (designer) + http://localhost:4317 (API)
```

Open the designer, edit the form, hit **Build .pkpass** — you'll get a
download. Dev-profile passes are structurally valid but won't install on iOS
until you swap to a real Apple cert (`docs/cert-day.md`).

The SPA has three views:

- **Designer** — the form + faithful Wallet-style preview (FormState path).
- **Issue** — issue template-backed passes without curl: pick an installed
  template, name the trip, fill one row per passenger (inputs generated from
  the template's field keys, serials suggested as `<groupId>-<NNN>`), get
  Add-to-Wallet links/QRs per pass. Also the template manager: upload a zipped
  `.pkpasstemplate` from the browser, inspect field keys, delete unreferenced
  bundles.
- **Manage** — the ops console: issued passes grouped by trip, gate/status
  editor with group push, device-log viewer.

## Headless / batch

```bash
npm run build:pass -- --in fixtures/fully-loaded.json   # → out/fully-loaded.pkpass
npm run build:pass -- --template dev-sample             # template path, → out/dev-sample.pkpass
npm run validate:apple                                  # Apple's buildpass validators (skips if not installed)
```

## HTTP surface

Everything below `/api` except the wallet web service is **control plane**:
reachable from private IPs/LAN only, or with admin Basic Auth
(`apps/server/src/middleware/guard.js`).

| Route | What it does |
|---|---|
| `POST /api/build` | FormState → registered live pass + signed `.pkpass` download |
| `POST /api/passes` | Issue a live pass. Body: full FormState, **or** `{template, serialNumber, data, groupId}` for the template path |
| `GET /api/passes` · `GET /api/passes/:serial` | Issued passes, registrations, device counts |
| `GET /api/passes/:serial/pkpass` | Re-download the signed pass (rebuilt from stored state) |
| `POST /api/passes/:serial/status` | Update status by **semantic key** (legacy verbs gate/boarding/depart/arrive/transitInfo accepted as aliases) + APNs-push that pass's devices. Semantics with no bound visible field still update and are reported in `skippedFields` |
| `POST /api/groups/:groupId/status` | Same update for **every pass on the flight** + push all devices |
| `DELETE /api/passes/:serial` · `/api/groups/:groupId` | Remove passes + registrations |
| `POST /api/templates/:id` | Upload a zipped `.pkpasstemplate` (raw body) → `templates/<id>.pkpasstemplate/`; (re-)discovers its `semanticKey → fieldKey` bindings |
| `GET /api/templates` | Installed templates + the field keys and discovered bindings each declares |
| `PUT /api/templates/:id/bindings` | Replace a template's `semanticKey → fieldKey` map with user-confirmed bindings (edited from the Templates card) |
| `DELETE /api/templates/:id` | Remove a bundle — **409 while any stored pass references it** (installed passes rebuild from their template on every fetch) |
| `/api/wallet/v1/*` | **Public.** The five Apple PassKit web-service endpoints (register/unregister device, list updated serials, fetch pass, log). Per-pass `ApplePass` token auth, timing-safe |

Updating a pass = mutate stored state, bump `lastModified`, send an **empty**
APNs notification; devices then re-fetch from `GET /v1/passes/...`, which
rebuilds the `.pkpass` from stored state at fetch time.

## Cert profiles

`CERT_PROFILE` in `.env` picks `certs/dev/` (self-signed, from `npm run init`)
or `certs/prod/` (real Pass Type ID cert — signs passes **and** authenticates
to APNs). Cert workflow: [`docs/cert-day.md`](docs/cert-day.md). Hosting
(LXC + Nginx Proxy Manager + pm2): [`docs/deploy.md`](docs/deploy.md).

## Layout

- `apps/designer` — Vite SPA, vanilla JS, two-pane (form + tabbed preview).
- `apps/server` — Express API: wallet web service (`routes/wallet.js`), admin
  (`routes/admin.js`), template upload (`routes/templates.js`), APNs push
  (`apns.js`), SQLite store (`storage.js`, `node:sqlite` — no external driver;
  a one-time import migrates a legacy `state/passes.json` on first boot),
  access guard (`middleware/guard.js`).
- `packages/pass-schema` — JSON-schema + JSDoc typedefs for FormState.
- `packages/pass-builder` — `form-to-pass.js`, `template.js` (load/merge/build
  `.pkpasstemplate`), `template-zip.js`, `semantics.js` (Apple's hardcoded
  boarding semantic vocabulary), `bindings.js` (per-template
  `semanticKey → fieldKey` discovery), manifest SHA1, PKCS#7 signing.
- `templates/` — `.pkpasstemplate` bundles ([readme](templates/README.md)).
- `scripts/` — dev cert bootstrap, placeholder-asset generator, CLI builder,
  Apple-validator runner (`validate-apple.js`), field-coverage generator
  (`field-coverage.mjs`).
- `fixtures/` — sample FormState JSON for tests and demos.

## Tests & QA

```bash
npm test              # vitest: unit + integration (builds & re-parses signed passes)
npm run check         # validate fixtures against the FormState schema
npm run validate:apple  # Apple's own validators, when a buildpass binary exists locally
```

Every push to `main` also runs **Apple's validators** against a freshly built
pass: `.github/workflows/apple-validate.yml` builds the `buildpass` CLI from
[apple/pass-builder](https://github.com/apple/pass-builder) at a pinned commit
and validates the unzipped bundle (structural/semantic checks only — no
signature verification, so the dev cert is fine). How our semantics stack up
against Apple's protobufs: [`docs/field-coverage.md`](docs/field-coverage.md).

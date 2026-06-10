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
  per-pass data by field key → sign. `serialNumber`, `authenticationToken`,
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

## Headless / batch

```bash
npm run build:pass -- --in fixtures/fully-loaded.json   # → out/fully-loaded.pkpass
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
| `POST /api/passes/:serial/status` | Update gate/boarding/depart/arrive/transitInfo/securityScreening/delayed + APNs-push that pass's devices |
| `POST /api/groups/:groupId/status` | Same update for **every pass on the flight** + push all devices |
| `DELETE /api/passes/:serial` · `/api/groups/:groupId` | Remove passes + registrations |
| `POST /api/templates/:id` | Upload a zipped `.pkpasstemplate` (raw body) → `templates/<id>.pkpasstemplate/` |
| `GET /api/templates` | Installed templates + the field keys each declares |
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
  (`apns.js`), JSON-file store (`storage.js`), access guard (`middleware/guard.js`).
- `packages/pass-schema` — JSON-schema + JSDoc typedefs for FormState.
- `packages/pass-builder` — `form-to-pass.js`, `template.js` (load/merge/build
  `.pkpasstemplate`), `template-zip.js`, manifest SHA1, PKCS#7 signing.
- `templates/` — `.pkpasstemplate` bundles ([readme](templates/README.md)).
- `scripts/` — dev cert bootstrap, placeholder-asset generator, CLI builder.
- `fixtures/` — sample FormState JSON for tests and demos.

## Tests

```bash
npm test              # vitest: unit + integration (builds & re-parses signed passes)
npm run check         # validate fixtures against the FormState schema
```

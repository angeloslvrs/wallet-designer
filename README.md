# wallet-pass-designer

Local dev tool for designing Apple Wallet airline boarding passes — including the iOS 26 `semantics` expanded-view fields.

Builds a real, signed `.pkpass` end-to-end. Uses a self-signed cert during development; swap in an Apple Developer Pass Type ID cert to ship to a real device.

Design spec: [`docs/superpowers/specs/2026-05-20-wallet-pass-designer-design.md`](docs/superpowers/specs/2026-05-20-wallet-pass-designer-design.md)

## Quick start

```bash
npm install
cp .env.example .env
npm run init          # generates dev cert + placeholder assets
npm run dev           # http://localhost:4318 (designer) + http://localhost:4317 (API)
```

Open the designer, edit the form, hit **Build .pkpass** — you'll get a download. The file is structurally valid but won't install on iOS until you swap to a real Apple cert.

## Headless / batch

```bash
npm run build:pass -- --in fixtures/fully-loaded.json
# → out/fully-loaded.pkpass
```

## Cert day

When you have an Apple Developer account, follow [`docs/cert-day.md`](docs/cert-day.md).

## Layout

- `apps/designer` — Vite SPA, vanilla JS, two-pane (form + tabbed preview).
- `apps/server` — Express API, single endpoint `POST /api/build`.
- `packages/pass-schema` — JSON-schema + JSDoc typedefs for FormState.
- `packages/pass-builder` — `formStateToPassJson`, manifest SHA1, signing wrapper, top-level orchestrator.
- `scripts/` — dev cert bootstrap, placeholder-asset generator, CLI builder, dev orchestrator, cert inspector.
- `fixtures/` — sample FormState JSON for tests and demos.

## Tests

```bash
npm test
```

Includes unit tests for `formStateToPassJson` and `computeManifest`, plus an integration test that builds a `.pkpass`, re-unzips it, and verifies internal consistency (manifest hashes match files, semantic tags survive the round-trip).

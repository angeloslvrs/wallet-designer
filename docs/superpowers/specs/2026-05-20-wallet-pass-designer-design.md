# Design: wallet-pass-designer

**Date:** 2026-05-20
**Status:** Approved (brainstorming complete)
**Author:** Angelo Soliveres

## Purpose

A local web app for rapidly designing, filling, and building Apple Wallet airline boarding passes that fully exercise the iOS 26 `semanticTags` expanded-view feature ([Apple docs](https://developer.apple.com/documentation/walletpasses/creating-an-airline-boarding-pass-using-semantic-tags)).

The prototype is a personal dev tool — single user, localhost only. Its job is to make every part of the `.pkpass` pipeline real *before* an Apple Developer account is in hand, so that cert-day is a config change, not a code change.

## Goals

- Live designer UI: form on the left, tabbed preview on the right (Pass Front / Pass Back / iOS 26 detail view).
- Complete schema for the iOS 26 airline boarding-pass `semanticTags`; UI form fields added incrementally.
- Output a real, signed `.pkpass` from day one using a self-signed dev cert.
- Cert-day handoff: drop three PEM files into `certs/prod/`, flip `CERT_PROFILE=prod` in `.env`, no code changes.
- Headless CLI for batch-generating passes from saved JSON fixtures.

## Non-Goals

- No multi-user, accounts, or DB-backed drafts. Drafts are JSON files in `fixtures/`.
- No Apple "passes web service" (push updates). Out of scope; can be added later.
- No support for non-airline pass types (event tickets, coupons, store cards).
- No iOS device emulation. The browser detail-view preview is an approximation; real device testing waits for cert-day.
- No deployment config. Localhost only.

## Architecture

Monorepo, npm workspaces, two runtime processes (Vite dev server + Express API server, started together by `npm run dev`).

```
wallet-pass-designer/
├── apps/
│   ├── designer/          # Vite SPA (vanilla JS) — form + live previews
│   └── server/            # Express — pass.json build, manifest, sign, zip
├── packages/
│   ├── pass-schema/       # TS types + JSON-schema for pass.json incl. semanticTags
│   └── pass-builder/      # Pure functions: form-state → pass.json → bundle
├── certs/
│   ├── dev/               # gitignored; bootstrapped by gen-dev-cert.sh
│   └── prod/              # gitignored; Apple PEMs dropped here on cert-day
├── scripts/
│   ├── gen-dev-cert.sh    # one-shot self-signed cert + WWDR-shaped CA
│   └── package-pkpass.sh  # CLI wrapper
├── fixtures/              # saved FormState JSON files for testing & demos
├── docs/
│   ├── cert-day.md        # runbook for Apple Developer-account day
│   └── superpowers/specs/ # this design doc
└── .env.example
```

**Runtime flow:**

1. User edits the form in the browser; form state is held as a single JS object.
2. SPA renders the active preview tab from that state (one of: pass front, pass back, iOS 26 detail view — HTML/CSS approximation of Apple's expanded view). Switching tabs is a re-render against the same state.
3. "Build .pkpass" button POSTs form state to `POST /api/build`.
4. Server: validates state against the JSON-schema → translates to `pass.json` (including `semanticTags`) → writes pass.json + assets to a temp dir → computes `manifest.json` (SHA1 of every file) → signs the manifest with `passkit-generator` using whichever profile `.env` selects → zips → streams the `.pkpass` back as a download.

**Single source of truth:** the form state. Both the browser preview and the server-side pass build read the same JSON. No drift between what you see and what you ship.

## Designer UI Layout

**Two-pane, tabbed preview (Option A from brainstorm):**

- **Left:** form, collapsible sections (Meta, Branding, Flight, Passenger, Barcode, iOS 26 semantic).
- **Right:** single preview pane with tabs `[Pass Front] [Pass Back] [iOS 26 Detail]`.
- Form fields land progressively (staged): every field exists in the data model, but the form starts with a minimum viable set and grows as needed. Adding a field is purely additive: add an input bound to the existing state path.

## Data Model

Three layers, one source of truth:

**1. `FormState`** — what the UI binds to. Flat-ish, friendly to controls:

```ts
{
  meta: { passTypeId, teamId, organizationName, serialNumber, description },
  branding: { logoText, foregroundColor, backgroundColor, labelColor },
  flight: {
    airlineCode, flightNumber,
    departure: { iata, name, city, terminal, gate, gateOpen, boarding, depart },
    arrival:   { iata, name, city, terminal, gate, arrive },
  },
  passenger: { name, frequentFlyerNumber, seats: [{ number, cabin, row, letter }], boardingGroup, seqNumber },
  barcode: { format, message, altText },
  iOS26: { duration, securityScreening, transitInfo, wifi: [{ ssid, password }] }
}
```

**2. `PassJson`** — the literal Apple shape, including the full `semanticTags` block. A pure function `formStateToPassJson(state): PassJson` lives in `packages/pass-builder/`. Every iOS 26 semantic field maps 1:1 from `FormState`.

**3. `PassBundle`** — the file list ready to zip: `pass.json`, `manifest.json`, asset files (`icon.png`, `icon@2x.png`, `logo.png`, optional `strip.png` / `footer.png`).

**Validation:** a JSON-schema is generated from the TS types via `ts-json-schema-generator`. The same schema runs server-side before signing *and* is imported by the SPA for live error highlighting. Single source of truth for the shape.

## Signing Pipeline

`passkit-generator` (npm) handles manifest + PKCS#7 detached signature. Two cert profiles selected by an env var:

```
CERT_PROFILE=dev   # default — self-signed
CERT_PROFILE=prod  # real Apple cert
```

The server looks in `certs/<profile>/` for three files:

- `signerCert.pem` — leaf signing certificate
- `signerKey.pem` — corresponding private key
- `wwdr.pem` — intermediate (Apple WWDR G4 in prod; self-signed CA in dev)

Plus `.env`:

- `PASS_TYPE_ID` (e.g. `pass.dev.local` in dev; `pass.com.rocketpartners.airline.boardingpass` in prod)
- `TEAM_ID`
- `KEY_PASSPHRASE` (optional)

### Today (`CERT_PROFILE=dev`)

1. `npm run gen-dev-cert` runs `scripts/gen-dev-cert.sh`, which uses `openssl` to:
   - generate a self-signed CA → `certs/dev/wwdr.pem`
   - generate a leaf signing cert with `passTypeIdentifier: pass.dev.local`, signed by that CA → `signerCert.pem`, `signerKey.pem`
2. `passkit-generator` signs with these files. The output is a real PKCS#7 detached signature, structurally identical to a prod signature.
3. The resulting `.pkpass` will *not* be trusted by iOS — its cert chain doesn't terminate at Apple Root — but it parses cleanly in `pkpasstool`, our own preview renderer, and any third-party validator.

### Cert-Day Runbook (`CERT_PROFILE=prod`)

Documented in `docs/cert-day.md`. Steps:

1. In the Apple Developer portal:
   - Register a Pass Type ID (e.g. `pass.com.rocketpartners.airline.boardingpass`).
   - Generate a CSR on the same Mac that will store the key.
   - Upload CSR, download the Pass Type ID Certificate (`.cer`).
   - Convert to PEM: `openssl x509 -inform DER -in pass.cer -out signerCert.pem`.
   - Export the private key from Keychain (the one paired with the CSR) → `signerKey.pem`.
   - Download the current Apple WWDR cert (G4) from Apple PKI → `wwdr.pem`.
2. Drop the three PEM files into `certs/prod/`.
3. Edit `.env`: set `CERT_PROFILE=prod`, `PASS_TYPE_ID=…`, `TEAM_ID=…`.
4. `npm run build:pass -- --in fixtures/demo.json`.
5. AirDrop / email the resulting `.pkpass` to an iPhone; tap to add to Wallet.

**Why this works:** there is zero code-path difference between dev and prod. The library doesn't care whose cert it is — it just signs. Bugs in our manifest, our pass.json structure, or our zip layout all surface in dev where they're cheap. The only thing that changes on cert-day is *trust*, not *correctness*.

## Testing

Light, since this is a dev tool:

- `vitest` unit tests on `pass-builder`: snapshot tests for `formStateToPassJson` against a fixture set (minimal pass, fully-loaded pass, multi-seat group).
- One integration test that builds a `.pkpass` with the dev cert and re-opens it: unzip, validate manifest SHA1s against the files, parse pass.json against the JSON-schema. If this passes, the pipeline is healthy.
- No browser E2E. Eyeballs are sufficient for a single-user dev tool.

## Convenience Scripts

In `package.json`:

- `npm run dev` — Vite + Express concurrently.
- `npm run gen-dev-cert` — bootstrap self-signed dev cert.
- `npm run build:pass -- --in fixtures/<name>.json` — headless CLI; emits a `.pkpass` without launching the UI. Useful for batching demos.
- `npm run check` — schema-validate all fixtures.
- `npm run cert:inspect` — print active profile + cert subject + expiry (sanity check before a demo).
- `npm test` — vitest.

## Open Questions

None blocking. Implementation-time decisions to revisit:

- Exact JS library choice for SHA1 + zip if `passkit-generator` proves limiting (`node-forge` + `archiver` as fallback).
- Whether to ship a small set of airline-branded fixtures (Rocket Partners airline?) or keep examples generic.
- Approximation fidelity of the iOS 26 detail view: how close do we get to Apple's actual rendering before diminishing returns?

## Pre-Implementation Checklist (before any code is written)

The following are *not* in scope for this design but must happen before/during implementation:

- [ ] Choose final library: `passkit-generator` vs `@walletpass/pass-js` — confirm both support iOS 26 `semanticTags` passthrough.
- [ ] Write `docs/cert-day.md` as a real runbook with screenshots of the Apple Developer portal flow.
- [ ] Source / commission the three required asset images (`icon.png` 29×29, `icon@2x.png` 58×58, `logo.png`) for the dev fixture.

## After This Spec

1. User reviews this spec file.
2. On approval, invoke the `writing-plans` skill to produce a detailed implementation plan.
3. Implementation begins per that plan.

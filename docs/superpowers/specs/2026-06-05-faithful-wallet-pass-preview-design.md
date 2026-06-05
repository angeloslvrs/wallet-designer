# Design: faithful Wallet pass preview (the "EVA Air" configurator)

**Date:** 2026-06-05
**Status:** Draft (brainstorming)
**Author:** Angelo Soliveres
**Extends:** [2026-05-20-wallet-pass-designer-design.md](./2026-05-20-wallet-pass-designer-design.md)

## Purpose

Upgrade the existing designer's preview from a stylized approximation to a **pixel-faithful Apple Wallet boarding pass**, so the tool doubles as a configurator for mocking up an EVA Air pass that looks like the real thing in a pitch.

The pipeline, schema, signing, passes-web-service, and APNs push already exist. **This is a preview-fidelity + configurator-ergonomics upgrade — not new backend.**

## Scope decisions (settled in brainstorm)

- **Fidelity tier: A — polished card.** Faithful pass *card* across the three existing tabs: **Front** (ticket), **Back** (field list), **iOS 26 Detail** (semantic expanded view). No iPhone device frame, no Live Activity surface in this deliverable.
- **Render source: from `pass.json`.** The preview imports the existing pure function `formStateToPassJson(state)` (`packages/pass-builder/form-to-pass.js`) and renders directly from `pass.boardingPass.*Fields`, `pass.barcodes[0]`, and the color keys. **One source of truth → preview == shipped pass.** No second, drifting layout model.
- **Real, scannable barcode.** Render the actual code (PDF417 / QR / Aztec / Code128, per `barcode.format`) from `barcode.message` using `bwip-js` in the browser. Scans with a phone — a real wow detail for the pitch.
- **Real branding assets.** Add a logo (and icon) image slot to the form; the faithful preview renders the uploaded logo image, falling back to `logoText`. (Embedding uploaded assets into the *signed* bundle is a small follow-on; for the pitch, EVA's logo can also be dropped into the assets dir the build already reads.)

### Non-goals (this spec)

- iPhone frame / Lock Screen / Dynamic Island / Live Activity rendering (was Tier B/C — the live *push* path already exists server-side; revisit if EVA wants the live demo).
- Any change to signing, schema, or the passes web service.
- Multi-pass-type support (still airline boarding pass only).

## The Apple boarding-pass anatomy we match

```
┌───────────────────────────────┐
│ [logo] EVA AIR        GATE SEAT│  header  (logo + <=3 right-aligned header fields)
│                                │
│  MNL        +        TPE       │  primary (origin -> destination, big IATA)
│  Manila              Taipei    │
│                                │
│ PASSENGER     FLIGHT           │  secondary
│ BOARDING  DEPART  GROUP  SEQ   │  auxiliary
+ .. . . . . . . . . . . . . . .+  <- perforation + side notches
│        |##|#| PDF417 |##|#     │  barcode + altText
└───────────────────────────────┘
```

Fidelity details that make it read as real Wallet (the current preview lacks these):
- **Ticket notch + dashed perforation** above the barcode.
- Correct **zone layout & label/value typography** (uppercase label in `labelColor`, bold value in `foregroundColor`).
- **Date/number formatting** honoring `dateStyle` / `timeStyle` / `numberStyle` on each field (e.g. ISO `2026-06-20T13:30:00+08:00` + `PKDateStyleShort` -> `1:30 PM`).
- `backgroundColor` / `foregroundColor` / `labelColor` applied from the pass (already `rgb()` strings).
- SF system font stack, Wallet corner radius + drop shadow.
- Apple field-count limits (header <= 3; graceful overflow/truncation).

## Architecture

A small, isolated **wallet renderer** under the designer app. Pure functions: `(passJson) -> DOM`. No state, no fetch.

```
apps/designer/src/preview/
├── index.js              # tab orchestrator (exists) — rewired to call wallet/*
└── wallet/
    ├── card.js           # FRONT: ticket card from boardingPass.{header,primary,secondary,auxiliary}Fields + notch
    ├── back.js           # BACK: backFields + additionalInfoFields list
    ├── detail.js         # iOS 26 semantic detail view (sections from semantics + iOS26)
    ├── barcode.js        # bwip-js wrapper -> <canvas>; maps PKBarcodeFormat* -> bwip type
    ├── format.js         # PKDateStyle / PKNumberStyle / time value formatting
    └── wallet.css        # Wallet-accurate styling (replaces inline styles)
```

**Data flow:**

```
FormState (state.js)
   |  formStateToPassJson(state)        <- imported from packages/pass-builder
   v
PassJson  -->  preview/wallet/card|back|detail.js  -->  faithful DOM
   |
   +---------->  POST /api/build (unchanged) --> signed .pkpass
```

Same `PassJson` feeds both branches -> the preview is guaranteed to match the artifact.

**Removed:** the old hand-styled `preview/front.js`, `preview/back.js`, `preview/detail.js` (their inline-styled layouts are superseded by `wallet/*`).

### Components (what each unit does / depends on)

| Unit | Does | Depends on |
|---|---|---|
| `wallet/card.js` | Lays out header/primary/secondary/auxiliary zones + notch | `format.js`, `barcode.js`, `wallet.css` |
| `wallet/back.js` | Renders `backFields` + `additionalInfoFields` as a Wallet back list | `format.js` |
| `wallet/detail.js` | iOS 26 expanded sections (flight, seats, wifi, security, transit, upcoming) | `format.js` |
| `wallet/barcode.js` | `(format, message) -> <canvas>`; format map + error fallback | `bwip-js` |
| `format.js` | Apple value formatting from `dateStyle`/`timeStyle`/`numberStyle` | — |

### Barcode format mapping (`barcode.js`)

| PassKit format | bwip-js type |
|---|---|
| `PKBarcodeFormatPDF417` | `pdf417` |
| `PKBarcodeFormatQR` | `qrcode` |
| `PKBarcodeFormatAztec` | `azteccode` |
| `PKBarcodeFormatCode128` | `code128` |

On encode error (e.g. message invalid for format): render a neutral placeholder block + the `altText`, never throw. New dep: `bwip-js` in `apps/designer/package.json`.

### Logo/icon assets

- Form gains an **assets** section: logo image picker (+ optional icon). On select -> read as data URL -> held in form state (preview-only key, e.g. `branding.logoDataUrl`), persisted via the existing localStorage path.
- `card.js` / `back.js` render `<img src=logoDataUrl>` when present, else `logoText`.
- Build embedding of uploaded assets is **out of scope here**; documented as a follow-on. For the pitch, a real `logo.png` in the assets dir is already honored by the build.

## Error handling

- Missing/blank fields -> Apple-style em-dash placeholder, never a crash.
- Unparseable date -> show raw string (don't throw).
- Barcode encode failure -> placeholder + altText (above).
- `formStateToPassJson` is trusted (same code path as build); preview wraps render in try/catch and shows an inline error banner rather than a blank pane.

## Testing

- **Unit (`format.js`):** date/time/number formatting cases (PKDateStyleShort time, PKDateStyleMedium date, numberStyle) — AAA, descriptive names.
- **Unit (`barcode.js`):** PassKit->bwip format map; placeholder path on encode error.
- **Unit (render adapters):** given a known `PassJson`, the card/back extract the expected label/value pairs into the right zones (DOM query assertions via jsdom/vitest).
- **Regression:** existing `pass-builder` + integration tests stay green (we only *consume* `formStateToPassJson`, don't change it).
- Visual fidelity: eyeball in-browser (single-user dev tool).

## Out-of-scope follow-ons (noted, not built here)

- Embed uploaded logo/icon into the signed bundle.
- Tier B (iPhone frame) / Tier C (Lock Screen Live Activity + Dynamic Island) preview surfaces — the APNs/web-service push path already exists; only the *rendering* would be new.
- LXC/NPM deployment for live device updates (separate ops task; requirements already confirmed: NPM + Let's Encrypt + prod cert is sufficient).

## Open questions

None blocking. Implementation-time: exact bwip-js render sizing per format; whether `detail.js` mirrors Apple's iOS 26 section order 1:1 (best-effort approximation is acceptable).

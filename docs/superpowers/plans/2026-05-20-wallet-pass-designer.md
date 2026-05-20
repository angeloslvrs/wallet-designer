# wallet-pass-designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Node web app that designs Apple Wallet airline boarding passes with iOS 26 `semanticTags`, signs them with a self-signed dev cert today, and accepts a real Apple cert on cert-day with zero code changes.

**Architecture:** npm-workspaces monorepo. Two server processes (Vite SPA + Express API) started together. Pure-function pass-builder package (`formState → pass.json → manifest → signed .pkpass`). One env var (`CERT_PROFILE`) selects dev vs prod signing material.

**Tech Stack:** Node 20+, Vite 5, Express 4, `passkit-generator` v3, OpenSSL (for dev cert), `sharp` (placeholder assets), `archiver` (zip), `vitest` (tests), vanilla JS for the SPA (no React/framework). ESM throughout. JSDoc-only types (no TypeScript build step).

---

## File Structure (locked in)

```
wallet-pass-designer/
├── package.json                                 # root, npm workspaces
├── .env.example
├── .gitignore                                   # already exists
├── README.md                                    # already exists
├── apps/
│   ├── designer/
│   │   ├── package.json
│   │   ├── vite.config.js
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.js                          # entry
│   │       ├── state.js                         # form-state store
│   │       ├── form.js                          # left-pane form rendering
│   │       ├── preview/
│   │       │   ├── front.js                     # pass front renderer
│   │       │   ├── back.js                      # pass back renderer
│   │       │   └── detail.js                    # iOS 26 detail view approximation
│   │       ├── tabs.js                          # tab switcher
│   │       ├── build.js                         # POST /api/build → download
│   │       └── styles.css
│   └── server/
│       ├── package.json
│       └── src/
│           ├── index.js                         # Express entry
│           ├── routes/build.js                  # POST /api/build
│           └── env.js                           # .env loader + profile resolver
├── packages/
│   ├── pass-schema/
│   │   ├── package.json
│   │   ├── index.js                             # exports schema + JSDoc typedefs
│   │   └── schema.json                          # hand-written JSON-schema
│   └── pass-builder/
│       ├── package.json
│       ├── index.js                             # exports buildPkpass()
│       ├── form-to-pass.js                      # formState → PassJson
│       ├── manifest.js                          # SHA1 manifest
│       ├── sign.js                              # passkit-generator wrapper
│       └── validate.js                          # schema validation (ajv)
├── scripts/
│   ├── gen-dev-cert.sh                          # openssl bootstrap
│   ├── gen-assets.js                            # sharp-based placeholder PNGs
│   ├── cert-inspect.js                          # print active profile + cert
│   ├── build-pass.js                            # headless CLI
│   └── dev.js                                   # concurrent Vite + Express
├── fixtures/
│   ├── minimal.json
│   ├── fully-loaded.json
│   └── multi-seat.json
├── tests/
│   ├── form-to-pass.test.js
│   ├── manifest.test.js
│   └── integration.test.js                      # full build → re-parse
├── certs/
│   ├── dev/.gitkeep
│   └── prod/.gitkeep
└── docs/
    ├── cert-day.md
    └── superpowers/
        ├── specs/2026-05-20-wallet-pass-designer-design.md
        └── plans/2026-05-20-wallet-pass-designer.md     # this file
```

---

## Task 1: Root workspace scaffolding

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `certs/dev/.gitkeep`, `certs/prod/.gitkeep`

- [ ] **Step 1: Write root package.json**

```json
{
  "name": "wallet-pass-designer",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "node scripts/dev.js",
    "gen-dev-cert": "bash scripts/gen-dev-cert.sh",
    "gen-assets": "node scripts/gen-assets.js",
    "init": "npm run gen-dev-cert && npm run gen-assets",
    "build:pass": "node scripts/build-pass.js",
    "cert:inspect": "node scripts/cert-inspect.js",
    "check": "node -e \"import('./packages/pass-builder/validate.js').then(m => m.validateAllFixtures())\"",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "concurrently": "^8.2.0",
    "sharp": "^0.33.0"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: Write .env.example**

```
# Cert profile selector — dev (default) or prod
CERT_PROFILE=dev

# Apple-issued in prod; arbitrary in dev
PASS_TYPE_ID=pass.dev.local
TEAM_ID=DEV0000000

# Organization shown on pass
ORG_NAME=Rocket Partners Airlines

# Server port
PORT=4317
VITE_PORT=4318

# Private key passphrase (optional)
# KEY_PASSPHRASE=
```

- [ ] **Step 3: Create cert placeholders**

```bash
mkdir -p certs/dev certs/prod
touch certs/dev/.gitkeep certs/prod/.gitkeep
```

- [ ] **Step 4: Commit**

```bash
git add package.json .env.example certs/
git commit -m "chore(scaffold): root workspace + env example"
```

---

## Task 2: pass-schema package

**Files:**
- Create: `packages/pass-schema/package.json`
- Create: `packages/pass-schema/index.js`
- Create: `packages/pass-schema/schema.json`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "@wpd/pass-schema",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "exports": {
    ".": "./index.js",
    "./schema.json": "./schema.json"
  }
}
```

- [ ] **Step 2: Write schema.json**

Hand-written JSON-schema for `FormState`. Sourced from the Apple iOS 26 semanticTags doc.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "wpd/form-state",
  "type": "object",
  "required": ["meta", "branding", "flight", "passenger", "barcode"],
  "additionalProperties": false,
  "properties": {
    "meta": {
      "type": "object",
      "required": ["passTypeId", "teamId", "organizationName", "serialNumber", "description"],
      "additionalProperties": false,
      "properties": {
        "passTypeId": { "type": "string" },
        "teamId": { "type": "string" },
        "organizationName": { "type": "string" },
        "serialNumber": { "type": "string" },
        "description": { "type": "string" }
      }
    },
    "branding": {
      "type": "object",
      "required": ["logoText", "foregroundColor", "backgroundColor", "labelColor"],
      "additionalProperties": false,
      "properties": {
        "logoText": { "type": "string" },
        "foregroundColor": { "type": "string", "pattern": "^rgb\\(\\d+,\\s*\\d+,\\s*\\d+\\)$" },
        "backgroundColor": { "type": "string", "pattern": "^rgb\\(\\d+,\\s*\\d+,\\s*\\d+\\)$" },
        "labelColor": { "type": "string", "pattern": "^rgb\\(\\d+,\\s*\\d+,\\s*\\d+\\)$" }
      }
    },
    "flight": {
      "type": "object",
      "required": ["airlineCode", "flightNumber", "departure", "arrival"],
      "additionalProperties": false,
      "properties": {
        "airlineCode": { "type": "string", "minLength": 2, "maxLength": 3 },
        "flightNumber": { "type": "string" },
        "departure": { "$ref": "#/definitions/endpoint" },
        "arrival":   { "$ref": "#/definitions/endpoint" }
      }
    },
    "passenger": {
      "type": "object",
      "required": ["name", "seats", "boardingGroup", "seqNumber"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string" },
        "frequentFlyerNumber": { "type": "string" },
        "seats": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["number", "cabin"],
            "properties": {
              "number": { "type": "string" },
              "cabin": { "type": "string" },
              "row": { "type": "string" },
              "letter": { "type": "string" }
            }
          }
        },
        "boardingGroup": { "type": "string" },
        "seqNumber": { "type": "string" }
      }
    },
    "barcode": {
      "type": "object",
      "required": ["format", "message", "altText"],
      "properties": {
        "format": { "enum": ["PKBarcodeFormatQR", "PKBarcodeFormatPDF417", "PKBarcodeFormatAztec", "PKBarcodeFormatCode128"] },
        "message": { "type": "string" },
        "altText": { "type": "string" }
      }
    },
    "iOS26": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "duration": { "type": "number" },
        "securityScreening": { "type": "string" },
        "transitInfo": { "type": "string" },
        "wifi": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["ssid"],
            "properties": {
              "ssid": { "type": "string" },
              "password": { "type": "string" }
            }
          }
        }
      }
    }
  },
  "definitions": {
    "endpoint": {
      "type": "object",
      "required": ["iata", "name", "city"],
      "properties": {
        "iata": { "type": "string", "minLength": 3, "maxLength": 3 },
        "name": { "type": "string" },
        "city": { "type": "string" },
        "terminal": { "type": "string" },
        "gate": { "type": "string" },
        "gateOpen": { "type": "string", "format": "date-time" },
        "boarding": { "type": "string", "format": "date-time" },
        "depart":   { "type": "string", "format": "date-time" },
        "arrive":   { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

- [ ] **Step 3: Write index.js**

```js
import schema from "./schema.json" with { type: "json" };
export { schema };

/**
 * @typedef {Object} Endpoint
 * @property {string} iata
 * @property {string} name
 * @property {string} city
 * @property {string} [terminal]
 * @property {string} [gate]
 * @property {string} [gateOpen]
 * @property {string} [boarding]
 * @property {string} [depart]
 * @property {string} [arrive]
 */

/**
 * @typedef {Object} FormState
 * @property {{passTypeId:string, teamId:string, organizationName:string, serialNumber:string, description:string}} meta
 * @property {{logoText:string, foregroundColor:string, backgroundColor:string, labelColor:string}} branding
 * @property {{airlineCode:string, flightNumber:string, departure:Endpoint, arrival:Endpoint}} flight
 * @property {{name:string, frequentFlyerNumber?:string, seats:Array<{number:string,cabin:string,row?:string,letter?:string}>, boardingGroup:string, seqNumber:string}} passenger
 * @property {{format:string, message:string, altText:string}} barcode
 * @property {Object} [iOS26]
 */
```

- [ ] **Step 4: Commit**

```bash
git add packages/pass-schema/
git commit -m "feat(schema): FormState JSON-schema with iOS 26 semantic fields"
```

---

## Task 3: pass-builder package — formState → PassJson

**Files:**
- Create: `packages/pass-builder/package.json`
- Create: `packages/pass-builder/form-to-pass.js`
- Create: `tests/form-to-pass.test.js`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "@wpd/pass-builder",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "dependencies": {
    "ajv": "^8.12.0",
    "ajv-formats": "^2.1.1",
    "passkit-generator": "^3.3.0",
    "archiver": "^7.0.0"
  }
}
```

- [ ] **Step 2: Write failing test**

`tests/form-to-pass.test.js`:

```js
import { describe, it, expect } from "vitest";
import { formStateToPassJson } from "../packages/pass-builder/form-to-pass.js";

const baseState = {
  meta: { passTypeId: "pass.dev.local", teamId: "DEV0000000", organizationName: "Rocket Partners Airlines", serialNumber: "RP-001", description: "Boarding pass" },
  branding: { logoText: "Rocket Partners", foregroundColor: "rgb(255,255,255)", backgroundColor: "rgb(20,30,80)", labelColor: "rgb(180,200,255)" },
  flight: {
    airlineCode: "RP",
    flightNumber: "247",
    departure: { iata: "SFO", name: "San Francisco Intl", city: "San Francisco", terminal: "2", gate: "B12", gateOpen: "2026-06-01T07:00:00-07:00", boarding: "2026-06-01T07:30:00-07:00", depart: "2026-06-01T08:15:00-07:00" },
    arrival:   { iata: "JFK", name: "John F. Kennedy Intl", city: "New York", terminal: "4", arrive: "2026-06-01T16:45:00-04:00" }
  },
  passenger: { name: "ANGELO SOLIVERES", seats: [{ number: "14A", cabin: "economy", row: "14", letter: "A" }], boardingGroup: "3", seqNumber: "0042" },
  barcode: { format: "PKBarcodeFormatQR", message: "RP247-SFOJFK-14A-0042", altText: "RP247 14A" },
  iOS26: { duration: 19800, securityScreening: "TSA PreCheck", wifi: [{ ssid: "GoGoInflight", password: "RP247" }] }
};

describe("formStateToPassJson", () => {
  it("produces a boardingPass with airline transitType", () => {
    const p = formStateToPassJson(baseState);
    expect(p.boardingPass.transitType).toBe("PKTransitTypeAir");
  });

  it("populates required top-level fields", () => {
    const p = formStateToPassJson(baseState);
    expect(p.formatVersion).toBe(1);
    expect(p.passTypeIdentifier).toBe("pass.dev.local");
    expect(p.teamIdentifier).toBe("DEV0000000");
    expect(p.serialNumber).toBe("RP-001");
    expect(p.organizationName).toBe("Rocket Partners Airlines");
    expect(p.description).toBe("Boarding pass");
  });

  it("includes IATA codes as primaryFields", () => {
    const p = formStateToPassJson(baseState);
    const labels = p.boardingPass.primaryFields.map(f => f.key);
    expect(labels).toContain("depart");
    expect(labels).toContain("arrive");
  });

  it("emits iOS 26 semanticTags", () => {
    const p = formStateToPassJson(baseState);
    expect(p.semanticTags.airlineCode).toBe("RP");
    expect(p.semanticTags.flightNumber).toBe(247);
    expect(p.semanticTags.departureAirportIATACode).toBe("SFO");
    expect(p.semanticTags.destinationAirportIATACode).toBe("JFK");
    expect(p.semanticTags.passengerName.fullName).toBe("ANGELO SOLIVERES");
    expect(p.semanticTags.seats).toHaveLength(1);
    expect(p.semanticTags.seats[0].seatNumber).toBe("14A");
    expect(p.semanticTags.boardingGroup).toBe("3");
    expect(p.semanticTags.wifiAccess[0].ssid).toBe("GoGoInflight");
  });

  it("uses ISO-8601 dates verbatim from state", () => {
    const p = formStateToPassJson(baseState);
    expect(p.semanticTags.originalDepartureDate).toBe("2026-06-01T08:15:00-07:00");
    expect(p.semanticTags.originalArrivalDate).toBe("2026-06-01T16:45:00-04:00");
  });
});
```

- [ ] **Step 3: Run, confirm failure**

```bash
npm install --workspaces=false ajv ajv-formats passkit-generator archiver
npx vitest run tests/form-to-pass.test.js
```

Expected: FAIL — `form-to-pass.js` does not exist.

- [ ] **Step 4: Implement form-to-pass.js**

```js
/**
 * Pure: FormState → Apple pass.json (incl. iOS 26 semanticTags).
 * @param {import("@wpd/pass-schema").FormState} s
 */
export function formStateToPassJson(s) {
  const { meta, branding, flight, passenger, barcode } = s;
  const dep = flight.departure;
  const arr = flight.arrival;

  /** @type any */
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: meta.passTypeId,
    teamIdentifier: meta.teamId,
    organizationName: meta.organizationName,
    serialNumber: meta.serialNumber,
    description: meta.description,
    logoText: branding.logoText,
    foregroundColor: branding.foregroundColor,
    backgroundColor: branding.backgroundColor,
    labelColor: branding.labelColor,
    barcodes: [{
      format: barcode.format,
      message: barcode.message,
      messageEncoding: "iso-8859-1",
      altText: barcode.altText
    }],
    boardingPass: {
      transitType: "PKTransitTypeAir",
      headerFields: [
        { key: "gate", label: "GATE", value: dep.gate ?? "—" },
        { key: "seat", label: "SEAT", value: passenger.seats.map(x => x.number).join(",") }
      ],
      primaryFields: [
        { key: "depart", label: dep.city, value: dep.iata },
        { key: "arrive", label: arr.city, value: arr.iata }
      ],
      secondaryFields: [
        { key: "passenger", label: "PASSENGER", value: passenger.name },
        { key: "flight", label: "FLIGHT", value: `${flight.airlineCode}${flight.flightNumber}` }
      ],
      auxiliaryFields: [
        ...(dep.boarding ? [{ key: "boarding", label: "BOARDING", value: dep.boarding, dateStyle: "PKDateStyleNone", timeStyle: "PKDateStyleShort" }] : []),
        ...(dep.depart ? [{ key: "depart-time", label: "DEPART", value: dep.depart, dateStyle: "PKDateStyleNone", timeStyle: "PKDateStyleShort" }] : []),
        { key: "group", label: "GROUP", value: passenger.boardingGroup },
        { key: "seq", label: "SEQ", value: passenger.seqNumber }
      ],
      backFields: [
        { key: "ff", label: "FREQUENT FLYER", value: passenger.frequentFlyerNumber ?? "—" },
        { key: "terminal-dep", label: "DEPARTURE TERMINAL", value: dep.terminal ?? "—" },
        { key: "terminal-arr", label: "ARRIVAL TERMINAL", value: arr.terminal ?? "—" }
      ]
    },
    semanticTags: {
      airlineCode: flight.airlineCode,
      flightCode: `${flight.airlineCode}${flight.flightNumber}`,
      flightNumber: Number(flight.flightNumber),
      departureAirportIATACode: dep.iata,
      departureAirportName: dep.name,
      departureLocationDescription: dep.city,
      destinationAirportIATACode: arr.iata,
      destinationAirportName: arr.name,
      destinationLocationDescription: arr.city,
      ...(dep.terminal && { departureTerminal: dep.terminal }),
      ...(dep.gate && { departureGate: dep.gate }),
      ...(arr.terminal && { destinationTerminal: arr.terminal }),
      ...(arr.gate && { destinationGate: arr.gate }),
      ...(dep.depart && { originalDepartureDate: dep.depart, currentDepartureDate: dep.depart }),
      ...(arr.arrive && { originalArrivalDate: arr.arrive, currentArrivalDate: arr.arrive }),
      ...(dep.boarding && { originalBoardingDate: dep.boarding, currentBoardingDate: dep.boarding }),
      passengerName: { fullName: passenger.name },
      boardingGroup: passenger.boardingGroup,
      seats: passenger.seats.map(x => ({
        seatNumber: x.number,
        seatType: x.cabin,
        ...(x.row && { seatRow: x.row }),
        ...(x.letter && { seatSection: x.letter })
      })),
      ...(s.iOS26?.duration && { duration: s.iOS26.duration }),
      ...(s.iOS26?.securityScreening && { securityScreening: s.iOS26.securityScreening }),
      ...(s.iOS26?.transitInfo && { transitInformation: s.iOS26.transitInfo }),
      ...(s.iOS26?.wifi?.length && { wifiAccess: s.iOS26.wifi.map(w => ({ ssid: w.ssid, ...(w.password && { password: w.password }) })) })
    }
  };

  return pass;
}
```

- [ ] **Step 5: Run, confirm pass**

```bash
npx vitest run tests/form-to-pass.test.js
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/pass-builder/ tests/form-to-pass.test.js package-lock.json
git commit -m "feat(pass-builder): formStateToPassJson with iOS 26 semanticTags"
```

---

## Task 4: pass-builder — schema validation

**Files:**
- Create: `packages/pass-builder/validate.js`
- Create: `fixtures/minimal.json`
- Create: `fixtures/fully-loaded.json`
- Create: `fixtures/multi-seat.json`

- [ ] **Step 1: Write fixtures/minimal.json**

Same shape as `baseState` from the previous test — but with the `meta`, `branding`, `flight`, `passenger`, `barcode` populated and `iOS26` omitted. Copy `baseState` from Task 3 Step 2 verbatim and drop `iOS26`.

```json
{
  "meta": { "passTypeId": "pass.dev.local", "teamId": "DEV0000000", "organizationName": "Rocket Partners Airlines", "serialNumber": "RP-MIN-001", "description": "Boarding pass" },
  "branding": { "logoText": "Rocket Partners", "foregroundColor": "rgb(255,255,255)", "backgroundColor": "rgb(20,30,80)", "labelColor": "rgb(180,200,255)" },
  "flight": {
    "airlineCode": "RP",
    "flightNumber": "247",
    "departure": { "iata": "SFO", "name": "San Francisco Intl", "city": "San Francisco", "terminal": "2", "gate": "B12", "boarding": "2026-06-01T07:30:00-07:00", "depart": "2026-06-01T08:15:00-07:00" },
    "arrival":   { "iata": "JFK", "name": "John F. Kennedy Intl", "city": "New York", "terminal": "4", "arrive": "2026-06-01T16:45:00-04:00" }
  },
  "passenger": { "name": "ANGELO SOLIVERES", "seats": [{ "number": "14A", "cabin": "economy", "row": "14", "letter": "A" }], "boardingGroup": "3", "seqNumber": "0042" },
  "barcode": { "format": "PKBarcodeFormatQR", "message": "RP247-SFOJFK-14A-0042", "altText": "RP247 14A" }
}
```

- [ ] **Step 2: Write fixtures/fully-loaded.json**

Same as minimal plus an `iOS26` block with all four sub-fields, plus `frequentFlyerNumber` and `gateOpen`.

```json
{
  "meta": { "passTypeId": "pass.dev.local", "teamId": "DEV0000000", "organizationName": "Rocket Partners Airlines", "serialNumber": "RP-FULL-001", "description": "Boarding pass" },
  "branding": { "logoText": "Rocket Partners", "foregroundColor": "rgb(255,255,255)", "backgroundColor": "rgb(20,30,80)", "labelColor": "rgb(180,200,255)" },
  "flight": {
    "airlineCode": "RP",
    "flightNumber": "247",
    "departure": { "iata": "SFO", "name": "San Francisco Intl", "city": "San Francisco", "terminal": "2", "gate": "B12", "gateOpen": "2026-06-01T07:00:00-07:00", "boarding": "2026-06-01T07:30:00-07:00", "depart": "2026-06-01T08:15:00-07:00" },
    "arrival":   { "iata": "JFK", "name": "John F. Kennedy Intl", "city": "New York", "terminal": "4", "gate": "B7", "arrive": "2026-06-01T16:45:00-04:00" }
  },
  "passenger": { "name": "ANGELO SOLIVERES", "frequentFlyerNumber": "RP-GOLD-1234567", "seats": [{ "number": "14A", "cabin": "economy", "row": "14", "letter": "A" }], "boardingGroup": "3", "seqNumber": "0042" },
  "barcode": { "format": "PKBarcodeFormatQR", "message": "RP247-SFOJFK-14A-0042", "altText": "RP247 14A" },
  "iOS26": { "duration": 19800, "securityScreening": "TSA PreCheck", "transitInfo": "Train Concourse B → Gate B12", "wifi": [{ "ssid": "GoGoInflight", "password": "RP247" }] }
}
```

- [ ] **Step 3: Write fixtures/multi-seat.json**

Same as fully-loaded but with `seats` containing three entries (family of 3 in row 14 A/B/C). Serial number `RP-FAM-001`.

```json
{
  "meta": { "passTypeId": "pass.dev.local", "teamId": "DEV0000000", "organizationName": "Rocket Partners Airlines", "serialNumber": "RP-FAM-001", "description": "Boarding pass" },
  "branding": { "logoText": "Rocket Partners", "foregroundColor": "rgb(255,255,255)", "backgroundColor": "rgb(20,30,80)", "labelColor": "rgb(180,200,255)" },
  "flight": {
    "airlineCode": "RP",
    "flightNumber": "247",
    "departure": { "iata": "SFO", "name": "San Francisco Intl", "city": "San Francisco", "terminal": "2", "gate": "B12", "boarding": "2026-06-01T07:30:00-07:00", "depart": "2026-06-01T08:15:00-07:00" },
    "arrival":   { "iata": "JFK", "name": "John F. Kennedy Intl", "city": "New York", "terminal": "4", "arrive": "2026-06-01T16:45:00-04:00" }
  },
  "passenger": {
    "name": "FAMILY SOLIVERES",
    "seats": [
      { "number": "14A", "cabin": "economy", "row": "14", "letter": "A" },
      { "number": "14B", "cabin": "economy", "row": "14", "letter": "B" },
      { "number": "14C", "cabin": "economy", "row": "14", "letter": "C" }
    ],
    "boardingGroup": "3",
    "seqNumber": "0044"
  },
  "barcode": { "format": "PKBarcodeFormatQR", "message": "RP247-SFOJFK-FAM-0044", "altText": "RP247 14A/B/C" }
}
```

- [ ] **Step 4: Write validate.js**

```js
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { schema } from "@wpd/pass-schema";

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validator = ajv.compile(schema);

export function validate(state) {
  const ok = validator(state);
  return ok ? { ok: true } : { ok: false, errors: validator.errors };
}

export async function validateAllFixtures() {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturesDir = join(here, "..", "..", "fixtures");
  const names = ["minimal.json", "fully-loaded.json", "multi-seat.json"];
  let bad = 0;
  for (const n of names) {
    const raw = JSON.parse(await readFile(join(fixturesDir, n), "utf8"));
    const r = validate(raw);
    if (!r.ok) {
      console.error(`FAIL ${n}:`, r.errors);
      bad++;
    } else {
      console.log(`OK   ${n}`);
    }
  }
  if (bad) process.exit(1);
}
```

- [ ] **Step 5: Run `npm run check`**

```bash
npm run check
```

Expected: three "OK" lines, exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/pass-builder/validate.js fixtures/
git commit -m "feat(validate): schema check + 3 fixtures (minimal, fully-loaded, multi-seat)"
```

---

## Task 5: gen-dev-cert script

**Files:**
- Create: `scripts/gen-dev-cert.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

CERT_DIR="certs/dev"
mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/signerCert.pem" ]; then
  echo "Dev cert already exists at $CERT_DIR. Delete it manually to regenerate."
  exit 0
fi

echo "→ Generating self-signed CA (stands in for Apple WWDR)…"
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$CERT_DIR/ca.key" \
  -out    "$CERT_DIR/wwdr.pem" \
  -subj "/C=US/O=Local Dev/CN=Local Dev WWDR" \
  -addext "basicConstraints=critical,CA:TRUE" 2>/dev/null

echo "→ Generating leaf signing cert (Pass Type ID: pass.dev.local)…"
openssl req -newkey rsa:2048 -nodes \
  -keyout "$CERT_DIR/signerKey.pem" \
  -out    "$CERT_DIR/signer.csr" \
  -subj "/C=US/O=Rocket Partners/UID=pass.dev.local/CN=Pass Type ID: pass.dev.local" 2>/dev/null

openssl x509 -req -in "$CERT_DIR/signer.csr" \
  -CA "$CERT_DIR/wwdr.pem" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
  -out "$CERT_DIR/signerCert.pem" \
  -days 825 2>/dev/null

rm "$CERT_DIR/signer.csr" "$CERT_DIR/ca.key" "$CERT_DIR/wwdr.pem.srl" 2>/dev/null || true

echo "✓ Dev cert written to $CERT_DIR/"
echo "  - signerCert.pem"
echo "  - signerKey.pem"
echo "  - wwdr.pem"
```

- [ ] **Step 2: Make executable and run it**

```bash
chmod +x scripts/gen-dev-cert.sh
npm run gen-dev-cert
ls certs/dev/
openssl x509 -in certs/dev/signerCert.pem -noout -subject -issuer
```

Expected: three PEM files. The leaf's subject contains `UID=pass.dev.local` and its issuer is "Local Dev WWDR".

- [ ] **Step 3: Commit**

```bash
git add scripts/gen-dev-cert.sh
git commit -m "feat(cert): self-signed dev cert bootstrap"
```

---

## Task 6: gen-assets script — placeholder PNGs

**Files:**
- Create: `scripts/gen-assets.js`

- [ ] **Step 1: Write the script**

```js
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const OUT = "assets";

const svgLogo = (w, h, text) => Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="rgb(20,30,80)"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-size="${Math.floor(h*0.55)}"
        font-weight="700" fill="white">${text}</text>
</svg>`);

const svgIcon = (size) => Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="100%" height="100%" fill="rgb(20,30,80)" rx="${size*0.18}"/>
  <text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-size="${Math.floor(size*0.55)}"
        font-weight="700" fill="white">RP</text>
</svg>`);

async function emit(buf, name) {
  await writeFile(`${OUT}/${name}`, buf);
  console.log(`wrote ${OUT}/${name}`);
}

await mkdir(OUT, { recursive: true });
await emit(await sharp(svgIcon(29)).png().toBuffer(), "icon.png");
await emit(await sharp(svgIcon(58)).png().toBuffer(), "icon@2x.png");
await emit(await sharp(svgIcon(87)).png().toBuffer(), "icon@3x.png");
await emit(await sharp(svgLogo(160, 50)).png().toBuffer(), "logo.png");
await emit(await sharp(svgLogo(320, 100)).png().toBuffer(), "logo@2x.png");
console.log("✓ placeholder assets generated");
```

- [ ] **Step 2: Install sharp and run**

```bash
npm install
npm run gen-assets
ls assets/
file assets/icon.png
```

Expected: five PNGs. `file` reports correct dimensions (29x29, 58x58, 87x87, 160x50, 320x100).

- [ ] **Step 3: Add `assets/` to .gitignore (regenerable)**

Append to `.gitignore`:

```
assets/
```

- [ ] **Step 4: Commit**

```bash
git add scripts/gen-assets.js package.json package-lock.json .gitignore
git commit -m "feat(assets): sharp-based placeholder PNG generator"
```

---

## Task 7: pass-builder — manifest

**Files:**
- Create: `packages/pass-builder/manifest.js`
- Create: `tests/manifest.test.js`

- [ ] **Step 1: Write failing test**

`tests/manifest.test.js`:

```js
import { describe, it, expect } from "vitest";
import { computeManifest } from "../packages/pass-builder/manifest.js";

describe("computeManifest", () => {
  it("SHA1-hashes each named file", () => {
    const files = {
      "pass.json": Buffer.from('{"a":1}'),
      "icon.png": Buffer.from([0x89, 0x50, 0x4e, 0x47])
    };
    const m = computeManifest(files);
    expect(m["pass.json"]).toMatch(/^[a-f0-9]{40}$/);
    expect(m["icon.png"]).toMatch(/^[a-f0-9]{40}$/);
    expect(m["pass.json"]).not.toBe(m["icon.png"]);
  });

  it("produces stable SHA1 for known bytes", () => {
    const files = { "pass.json": Buffer.from("hello") };
    // sha1("hello") = aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
    expect(computeManifest(files)["pass.json"]).toBe("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npx vitest run tests/manifest.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement manifest.js**

```js
import { createHash } from "node:crypto";

/**
 * Compute the Apple Wallet manifest.json content: { filename: sha1-hex, ... }
 * @param {Record<string, Buffer>} files
 * @returns {Record<string, string>}
 */
export function computeManifest(files) {
  /** @type {Record<string,string>} */
  const m = {};
  for (const [name, buf] of Object.entries(files)) {
    m[name] = createHash("sha1").update(buf).digest("hex");
  }
  return m;
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run tests/manifest.test.js
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/pass-builder/manifest.js tests/manifest.test.js
git commit -m "feat(pass-builder): manifest SHA1 computation"
```

---

## Task 8: pass-builder — signing wrapper

**Files:**
- Create: `packages/pass-builder/sign.js`

- [ ] **Step 1: Write sign.js**

```js
import { PKPass } from "passkit-generator";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * @param {object} opts
 * @param {string} opts.certDir       — e.g. "certs/dev"
 * @param {string} [opts.passphrase]
 * @param {object} opts.passJson      — full pass.json object
 * @param {Record<string, Buffer>} opts.assets — { "icon.png": Buffer, ... }
 * @returns {Promise<Buffer>} the signed .pkpass bytes
 */
export async function signPkpass({ certDir, passphrase, passJson, assets }) {
  const [signerCert, signerKey, wwdr] = await Promise.all([
    readFile(join(certDir, "signerCert.pem")),
    readFile(join(certDir, "signerKey.pem")),
    readFile(join(certDir, "wwdr.pem"))
  ]);

  const pass = new PKPass(
    { "pass.json": Buffer.from(JSON.stringify(passJson)), ...assets },
    { signerCert, signerKey, wwdr, signerKeyPassphrase: passphrase ?? "" }
  );

  return pass.getAsBuffer();
}
```

- [ ] **Step 2: Quick smoke check (no test — covered by integration test)**

```bash
node --input-type=module -e "import('./packages/pass-builder/sign.js').then(m => console.log(typeof m.signPkpass))"
```

Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add packages/pass-builder/sign.js
git commit -m "feat(sign): passkit-generator wrapper, profile-driven cert loading"
```

---

## Task 9: pass-builder — top-level buildPkpass()

**Files:**
- Create: `packages/pass-builder/index.js`

- [ ] **Step 1: Write index.js**

```js
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formStateToPassJson } from "./form-to-pass.js";
import { signPkpass } from "./sign.js";
import { validate } from "./validate.js";

export { formStateToPassJson, signPkpass, validate };

/**
 * One-shot: FormState → signed .pkpass Buffer.
 * @param {object} opts
 * @param {import("@wpd/pass-schema").FormState} opts.state
 * @param {string} opts.certDir
 * @param {string} [opts.passphrase]
 * @param {string} [opts.assetsDir]   — default "./assets"
 */
export async function buildPkpass({ state, certDir, passphrase, assetsDir = "assets" }) {
  const v = validate(state);
  if (!v.ok) {
    const err = new Error("FormState failed schema validation");
    err.details = v.errors;
    throw err;
  }
  const passJson = formStateToPassJson(state);
  const assetNames = ["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png"];
  /** @type {Record<string,Buffer>} */
  const assets = {};
  for (const name of assetNames) {
    try { assets[name] = await readFile(join(assetsDir, name)); } catch { /* optional */ }
  }
  return signPkpass({ certDir, passphrase, passJson, assets });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pass-builder/index.js
git commit -m "feat(pass-builder): top-level buildPkpass orchestrator"
```

---

## Task 10: Headless CLI — build:pass

**Files:**
- Create: `scripts/build-pass.js`

- [ ] **Step 1: Write the CLI**

```js
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { parseArgs } from "node:util";
import { buildPkpass } from "@wpd/pass-builder";
import "dotenv/config";

const { values } = parseArgs({
  options: {
    in:  { type: "string" },
    out: { type: "string" }
  }
});

if (!values.in) {
  console.error("usage: npm run build:pass -- --in fixtures/<name>.json [--out out/<name>.pkpass]");
  process.exit(1);
}

const profile = process.env.CERT_PROFILE ?? "dev";
const certDir = `certs/${profile}`;
const state = JSON.parse(await readFile(values.in, "utf8"));

const buf = await buildPkpass({
  state,
  certDir,
  passphrase: process.env.KEY_PASSPHRASE
});

const outPath = values.out ?? `out/${basename(values.in, ".json")}.pkpass`;
await mkdir("out", { recursive: true });
await writeFile(outPath, buf);
console.log(`✓ wrote ${outPath} (${buf.length} bytes, profile=${profile})`);
```

- [ ] **Step 2: Install dotenv at root**

```bash
npm install dotenv
```

- [ ] **Step 3: Run end-to-end**

```bash
cp .env.example .env
npm run build:pass -- --in fixtures/fully-loaded.json
ls -la out/
unzip -l out/fully-loaded.pkpass
```

Expected: a `.pkpass` file in `out/`. `unzip -l` shows `pass.json`, `manifest.json`, `signature`, plus the five image files.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-pass.js package.json package-lock.json
git commit -m "feat(cli): headless build-pass.js from FormState JSON"
```

---

## Task 11: Integration test — build, re-parse, validate

**Files:**
- Create: `tests/integration.test.js`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect, beforeAll } from "vitest";
import { buildPkpass } from "../packages/pass-builder/index.js";
import { computeManifest } from "../packages/pass-builder/manifest.js";
import AdmZip from "adm-zip";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const certDir = "certs/dev";

describe("integration: build → re-parse → validate", () => {
  beforeAll(() => {
    if (!existsSync(`${certDir}/signerCert.pem`)) {
      throw new Error("dev cert missing — run `npm run gen-dev-cert` first");
    }
    if (!existsSync("assets/icon.png")) {
      throw new Error("assets missing — run `npm run gen-assets` first");
    }
  });

  it("produces a parseable, internally-consistent .pkpass", async () => {
    const state = JSON.parse(await readFile("fixtures/fully-loaded.json", "utf8"));
    const buf = await buildPkpass({ state, certDir });

    const zip = new AdmZip(buf);
    const entries = zip.getEntries().map(e => e.entryName).sort();

    expect(entries).toContain("pass.json");
    expect(entries).toContain("manifest.json");
    expect(entries).toContain("signature");
    expect(entries).toContain("icon.png");

    const manifest = JSON.parse(zip.getEntry("manifest.json").getData().toString("utf8"));

    // Recompute manifest from the same files and compare
    const filesInZip = {};
    for (const e of zip.getEntries()) {
      if (e.entryName === "manifest.json" || e.entryName === "signature") continue;
      filesInZip[e.entryName] = e.getData();
    }
    const recomputed = computeManifest(filesInZip);
    expect(recomputed).toEqual(manifest);
  });

  it("preserves iOS 26 semanticTags through the build", async () => {
    const state = JSON.parse(await readFile("fixtures/fully-loaded.json", "utf8"));
    const buf = await buildPkpass({ state, certDir });
    const zip = new AdmZip(buf);
    const pass = JSON.parse(zip.getEntry("pass.json").getData().toString("utf8"));
    expect(pass.semanticTags.airlineCode).toBe("RP");
    expect(pass.semanticTags.wifiAccess[0].ssid).toBe("GoGoInflight");
    expect(pass.semanticTags.duration).toBe(19800);
  });
});
```

- [ ] **Step 2: Install adm-zip**

```bash
npm install -D adm-zip
```

- [ ] **Step 3: Run**

```bash
npx vitest run tests/integration.test.js
```

Expected: PASS, 2 tests.

- [ ] **Step 4: Commit**

```bash
git add tests/integration.test.js package.json package-lock.json
git commit -m "test(integration): build → re-parse → manifest equality + semanticTags preserved"
```

---

## Task 12: Express server — POST /api/build

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/src/env.js`
- Create: `apps/server/src/routes/build.js`
- Create: `apps/server/src/index.js`

- [ ] **Step 1: Write apps/server/package.json**

```json
{
  "name": "@wpd/server",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.js",
  "dependencies": {
    "express": "^4.19.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0",
    "@wpd/pass-builder": "*",
    "@wpd/pass-schema": "*"
  }
}
```

- [ ] **Step 2: Write env.js**

```js
import "dotenv/config";

const profile = process.env.CERT_PROFILE ?? "dev";
export const env = {
  profile,
  certDir: `certs/${profile}`,
  passphrase: process.env.KEY_PASSPHRASE,
  port: Number(process.env.PORT ?? 4317)
};
```

- [ ] **Step 3: Write routes/build.js**

```js
import { Router } from "express";
import { buildPkpass } from "@wpd/pass-builder";
import { env } from "../env.js";

export const buildRouter = Router();

buildRouter.post("/build", async (req, res) => {
  try {
    const buf = await buildPkpass({
      state: req.body,
      certDir: env.certDir,
      passphrase: env.passphrase
    });
    const name = (req.body?.meta?.serialNumber ?? "boarding-pass").replace(/[^a-zA-Z0-9._-]/g, "_");
    res.setHeader("Content-Type", "application/vnd.apple.pkpass");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.pkpass"`);
    res.send(buf);
  } catch (err) {
    res.status(400).json({ error: err.message, details: err.details });
  }
});

buildRouter.get("/profile", (_req, res) => {
  res.json({ profile: env.profile, certDir: env.certDir, port: env.port });
});
```

- [ ] **Step 4: Write index.js**

```js
import express from "express";
import cors from "cors";
import { env } from "./env.js";
import { buildRouter } from "./routes/build.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/api", buildRouter);

app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port} (profile=${env.profile})`);
});
```

- [ ] **Step 5: Smoke test**

```bash
( cd apps/server && node src/index.js & )
sleep 1
curl -s http://localhost:4317/api/profile
curl -sX POST http://localhost:4317/api/build \
  -H "Content-Type: application/json" \
  --data @fixtures/fully-loaded.json \
  -o out/curl-built.pkpass
ls -la out/curl-built.pkpass
unzip -l out/curl-built.pkpass | grep pass.json
pkill -f "node src/index.js" || true
```

Expected: `out/curl-built.pkpass` exists and `unzip -l` shows pass.json.

- [ ] **Step 6: Commit**

```bash
git add apps/server/ package-lock.json
git commit -m "feat(server): Express API with /api/build + /api/profile"
```

---

## Task 13: Vite SPA scaffolding

**Files:**
- Create: `apps/designer/package.json`
- Create: `apps/designer/vite.config.js`
- Create: `apps/designer/index.html`
- Create: `apps/designer/src/main.js`
- Create: `apps/designer/src/styles.css`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "@wpd/designer",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
```

- [ ] **Step 2: Write vite.config.js**

```js
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../../", "");
  return {
    root: ".",
    server: {
      port: Number(env.VITE_PORT ?? 4318),
      proxy: {
        "/api": `http://localhost:${env.PORT ?? 4317}`
      }
    }
  };
});
```

- [ ] **Step 3: Write index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>wallet-pass-designer</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <header>
      <h1>wallet-pass-designer</h1>
      <span id="profile-badge">…</span>
    </header>
    <main>
      <section id="form-pane"></section>
      <section id="preview-pane">
        <nav id="tabs">
          <button data-tab="front" class="active">Front</button>
          <button data-tab="back">Back</button>
          <button data-tab="detail">iOS 26 Detail</button>
        </nav>
        <div id="preview-stage"></div>
        <button id="build-btn">Build .pkpass</button>
        <div id="build-status"></div>
      </section>
    </main>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 4: Write styles.css**

```css
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.4 system-ui, sans-serif; color: #222; background: #f6f7f9; }
header { display: flex; align-items: baseline; gap: 12px; padding: 12px 18px; background: #1a2150; color: white; }
header h1 { font-size: 16px; margin: 0; }
#profile-badge { font-size: 12px; padding: 2px 8px; background: rgba(255,255,255,0.15); border-radius: 4px; }
main { display: grid; grid-template-columns: 420px 1fr; gap: 16px; padding: 16px; height: calc(100vh - 50px); }
#form-pane { overflow-y: auto; background: white; padding: 16px; border-radius: 8px; }
#preview-pane { display: flex; flex-direction: column; gap: 12px; background: white; padding: 16px; border-radius: 8px; }
#tabs { display: flex; gap: 4px; border-bottom: 1px solid #eee; }
#tabs button { background: none; border: none; padding: 8px 12px; cursor: pointer; border-bottom: 2px solid transparent; }
#tabs button.active { border-bottom-color: #1a2150; font-weight: 600; }
#preview-stage { flex: 1; display: flex; align-items: center; justify-content: center; background: #f0f1f5; border-radius: 6px; min-height: 480px; }
#build-btn { background: #1a2150; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: 600; }
#build-btn:hover { background: #2a3170; }
#build-status { font-size: 12px; color: #555; min-height: 16px; }

/* form */
fieldset { border: 1px solid #e5e5e8; border-radius: 6px; margin-bottom: 12px; padding: 8px 12px; }
fieldset > legend { font-weight: 600; padding: 0 4px; }
label { display: block; margin: 8px 0 2px; font-size: 12px; color: #555; }
input, select { width: 100%; padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; font: inherit; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
```

- [ ] **Step 5: Write main.js (skeleton; later tasks fill in)**

```js
import { state, subscribe } from "./state.js";
import { renderForm } from "./form.js";
import { mountTabs } from "./tabs.js";
import { renderActiveTab } from "./preview/index.js";
import { wireBuildButton } from "./build.js";

async function showProfile() {
  try {
    const r = await fetch("/api/profile").then(r => r.json());
    document.getElementById("profile-badge").textContent = `profile: ${r.profile}`;
  } catch {
    document.getElementById("profile-badge").textContent = "API offline";
  }
}

showProfile();
renderForm(document.getElementById("form-pane"));
mountTabs(document.getElementById("tabs"));
wireBuildButton(document.getElementById("build-btn"), document.getElementById("build-status"));
renderActiveTab();
subscribe(() => renderActiveTab());
```

- [ ] **Step 6: Commit (skeleton)**

```bash
git add apps/designer/
git commit -m "feat(designer): SPA scaffold (index, vite config, layout)"
```

---

## Task 14: Designer — state store

**Files:**
- Create: `apps/designer/src/state.js`

- [ ] **Step 1: Write state.js**

```js
// Tiny pub-sub form state. Single source of truth for previews + build.

const initial = {
  meta: { passTypeId: "pass.dev.local", teamId: "DEV0000000", organizationName: "Rocket Partners Airlines", serialNumber: "RP-001", description: "Boarding pass" },
  branding: { logoText: "Rocket Partners", foregroundColor: "rgb(255,255,255)", backgroundColor: "rgb(20,30,80)", labelColor: "rgb(180,200,255)" },
  flight: {
    airlineCode: "RP",
    flightNumber: "247",
    departure: { iata: "SFO", name: "San Francisco Intl", city: "San Francisco", terminal: "2", gate: "B12", boarding: "2026-06-01T07:30:00-07:00", depart: "2026-06-01T08:15:00-07:00" },
    arrival:   { iata: "JFK", name: "John F. Kennedy Intl", city: "New York", terminal: "4", arrive: "2026-06-01T16:45:00-04:00" }
  },
  passenger: { name: "ANGELO SOLIVERES", seats: [{ number: "14A", cabin: "economy", row: "14", letter: "A" }], boardingGroup: "3", seqNumber: "0042" },
  barcode: { format: "PKBarcodeFormatQR", message: "RP247-SFOJFK-14A-0042", altText: "RP247 14A" },
  iOS26: { duration: 19800, securityScreening: "TSA PreCheck", wifi: [{ ssid: "GoGoInflight", password: "RP247" }] }
};

export const state = structuredClone(initial);
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach(fn => fn(state));

/** Set a deep path like "flight.departure.iata" to a value. */
export function setPath(path, value) {
  const segs = path.split(".");
  let o = state;
  for (let i = 0; i < segs.length - 1; i++) o = o[segs[i]];
  o[segs.at(-1)] = value;
  notify();
}

/** Get a deep path value. */
export function getPath(path) {
  return path.split(".").reduce((o, k) => o?.[k], state);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/designer/src/state.js
git commit -m "feat(designer): pub-sub form state store"
```

---

## Task 15: Designer — form rendering

**Files:**
- Create: `apps/designer/src/form.js`

- [ ] **Step 1: Write form.js**

```js
import { setPath, getPath } from "./state.js";

/**
 * Declarative form schema. Each entry: { path, label, type, options? }
 */
const sections = [
  ["Meta", [
    { path: "meta.passTypeId", label: "Pass Type ID", type: "text" },
    { path: "meta.teamId", label: "Team ID", type: "text" },
    { path: "meta.organizationName", label: "Organization", type: "text" },
    { path: "meta.serialNumber", label: "Serial Number", type: "text" },
    { path: "meta.description", label: "Description", type: "text" }
  ]],
  ["Branding", [
    { path: "branding.logoText", label: "Logo Text", type: "text" },
    { path: "branding.foregroundColor", label: "Foreground (rgb)", type: "text" },
    { path: "branding.backgroundColor", label: "Background (rgb)", type: "text" },
    { path: "branding.labelColor", label: "Label (rgb)", type: "text" }
  ]],
  ["Flight", [
    { path: "flight.airlineCode", label: "Airline Code (IATA)", type: "text" },
    { path: "flight.flightNumber", label: "Flight Number", type: "text" }
  ]],
  ["Departure", [
    { path: "flight.departure.iata", label: "IATA", type: "text" },
    { path: "flight.departure.name", label: "Airport Name", type: "text" },
    { path: "flight.departure.city", label: "City", type: "text" },
    { path: "flight.departure.terminal", label: "Terminal", type: "text" },
    { path: "flight.departure.gate", label: "Gate", type: "text" },
    { path: "flight.departure.boarding", label: "Boarding (ISO 8601)", type: "text" },
    { path: "flight.departure.depart", label: "Depart (ISO 8601)", type: "text" }
  ]],
  ["Arrival", [
    { path: "flight.arrival.iata", label: "IATA", type: "text" },
    { path: "flight.arrival.name", label: "Airport Name", type: "text" },
    { path: "flight.arrival.city", label: "City", type: "text" },
    { path: "flight.arrival.terminal", label: "Terminal", type: "text" },
    { path: "flight.arrival.arrive", label: "Arrive (ISO 8601)", type: "text" }
  ]],
  ["Passenger", [
    { path: "passenger.name", label: "Name", type: "text" },
    { path: "passenger.boardingGroup", label: "Boarding Group", type: "text" },
    { path: "passenger.seqNumber", label: "Sequence", type: "text" }
  ]],
  ["Seat (first only — multi-seat in CLI for now)", [
    { path: "passenger.seats.0.number", label: "Seat Number", type: "text" },
    { path: "passenger.seats.0.cabin", label: "Cabin", type: "select", options: ["economy", "premium", "business", "first"] }
  ]],
  ["Barcode", [
    { path: "barcode.format", label: "Format", type: "select", options: ["PKBarcodeFormatQR", "PKBarcodeFormatPDF417", "PKBarcodeFormatAztec", "PKBarcodeFormatCode128"] },
    { path: "barcode.message", label: "Message", type: "text" },
    { path: "barcode.altText", label: "Alt Text", type: "text" }
  ]],
  ["iOS 26 Semantic", [
    { path: "iOS26.duration", label: "Duration (seconds)", type: "number" },
    { path: "iOS26.securityScreening", label: "Security Screening", type: "text" },
    { path: "iOS26.transitInfo", label: "Transit Info", type: "text" },
    { path: "iOS26.wifi.0.ssid", label: "Wifi SSID", type: "text" },
    { path: "iOS26.wifi.0.password", label: "Wifi Password", type: "text" }
  ]]
];

export function renderForm(root) {
  root.innerHTML = "";
  for (const [title, fields] of sections) {
    const fs = document.createElement("fieldset");
    const lg = document.createElement("legend");
    lg.textContent = title;
    fs.appendChild(lg);
    for (const f of fields) {
      const lbl = document.createElement("label");
      lbl.textContent = f.label;
      fs.appendChild(lbl);
      let input;
      if (f.type === "select") {
        input = document.createElement("select");
        for (const o of f.options) {
          const opt = document.createElement("option");
          opt.value = o; opt.textContent = o;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement("input");
        input.type = f.type;
      }
      input.value = getPath(f.path) ?? "";
      input.addEventListener("input", e => {
        const v = f.type === "number" ? Number(e.target.value) : e.target.value;
        setPathArrayAware(f.path, v);
      });
      fs.appendChild(input);
    }
    root.appendChild(fs);
  }
}

function setPathArrayAware(path, value) {
  // setPath already walks segments; numeric segments work as array indices in JS.
  setPath(path, value);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/designer/src/form.js
git commit -m "feat(designer): declarative form (8 sections, ~30 fields)"
```

---

## Task 16: Designer — tabs + active-tab dispatch

**Files:**
- Create: `apps/designer/src/tabs.js`
- Create: `apps/designer/src/preview/index.js`

- [ ] **Step 1: Write tabs.js**

```js
let active = "front";
const listeners = new Set();

export function mountTabs(navEl) {
  navEl.addEventListener("click", e => {
    const t = e.target.dataset?.tab;
    if (!t) return;
    active = t;
    for (const b of navEl.querySelectorAll("button")) {
      b.classList.toggle("active", b.dataset.tab === t);
    }
    listeners.forEach(fn => fn(active));
  });
}

export const getActiveTab = () => active;
export const onTabChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
```

- [ ] **Step 2: Write preview/index.js**

```js
import { state } from "../state.js";
import { renderFront } from "./front.js";
import { renderBack } from "./back.js";
import { renderDetail } from "./detail.js";
import { getActiveTab, onTabChange } from "../tabs.js";

const stage = () => document.getElementById("preview-stage");

export function renderActiveTab() {
  const root = stage();
  const t = getActiveTab();
  root.innerHTML = "";
  if (t === "front") renderFront(root, state);
  else if (t === "back") renderBack(root, state);
  else renderDetail(root, state);
}

onTabChange(renderActiveTab);
```

- [ ] **Step 3: Commit**

```bash
git add apps/designer/src/tabs.js apps/designer/src/preview/index.js
git commit -m "feat(designer): tab switcher + active-tab dispatch"
```

---

## Task 17: Designer — Pass Front preview

**Files:**
- Create: `apps/designer/src/preview/front.js`

- [ ] **Step 1: Write front.js**

```js
export function renderFront(root, s) {
  const dep = s.flight.departure, arr = s.flight.arrival;
  const card = document.createElement("div");
  card.style.cssText = `
    width: 340px; min-height: 540px; padding: 18px;
    background: ${s.branding.backgroundColor};
    color: ${s.branding.foregroundColor};
    border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.18);
    font-family: -apple-system, system-ui, sans-serif;
  `;
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:${s.branding.labelColor}">
      <span>${escape(s.branding.logoText)}</span>
      <span>GATE ${escape(dep.gate ?? "—")} · SEAT ${escape(s.passenger.seats[0]?.number ?? "—")}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:end;margin-top:18px">
      <div>
        <div style="font-size:10px;color:${s.branding.labelColor}">${escape(dep.city)}</div>
        <div style="font-size:42px;font-weight:700;letter-spacing:2px">${escape(dep.iata)}</div>
      </div>
      <div style="font-size:22px;opacity:.6">→</div>
      <div style="text-align:right">
        <div style="font-size:10px;color:${s.branding.labelColor}">${escape(arr.city)}</div>
        <div style="font-size:42px;font-weight:700;letter-spacing:2px">${escape(arr.iata)}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:18px;font-size:11px">
      ${fld("PASSENGER", s.passenger.name, s)}
      ${fld("FLIGHT", `${s.flight.airlineCode}${s.flight.flightNumber}`, s)}
      ${fld("BOARDING", short(dep.boarding), s)}
      ${fld("DEPART", short(dep.depart), s)}
      ${fld("GROUP", s.passenger.boardingGroup, s)}
      ${fld("SEQ", s.passenger.seqNumber, s)}
    </div>
    <div style="margin-top:24px;display:flex;justify-content:center">
      <div style="background:white;color:black;padding:10px 14px;border-radius:6px;font-family:monospace;font-size:10px;text-align:center;letter-spacing:1px;min-width:200px">
        ▩▩ QR ▩▩<br/>${escape(s.barcode.altText)}
      </div>
    </div>
  `;
  root.appendChild(card);
}

const fld = (label, v, s) => `<div>
  <div style="color:${s.branding.labelColor};font-size:9px;letter-spacing:1px">${escape(label)}</div>
  <div style="font-size:13px;font-weight:600">${escape(v ?? "—")}</div>
</div>`;

const short = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }); } catch { return "—"; } };
const escape = (x) => String(x ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
```

- [ ] **Step 2: Commit**

```bash
git add apps/designer/src/preview/front.js
git commit -m "feat(designer): pass-front live preview"
```

---

## Task 18: Designer — Pass Back preview

**Files:**
- Create: `apps/designer/src/preview/back.js`

- [ ] **Step 1: Write back.js**

```js
export function renderBack(root, s) {
  const dep = s.flight.departure, arr = s.flight.arrival;
  const rows = [
    ["Passenger", s.passenger.name],
    ["Frequent Flyer", s.passenger.frequentFlyerNumber ?? "—"],
    ["Boarding Group", s.passenger.boardingGroup],
    ["Sequence", s.passenger.seqNumber],
    ["Departure Terminal", dep.terminal ?? "—"],
    ["Departure Gate", dep.gate ?? "—"],
    ["Arrival Terminal", arr.terminal ?? "—"],
    ["Aircraft", "—"],
    ["Confirmation", s.barcode.message]
  ];

  const card = document.createElement("div");
  card.style.cssText = `
    width: 340px; min-height: 540px; padding: 18px;
    background: ${s.branding.backgroundColor};
    color: ${s.branding.foregroundColor};
    border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.18);
    font-family: -apple-system, system-ui, sans-serif; font-size: 12px;
  `;
  card.innerHTML = `<div style="font-size:13px;font-weight:600;margin-bottom:12px">Details</div>` +
    rows.map(([k, v]) => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.12)">
        <span style="color:${s.branding.labelColor}">${escape(k)}</span>
        <span style="font-weight:600">${escape(v)}</span>
      </div>`).join("");
  root.appendChild(card);
}

const escape = (x) => String(x ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
```

- [ ] **Step 2: Commit**

```bash
git add apps/designer/src/preview/back.js
git commit -m "feat(designer): pass-back live preview"
```

---

## Task 19: Designer — iOS 26 detail view preview

**Files:**
- Create: `apps/designer/src/preview/detail.js`

- [ ] **Step 1: Write detail.js**

Approximation of the iOS 26 expanded detail view derived from `semanticTags`. Card list inspired by Apple's stock layout — header, timeline, seats, wifi, security.

```js
export function renderDetail(root, s) {
  const dep = s.flight.departure, arr = s.flight.arrival;
  const card = document.createElement("div");
  card.style.cssText = `
    width: 360px; min-height: 540px; padding: 16px;
    background: white; color: #1a1a1a; border-radius: 18px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.12);
    font-family: -apple-system, system-ui, sans-serif;
    display: flex; flex-direction: column; gap: 12px;
  `;

  const section = (title, html) => `
    <div style="background:#f4f4f7;border-radius:12px;padding:12px">
      <div style="font-size:11px;letter-spacing:1px;color:#888;text-transform:uppercase;margin-bottom:6px">${escape(title)}</div>
      <div style="font-size:14px">${html}</div>
    </div>`;

  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:32px;height:32px;border-radius:8px;background:${s.branding.backgroundColor};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px">${escape(s.flight.airlineCode)}</div>
      <div>
        <div style="font-size:13px;font-weight:600">${escape(s.flight.airlineCode)}${escape(s.flight.flightNumber)}</div>
        <div style="font-size:11px;color:#888">${escape(s.branding.logoText)}</div>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:end">
      <div>
        <div style="font-size:28px;font-weight:700">${escape(dep.iata)}</div>
        <div style="font-size:11px;color:#888">${escape(dep.city)}</div>
        <div style="font-size:11px">${short(dep.depart)}</div>
      </div>
      <div style="color:#aaa">→</div>
      <div style="text-align:right">
        <div style="font-size:28px;font-weight:700">${escape(arr.iata)}</div>
        <div style="font-size:11px;color:#888">${escape(arr.city)}</div>
        <div style="font-size:11px">${short(arr.arrive)}</div>
      </div>
    </div>

    ${section("Boarding", `
      <div style="display:flex;justify-content:space-between">
        <span>Group ${escape(s.passenger.boardingGroup)}</span>
        <span style="font-weight:600">${short(dep.boarding)}</span>
      </div>
      <div style="margin-top:4px;color:#888">Terminal ${escape(dep.terminal ?? "—")} · Gate ${escape(dep.gate ?? "—")}</div>
    `)}

    ${section("Seats", s.passenger.seats.map(seat =>
      `<div style="display:flex;justify-content:space-between"><span>${escape(seat.number)}</span><span style="color:#888">${escape(seat.cabin)}</span></div>`
    ).join(""))}

    ${s.iOS26?.duration ? section("Flight Duration", `${Math.floor(s.iOS26.duration/3600)}h ${Math.floor((s.iOS26.duration%3600)/60)}m`) : ""}
    ${s.iOS26?.securityScreening ? section("Security Screening", escape(s.iOS26.securityScreening)) : ""}
    ${s.iOS26?.transitInfo ? section("Transit", escape(s.iOS26.transitInfo)) : ""}
    ${s.iOS26?.wifi?.length ? section("Wifi", s.iOS26.wifi.map(w =>
      `<div><strong>${escape(w.ssid)}</strong>${w.password ? ` · <code>${escape(w.password)}</code>` : ""}</div>`
    ).join("")) : ""}
  `;
  root.appendChild(card);
}

const short = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }); } catch { return "—"; } };
const escape = (x) => String(x ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
```

- [ ] **Step 2: Commit**

```bash
git add apps/designer/src/preview/detail.js
git commit -m "feat(designer): iOS 26 detail view approximation"
```

---

## Task 20: Designer — Build button wiring

**Files:**
- Create: `apps/designer/src/build.js`

- [ ] **Step 1: Write build.js**

```js
import { state } from "./state.js";

export function wireBuildButton(btn, statusEl) {
  btn.addEventListener("click", async () => {
    statusEl.textContent = "Building…";
    btn.disabled = true;
    try {
      const r = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        statusEl.textContent = `✗ ${err.error}${err.details ? ` (${JSON.stringify(err.details)})` : ""}`;
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${state.meta.serialNumber || "pass"}.pkpass`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      statusEl.textContent = `✓ Downloaded ${a.download} (${blob.size} bytes)`;
    } catch (e) {
      statusEl.textContent = `✗ ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/designer/src/build.js
git commit -m "feat(designer): build button → /api/build → download .pkpass"
```

---

## Task 21: Dev orchestrator — concurrent Vite + Express

**Files:**
- Create: `scripts/dev.js`

- [ ] **Step 1: Write dev.js**

```js
import { spawn } from "node:child_process";
import "dotenv/config";

const procs = [];

function run(name, cmd, args, cwd) {
  const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  p.stdout.on("data", d => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on("data", d => process.stderr.write(`[${name}] ${d}`));
  p.on("exit", code => {
    console.log(`[${name}] exited (${code})`);
    for (const other of procs) if (other !== p) other.kill();
    process.exit(code ?? 1);
  });
  procs.push(p);
}

run("api",      "node", ["apps/server/src/index.js"], process.cwd());
run("designer", "npx",  ["vite", "--port", String(process.env.VITE_PORT ?? 4318)], "apps/designer");

process.on("SIGINT",  () => procs.forEach(p => p.kill()));
process.on("SIGTERM", () => procs.forEach(p => p.kill()));
```

- [ ] **Step 2: Install root deps and run dev**

```bash
npm install
npm run dev &
sleep 4
curl -s http://localhost:4317/api/profile
curl -s http://localhost:4318/ | head -20
pkill -f "scripts/dev.js" || true
pkill -f "vite" || true
pkill -f "apps/server/src/index.js" || true
```

Expected: API responds with `{"profile":"dev",…}`. Vite serves the index.html.

- [ ] **Step 3: Commit**

```bash
git add scripts/dev.js
git commit -m "feat(dev): concurrent Vite + Express orchestrator"
```

---

## Task 22: cert:inspect script

**Files:**
- Create: `scripts/cert-inspect.js`

- [ ] **Step 1: Write the script**

```js
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import "dotenv/config";

const profile = process.env.CERT_PROFILE ?? "dev";
const dir = `certs/${profile}`;

console.log(`Profile:  ${profile}`);
console.log(`Cert dir: ${dir}`);

for (const f of ["signerCert.pem", "signerKey.pem", "wwdr.pem"]) {
  const path = `${dir}/${f}`;
  const exists = existsSync(path);
  console.log(`  ${exists ? "✓" : "✗"} ${f}`);
}

if (!existsSync(`${dir}/signerCert.pem`)) process.exit(1);

const out = execFileSync("openssl", ["x509", "-in", `${dir}/signerCert.pem`, "-noout", "-subject", "-issuer", "-startdate", "-enddate"], { encoding: "utf8" });
console.log();
console.log(out);
```

- [ ] **Step 2: Run**

```bash
npm run cert:inspect
```

Expected: prints profile, three ✓ marks, subject/issuer/dates.

- [ ] **Step 3: Commit**

```bash
git add scripts/cert-inspect.js
git commit -m "feat(cert): cert-inspect script"
```

---

## Task 23: docs/cert-day.md runbook

**Files:**
- Create: `docs/cert-day.md`

- [ ] **Step 1: Write the runbook**

```markdown
# Cert Day Runbook

When the Apple Developer account is in hand, follow these steps to swap from the self-signed dev cert to a real Apple-issued Pass Type ID cert. **No code changes are required.**

## Prerequisites

- Apple Developer account in good standing.
- Access to a Mac with Keychain (CSR generation must happen there).
- OpenSSL CLI.

## Steps

### 1. Register a Pass Type ID

1. Go to https://developer.apple.com/account/resources/identifiers/list/passTypeId.
2. Click `+`, choose **Pass Type IDs**, continue.
3. Description: e.g. "Rocket Partners Boarding Pass".
4. Identifier: `pass.com.rocketpartners.airline.boardingpass` (must begin with `pass.`).
5. Save.

### 2. Generate a CSR on your Mac

1. Open **Keychain Access** → menu **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority…**.
2. Email: your Apple ID.
3. Common Name: `pass.com.rocketpartners.airline.boardingpass`.
4. Choose **Saved to disk** + **Let me specify key pair information**. Continue.
5. Key size: 2048-bit RSA, algorithm: RSA. Save the `.certSigningRequest`.
6. Keychain Access will create a key pair in your Login keychain.

### 3. Upload the CSR and download the cert

1. Back on developer.apple.com, click your Pass Type ID, then **Create Certificate**.
2. Upload the CSR. Download the resulting `pass.cer`.

### 4. Export the private key from Keychain

1. In Keychain Access, find the private key paired with the CSR (it has the same Common Name as the request).
2. Right-click → **Export**. Choose `.p12` format. Set a passphrase.
3. Convert to PEM:

```bash
openssl pkcs12 -in pass.p12 -out signerKey.pem -nodes -clcerts -legacy
# the file will contain both the cert and the key; trim to just the key block if necessary
```

### 5. Convert the Pass Type ID Certificate to PEM

```bash
openssl x509 -inform DER -in pass.cer -out signerCert.pem
```

### 6. Download Apple's WWDR intermediate

The current generation is **WWDR G4**.

```bash
curl -o wwdr.pem https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
openssl x509 -inform DER -in wwdr.pem -out wwdr.pem
```

### 7. Drop the three PEMs into `certs/prod/`

```
certs/prod/
├── signerCert.pem
├── signerKey.pem
└── wwdr.pem
```

### 8. Update `.env`

```
CERT_PROFILE=prod
PASS_TYPE_ID=pass.com.rocketpartners.airline.boardingpass
TEAM_ID=ABCDE12345   # your Team ID from the developer portal
KEY_PASSPHRASE=<the passphrase you set in step 4, if any>
```

### 9. Sanity check

```bash
npm run cert:inspect
```

The output's "Subject" line must contain your real Pass Type ID; the "Issuer" must reference **Apple WWDR**.

### 10. Build a real pass

```bash
npm run build:pass -- --in fixtures/fully-loaded.json
```

AirDrop or email the resulting `out/fully-loaded.pkpass` to your iPhone. Tap to add to Wallet.

## Gotchas

- **CSR must be generated on the same Mac the private key will live on.** If you move the `.p12` to a different machine, that's fine, but the original key pair was created in that Mac's Keychain.
- **WWDR generation matters.** Apple has issued multiple WWDR intermediates (G2, G3, G4, G6). G4 is current as of this writing. Using the wrong one breaks the trust chain.
- **PassTypeId must match.** The `passTypeIdentifier` value in `pass.json` (set from `meta.passTypeId` in form state) must equal the Pass Type ID you registered. If they disagree, Wallet rejects the pass.
- **Don't commit the PEMs.** `certs/prod/` is in `.gitignore`. Use a password manager or your team's secret store.
```

- [ ] **Step 2: Commit**

```bash
git add docs/cert-day.md
git commit -m "docs(cert): cert-day runbook"
```

---

## Task 24: README — usage section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README.md content**

```markdown
# wallet-pass-designer

Local dev tool for designing Apple Wallet airline boarding passes — including the iOS 26 `semanticTags` expanded-view fields.

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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): quick start + headless usage + layout"
```

---

## Task 25: Final whole-pipeline smoke

**Files:** none — verification only.

- [ ] **Step 1: Fresh state check**

```bash
npm test
```

Expected: all tests pass (form-to-pass, manifest, integration).

- [ ] **Step 2: Build all three fixtures**

```bash
for f in minimal fully-loaded multi-seat; do
  npm run build:pass -- --in "fixtures/${f}.json"
done
ls -la out/
```

Expected: three `.pkpass` files emitted.

- [ ] **Step 3: Cert profile sanity**

```bash
npm run cert:inspect
```

Expected: profile=dev, three ✓, valid subject.

- [ ] **Step 4: Inspect a pass**

```bash
unzip -l out/fully-loaded.pkpass
unzip -p out/fully-loaded.pkpass pass.json | python3 -m json.tool | head -40
```

Expected: `pass.json`, `manifest.json`, `signature` listed; `pass.json` contains a `semanticTags` block with `airlineCode`, `wifiAccess`, etc.

- [ ] **Step 5: Final commit**

```bash
git log --oneline
```

Expected: a clean linear history of `feat(...)`, `test(...)`, `docs(...)`, `chore(...)` commits.

---

## Self-Review Notes

- **Spec coverage:** every section of the design spec is covered by at least one task. The cert-day runbook (Task 23) discharges the spec's "Pre-Implementation Checklist" item about writing it. The library choice (`passkit-generator`) is committed to in Task 3.
- **No placeholders:** every step has the actual content needed. Where I wrote "copy from Step X" (e.g., fixtures repeating baseState), the actual JSON is reproduced in full.
- **Type consistency:** `FormState` shape is identical in the schema (Task 2), the typedef (Task 2), the test fixture (Task 3), the runtime fixtures (Task 4), and the SPA state store (Task 14). Method names — `formStateToPassJson`, `computeManifest`, `signPkpass`, `buildPkpass` — are used consistently everywhere they appear.
- **One spec assumption to verify at execution time:** `passkit-generator` v3 must pass `pass.json` through verbatim — including unknown keys like `semanticTags` — when given a complete file via the `PKPass` constructor's first arg. If it strips unknown keys, fall back to `archiver` + custom PKCS#7 (the integration test will surface this regardless).

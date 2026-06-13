# Semantics-first Phase 3 — Designer (FormState) rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Evolve `FormState` to semantics-first (first-class typed `semantics` + a `displayFields` layout), rewrite `formStateToPassJson` to emit from it, add a pure `migrateFormState(old→new)` so every already-issued pass/fixture/localStorage keeps building, and rework the Designer surfaces (form, trip panel, status updates, group-id, shift-dates) onto the new shape.

**Architecture:** Approach A, spec §4–5 (`docs/superpowers/specs/2026-06-13-semantics-first-authoring-design.md`). Reuses Phase 1/2 shared units (`SEMANTIC_CATALOG`, `renderSemanticsEditor`, `suggestDisplayValues`, `isEmptyTyped`). **Keystone invariant:** migration lifts the legacy emitter's `semantics` + `boardingPass.*Fields` verbatim into the new shape, and the new emitter spreads them back verbatim — so `formStateToPassJson(migrateFormState(old))` is byte-identical to the old emit (proved by a round-trip test over every fixture). The preview (`apps/designer/src/preview/wallet/*`) reads the built `pass.json`, so it needs **zero** changes.

**Tech Stack:** Vanilla ESM JS, vitest, happy-dom, Express, AJV (draft-07). No new deps.

**New `FormState` shape (single source of truth for this plan):**
```js
{
  meta:    { passTypeId, teamId, organizationName, serialNumber, description, webServiceURL?, authenticationToken? },
  branding:{ logoText, foregroundColor, backgroundColor, labelColor, logoDataUrl? },
  barcode: { format, message, altText },
  semantics: { /* catalog keys, filled-only; wifiAccess does NOT live here */ },
  displayFields: {
    header: [{ key, label, value, dateStyle?, timeStyle?, changeMessage? }],
    primary: [...], secondary: [...], auxiliary: [...], back: [...]
  },
  iOS26?: { additionalInfoFields?, relevantDates?, eventGuide?, upcomingPassInformation?, wifi? }
}
```
The old `flight`/`passenger` collapse into `semantics` + `displayFields`. The old `iOS26` semantic-ish fields (`duration`, `securityScreening`, `transitInfo→transitProvider`, `transitStatus`, `transitStatusReason`, `silenceRequested`, `wifi→wifiAccess`) become **semantics**; the 5 structural extras stay in the `iOS26` bucket.

**Branch:** `feat/semantics-first-phase3`. Per-task TDD commits; `git merge --ff-only main` + push when green (user merges each phase). Execute inline (no subagents). Each task ends with `npm test` green unless marked browser-verified.

**Out of scope:** signing/PassKit/push/storage transport; branding/barcode/asset authoring UI; new non-boarding semantics. Client-side required-empty *blocking* is deferred until `REQUIRED_SEMANTICS` is pinned (Task 7 / open items).

---

### Task 0: Branch

- [ ] `git checkout -b feat/semantics-first-phase3`

---

### Task 1: `migrate.js` — legacy emitter snapshot + `migrateFormState` (additive)

Add the migration module. Nothing else changes yet: `formStateToPassJson` is still the old emitter, so the whole suite stays green. `migrate.js` carries its **own** frozen copy of today's emitter (it must reproduce old behaviour forever; it cannot import the soon-to-be-rewritten `form-to-pass.js`).

**Files:**
- Create: `packages/pass-builder/migrate.js`
- Create: `tests/migrate.test.js`
- Modify: `packages/pass-builder/index.js` (export `migrateFormState`)

- [ ] **Step 1: Write the failing test**

`tests/migrate.test.js`:
```js
import { describe, it, expect } from "vitest";
import { migrateFormState, legacyFormStateToPassJson } from "../packages/pass-builder/migrate.js";

const oldBase = {
  meta: { passTypeId: "pass.dev.local", teamId: "DEV0000000", organizationName: "Rocket Partners Airlines", serialNumber: "RP-001", description: "Boarding pass" },
  branding: { logoText: "Rocket Partners", foregroundColor: "rgb(255,255,255)", backgroundColor: "rgb(20,30,80)", labelColor: "rgb(180,200,255)" },
  flight: {
    airlineCode: "RP", flightNumber: "247",
    departure: { iata: "SFO", name: "San Francisco Intl", city: "San Francisco", terminal: "2", gate: "B12", boarding: "2026-06-01T07:30:00-07:00", depart: "2026-06-01T08:15:00-07:00" },
    arrival:   { iata: "JFK", name: "John F. Kennedy Intl", city: "New York", terminal: "4", arrive: "2026-06-01T16:45:00-04:00" }
  },
  passenger: { name: "ANGELO SOLIVERES", seats: [{ number: "14A", cabin: "economy", row: "14", letter: "A" }], boardingGroup: "3", seqNumber: "0042" },
  barcode: { format: "PKBarcodeFormatQR", message: "RP247-SFOJFK-14A-0042", altText: "RP247 14A" },
  iOS26: { duration: 19800, securityScreening: "TSA PreCheck", wifi: [{ ssid: "GoGoInflight", password: "RP247" }] }
};

describe("migrateFormState", () => {
  it("lifts semantics + display fields into the new shape, dropping flight/passenger", () => {
    const m = migrateFormState(oldBase);
    expect(m.flight).toBeUndefined();
    expect(m.passenger).toBeUndefined();
    expect(m.meta).toEqual(oldBase.meta);
    expect(m.barcode).toEqual(oldBase.barcode);
    expect(m.semantics.airlineCode).toBe("RP");
    expect(m.semantics.flightNumber).toBe(247);
    expect(m.semantics.passengerName).toEqual({ givenName: "ANGELO", familyName: "SOLIVERES" });
    expect(m.semantics.seats[0]).toMatchObject({ seatRow: "14", seatNumber: "A" });
    expect(m.displayFields.primary.map(f => f.key)).toEqual(["depart", "arrive"]);
    expect(m.displayFields.header.map(f => f.key)).toEqual(["gate", "seat"]);
  });

  it("routes wifi into the iOS26 bucket, never into semantics", () => {
    const m = migrateFormState(oldBase);
    expect(m.semantics.wifiAccess).toBeUndefined();
    expect(m.iOS26.wifi).toEqual([{ ssid: "GoGoInflight", password: "RP247" }]);
  });

  it("is idempotent: a new-shape state passes through unchanged", () => {
    const m = migrateFormState(oldBase);
    expect(migrateFormState(m)).toEqual(m);
  });

  it("leaves non-FormState / partial-stub inputs untouched (no crash)", () => {
    expect(migrateFormState(null)).toBe(null);
    const stub = { meta: { serialNumber: "X" }, flight: {} };
    expect(migrateFormState(stub)).toBe(stub);   // missing departure/arrival -> passthrough
  });
});

describe("legacyFormStateToPassJson (frozen snapshot of the pre-Phase-3 emitter)", () => {
  it("still emits the old pass.json the migration depends on", () => {
    const p = legacyFormStateToPassJson(oldBase);
    expect(p.semantics.airlineCode).toBe("RP");
    expect(p.boardingPass.primaryFields.map(f => f.key)).toEqual(["depart", "arrive"]);
    expect(p.semantics.wifiAccess[0].ssid).toBe("GoGoInflight");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run tests/migrate.test.js` (cannot resolve `migrate.js`).

- [ ] **Step 3: Create `packages/pass-builder/migrate.js`.** `legacyFormStateToPassJson` is an **exact copy** of the current `form-to-pass.js` body (so behaviour is frozen):
```js
import { seatSemantics, splitPersonName } from "./semantics.js";

// Frozen pre-Phase-3 emitter. Kept ONLY so migrateFormState can reproduce the
// exact pass.json an old-shape FormState used to build. Never call it to emit a
// pass — form-to-pass.js owns emitting now. Do not "improve" it; round-trip
// fidelity (tests/migrate.test.js) depends on it staying byte-identical.
export function legacyFormStateToPassJson(s) {
  const { meta, branding, flight, passenger, barcode } = s;
  const dep = flight.departure;
  const arr = flight.arrival;
  const ios = s.iOS26 ?? {};

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
    preferredStyleSchemes: ["semanticBoardingPass"],
    barcodes: [{ format: barcode.format, message: barcode.message, messageEncoding: "iso-8859-1", altText: barcode.altText }],
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
      ],
      ...(ios.additionalInfoFields?.length && { additionalInfoFields: ios.additionalInfoFields })
    },
    semantics: {
      airlineCode: flight.airlineCode,
      flightCode: `${flight.airlineCode}${flight.flightNumber}`,
      flightNumber: Number(flight.flightNumber),
      departureAirportCode: dep.iata,
      departureAirportName: dep.name,
      departureCityName: dep.city,
      departureLocationDescription: dep.city,
      destinationAirportCode: arr.iata,
      destinationAirportName: arr.name,
      destinationCityName: arr.city,
      destinationLocationDescription: arr.city,
      ...(dep.terminal && { departureTerminal: dep.terminal }),
      ...(dep.gate && { departureGate: dep.gate }),
      ...(arr.terminal && { destinationTerminal: arr.terminal }),
      ...(arr.gate && { destinationGate: arr.gate }),
      ...(dep.timeZone && { departureLocationTimeZone: dep.timeZone, departureAirportTimeZone: dep.timeZone }),
      ...(arr.timeZone && { destinationLocationTimeZone: arr.timeZone, destinationAirportTimeZone: arr.timeZone }),
      ...(hasGeo(dep) && { departureLocation: { latitude: dep.latitude, longitude: dep.longitude } }),
      ...(hasGeo(arr) && { destinationLocation: { latitude: arr.latitude, longitude: arr.longitude } }),
      ...(dep.depart && { originalDepartureDate: dep.depart, currentDepartureDate: dep.depart }),
      ...(arr.arrive && { originalArrivalDate: arr.arrive, currentArrivalDate: arr.arrive }),
      ...(dep.boarding && { originalBoardingDate: dep.boarding, currentBoardingDate: dep.boarding }),
      passengerName: splitPersonName(passenger.name),
      boardingGroup: passenger.boardingGroup,
      boardingSequenceNumber: passenger.seqNumber,
      ...(passenger.boardingZone && { boardingZone: passenger.boardingZone }),
      ...(passenger.confirmationNumber && { confirmationNumber: passenger.confirmationNumber }),
      ...(passenger.ticketFareClass && { ticketFareClass: passenger.ticketFareClass }),
      ...(passenger.priorityStatus && { priorityStatus: passenger.priorityStatus }),
      ...(passenger.membershipProgramName && { membershipProgramName: passenger.membershipProgramName }),
      ...(passenger.frequentFlyerNumber && { membershipProgramNumber: passenger.frequentFlyerNumber }),
      ...(typeof passenger.documentsVerified === "boolean" && { internationalDocumentsAreVerified: passenger.documentsVerified }),
      seats: passenger.seats.map(x => seatSemantics(x.number, {
        seatType: x.cabin,
        ...(x.description && { seatDescription: x.description })
      })),
      ...(ios.duration && { duration: ios.duration }),
      ...(ios.securityScreening && { securityScreening: ios.securityScreening }),
      ...(ios.transitInfo && { transitProvider: ios.transitInfo }),
      ...(ios.transitStatus && { transitStatus: ios.transitStatus }),
      ...(ios.transitStatusReason && { transitStatusReason: ios.transitStatusReason }),
      ...(typeof ios.silenceRequested === "boolean" && { silenceRequested: ios.silenceRequested }),
      ...(ios.wifi?.length && { wifiAccess: ios.wifi.map(w => ({ ssid: w.ssid, ...(w.password && { password: w.password }) })) })
    },
    ...(ios.relevantDates?.length && { relevantDates: ios.relevantDates.map(d => ({ date: d, relevantDate: d })) }),
    ...(ios.eventGuide && stripUndef(ios.eventGuide)),
    ...(ios.upcomingPassInformation?.length && {
      upcomingPassInformation: ios.upcomingPassInformation.map(e => ({ identifier: e.identifier, name: e.name, type: "event", dateInformation: { date: e.date } }))
    }),
    ...(meta.webServiceURL && { webServiceURL: meta.webServiceURL }),
    ...(meta.authenticationToken && { authenticationToken: meta.authenticationToken })
  };
  return pass;
}

function hasGeo(p) { return typeof p.latitude === "number" && typeof p.longitude === "number"; }
function stripUndef(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") out[k] = v;
  return out;
}

const IOS26_EXTRA_KEYS = ["additionalInfoFields", "relevantDates", "eventGuide", "upcomingPassInformation", "wifi"];

/**
 * Old-shape FormState -> new semantics-first FormState. Pure, idempotent.
 * A state already in the new shape (no `flight`) or a partial stub (no
 * departure/arrival) is returned unchanged. Strategy: run the frozen legacy
 * emitter, then lift its `semantics` (minus wifiAccess) + `boardingPass.*Fields`
 * verbatim, so the rebuilt pass.json is byte-for-byte the old one.
 * @param {object|null} s
 * @returns {object|null}
 */
export function migrateFormState(s) {
  if (!s || typeof s !== "object" || s.flight === undefined) return s;        // new shape / not a FormState
  if (s.flight.departure == null || s.flight.arrival == null) return s;       // partial stub — don't crash the emitter
  const pass = legacyFormStateToPassJson(s);
  const bp = pass.boardingPass ?? {};
  const { wifiAccess, ...semantics } = pass.semantics ?? {};                  // wifi rides in the iOS26 bucket
  const ios = {};
  for (const k of IOS26_EXTRA_KEYS) if (s.iOS26?.[k] !== undefined) ios[k] = s.iOS26[k];
  return {
    meta: s.meta,
    branding: s.branding,
    barcode: s.barcode,
    semantics,
    displayFields: {
      header: bp.headerFields ?? [],
      primary: bp.primaryFields ?? [],
      secondary: bp.secondaryFields ?? [],
      auxiliary: bp.auxiliaryFields ?? [],
      back: bp.backFields ?? []
    },
    ...(Object.keys(ios).length ? { iOS26: ios } : {})
  };
}
```

- [ ] **Step 4: Export from the package entry.** In `packages/pass-builder/index.js` add a line after the suggest export:
```js
export { migrateFormState } from "./migrate.js";
```

- [ ] **Step 5: Run it, expect PASS** — `npx vitest run tests/migrate.test.js`.

- [ ] **Step 6: Full suite green** — `npm test` (additive change; nothing else touched).

- [ ] **Step 7: Commit**
```bash
git add packages/pass-builder/migrate.js packages/pass-builder/index.js tests/migrate.test.js
git commit -m "feat(pass-builder): migrateFormState + frozen legacy emitter snapshot"
```

---

### Task 2: The core flip — rewrite emitter, schema, fixtures (atomic)

This is the one unavoidable atomic change: the new `formStateToPassJson` takes the new shape, the schema validates the new shape, and the fixtures are migrated in place — all together, or the suite (which builds `fixtures/fully-loaded.json`) breaks mid-way.

**Files:**
- Modify: `packages/pass-builder/form-to-pass.js` (full rewrite)
- Modify: `packages/pass-schema/schema.json` (full rewrite)
- Modify: `packages/pass-schema/index.js` (JSDoc typedef)
- Modify: `fixtures/*.json` (6 files, migrated in place)
- Modify: `tests/form-to-pass.test.js` (rewrite to the new shape)
- Modify: `tests/migrate.test.js` (add the round-trip exactness block)

- [ ] **Step 1: Write the new emitter test.** Replace the whole body of `tests/form-to-pass.test.js`:
```js
import { describe, it, expect } from "vitest";
import { formStateToPassJson } from "../packages/pass-builder/form-to-pass.js";

const base = {
  meta: { passTypeId: "pass.dev.local", teamId: "DEV0000000", organizationName: "Rocket Partners Airlines", serialNumber: "RP-001", description: "Boarding pass" },
  branding: { logoText: "Rocket Partners", foregroundColor: "rgb(255,255,255)", backgroundColor: "rgb(20,30,80)", labelColor: "rgb(180,200,255)" },
  barcode: { format: "PKBarcodeFormatQR", message: "RP247-SFOJFK-14A-0042", altText: "RP247 14A" },
  semantics: {
    airlineCode: "RP", flightCode: "RP247", flightNumber: 247,
    departureAirportCode: "SFO", destinationAirportCode: "JFK",
    originalBoardingDate: "2026-06-01T07:30:00-07:00", currentBoardingDate: "2026-06-01T07:30:00-07:00",
    passengerName: { givenName: "ANGELO", familyName: "SOLIVERES" },
    seats: [{ seatRow: "14", seatNumber: "A", seatType: "economy" }],
    boardingGroup: "3", boardingSequenceNumber: "0042",
    departureGate: "",                              // empty -> dropped (emit-only-filled)
    departureLocationTimeZone: "America/Los_Angeles" // tz mirror -> AirportTimeZone too
  },
  displayFields: {
    header: [{ key: "gate", label: "GATE", value: "B12" }],
    primary: [{ key: "depart", label: "San Francisco", value: "SFO" }, { key: "arrive", label: "New York", value: "JFK" }],
    secondary: [], auxiliary: [], back: []
  },
  iOS26: { wifi: [{ ssid: "GoGoInflight", password: "RP247" }] }
};

describe("formStateToPassJson (new shape)", () => {
  it("emits required top-level + the iOS 26 style opt-in", () => {
    const p = formStateToPassJson(base);
    expect(p.formatVersion).toBe(1);
    expect(p.passTypeIdentifier).toBe("pass.dev.local");
    expect(p.teamIdentifier).toBe("DEV0000000");
    expect(p.serialNumber).toBe("RP-001");
    expect(p.preferredStyleSchemes).toEqual(["semanticBoardingPass"]);
    expect(p.barcodes[0]).toEqual({ format: "PKBarcodeFormatQR", message: "RP247-SFOJFK-14A-0042", messageEncoding: "iso-8859-1", altText: "RP247 14A" });
  });

  it("builds boardingPass.*Fields straight from displayFields (verbatim, incl. extra props)", () => {
    const p = formStateToPassJson({ ...base, displayFields: { ...base.displayFields,
      auxiliary: [{ key: "boarding", label: "BOARDING", value: "2026-06-01T07:30:00-07:00", dateStyle: "PKDateStyleNone", timeStyle: "PKDateStyleShort" }] } });
    expect(p.boardingPass.transitType).toBe("PKTransitTypeAir");
    expect(p.boardingPass.headerFields).toEqual([{ key: "gate", label: "GATE", value: "B12" }]);
    expect(p.boardingPass.primaryFields.map(f => f.key)).toEqual(["depart", "arrive"]);
    expect(p.boardingPass.auxiliaryFields[0]).toEqual({ key: "boarding", label: "BOARDING", value: "2026-06-01T07:30:00-07:00", dateStyle: "PKDateStyleNone", timeStyle: "PKDateStyleShort" });
  });

  it("spreads filled semantics, drops empties, mirrors both time-zone spellings", () => {
    const p = formStateToPassJson(base);
    expect(p.semantics.airlineCode).toBe("RP");
    expect(p.semantics.flightNumber).toBe(247);
    expect(p.semantics.passengerName).toEqual({ givenName: "ANGELO", familyName: "SOLIVERES" });
    expect(p.semantics.departureGate).toBeUndefined();               // empty dropped
    expect(p.semantics.departureLocationTimeZone).toBe("America/Los_Angeles");
    expect(p.semantics.departureAirportTimeZone).toBe("America/Los_Angeles"); // mirrored
  });

  it("derives wifiAccess from the iOS26.wifi bucket", () => {
    const p = formStateToPassJson(base);
    expect(p.semantics.wifiAccess).toEqual([{ ssid: "GoGoInflight", password: "RP247" }]);
  });

  it("emits the iOS 26 extras and passes meta web-service fields through", () => {
    const p = formStateToPassJson({ ...base,
      meta: { ...base.meta, webServiceURL: "http://localhost:4317/api/wallet", authenticationToken: "0123456789abcdef0123456789abcdef" },
      iOS26: { ...base.iOS26,
        additionalInfoFields: [{ key: "loyalty", label: "STATUS", value: "Gold" }],
        relevantDates: ["2026-06-01T07:00:00-07:00"],
        eventGuide: { bagPolicyURL: "https://x/bags" },
        upcomingPassInformation: [{ identifier: "b", name: "Boarding", date: "2026-06-01T07:30:00-07:00" }] } });
    expect(p.boardingPass.additionalInfoFields[0].key).toBe("loyalty");
    expect(p.relevantDates).toEqual([{ date: "2026-06-01T07:00:00-07:00", relevantDate: "2026-06-01T07:00:00-07:00" }]);
    expect(p.bagPolicyURL).toBe("https://x/bags");
    expect(p.upcomingPassInformation[0]).toEqual({ identifier: "b", name: "Boarding", type: "event", dateInformation: { date: "2026-06-01T07:30:00-07:00" } });
    expect(p.webServiceURL).toBe("http://localhost:4317/api/wallet");
    expect(p.authenticationToken).toMatch(/^[a-f0-9]{32}$/);
  });

  it("omits all iOS 26 extras when the bucket is absent", () => {
    const p = formStateToPassJson(base);
    expect(p.boardingPass.additionalInfoFields).toBeUndefined();
    expect(p.relevantDates).toBeUndefined();
    expect(p.upcomingPassInformation).toBeUndefined();
    expect(p.bagPolicyURL).toBeUndefined();
    expect(p.webServiceURL).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run tests/form-to-pass.test.js` (old emitter reads `s.flight`, throws / mismatches).

- [ ] **Step 3: Rewrite `packages/pass-builder/form-to-pass.js`:**
```js
import { isEmptyTyped } from "./suggest-empty.js";
import { SEMANTIC_CATALOG, TIMEZONE_KEY_ALIASES } from "./semantics.js";

/**
 * Pure: new-shape FormState -> Apple pass.json with full iOS 26 opt-in.
 * boardingPass.*Fields come verbatim from displayFields; semantics are spread
 * filled-only (both time-zone spellings mirrored, wifiAccess derived from the
 * iOS26.wifi bucket); the 5 iOS26 structural extras pass through.
 * @param {import("@wpd/pass-schema").FormState} s
 */
export function formStateToPassJson(s) {
  const { meta, branding, barcode } = s;
  const df = s.displayFields ?? {};
  const ios = s.iOS26 ?? {};

  const boardingPass = {
    transitType: "PKTransitTypeAir",
    headerFields: (df.header ?? []).map(f => ({ ...f })),
    primaryFields: (df.primary ?? []).map(f => ({ ...f })),
    secondaryFields: (df.secondary ?? []).map(f => ({ ...f })),
    auxiliaryFields: (df.auxiliary ?? []).map(f => ({ ...f })),
    backFields: (df.back ?? []).map(f => ({ ...f })),
    ...(ios.additionalInfoFields?.length && { additionalInfoFields: ios.additionalInfoFields })
  };

  return {
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
    preferredStyleSchemes: ["semanticBoardingPass"],
    barcodes: [{ format: barcode.format, message: barcode.message, messageEncoding: "iso-8859-1", altText: barcode.altText }],
    boardingPass,
    semantics: emitSemantics(s.semantics, ios.wifi),
    ...(ios.relevantDates?.length && { relevantDates: ios.relevantDates.map(d => ({ date: d, relevantDate: d })) }),
    ...(ios.eventGuide && stripUndef(ios.eventGuide)),
    ...(ios.upcomingPassInformation?.length && {
      upcomingPassInformation: ios.upcomingPassInformation.map(e => ({ identifier: e.identifier, name: e.name, type: "event", dateInformation: { date: e.date } }))
    }),
    ...(meta.webServiceURL && { webServiceURL: meta.webServiceURL }),
    ...(meta.authenticationToken && { authenticationToken: meta.authenticationToken })
  };
}

/** Filled-only semantics (per catalog type), with both tz spellings + wifiAccess. */
function emitSemantics(semantics = {}, wifi) {
  const out = {};
  for (const [k, v] of Object.entries(semantics)) {
    const type = SEMANTIC_CATALOG[k]?.type ?? "text";
    if (!isEmptyTyped(type, v)) out[k] = v;
  }
  for (const [docKey, airportKey] of Object.entries(TIMEZONE_KEY_ALIASES)) {
    if (out[docKey] && !out[airportKey]) out[airportKey] = out[docKey];
    else if (out[airportKey] && !out[docKey]) out[docKey] = out[airportKey];
  }
  if (wifi?.length) out.wifiAccess = wifi.map(w => ({ ssid: w.ssid, ...(w.password && { password: w.password }) }));
  return out;
}

function stripUndef(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") out[k] = v;
  return out;
}
```

- [ ] **Step 4: Run it, expect PASS** — `npx vitest run tests/form-to-pass.test.js`.

- [ ] **Step 5: Add the round-trip exactness block** to `tests/migrate.test.js` (this is the keystone safety net). Append:
```js
import { formStateToPassJson } from "../packages/pass-builder/form-to-pass.js";

const oldRich = {
  meta: { passTypeId: "pass.dev.local", teamId: "DEV0000000", organizationName: "Rocket Partners Airlines", serialNumber: "RP-002", description: "Boarding pass", webServiceURL: "http://localhost:4317/api/wallet", authenticationToken: "0123456789abcdef0123456789abcdef" },
  branding: { logoText: "Rocket Partners", foregroundColor: "rgb(255,255,255)", backgroundColor: "rgb(20,30,80)", labelColor: "rgb(180,200,255)" },
  flight: {
    airlineCode: "RP", flightNumber: "247",
    departure: { iata: "SFO", name: "San Francisco Intl", city: "San Francisco", terminal: "2", gate: "B12", boarding: "2026-06-01T07:30:00-07:00", depart: "2026-06-01T08:15:00-07:00", timeZone: "America/Los_Angeles", latitude: 37.6213, longitude: -122.3790 },
    arrival:   { iata: "JFK", name: "John F. Kennedy Intl", city: "New York", terminal: "4", gate: "B7", arrive: "2026-06-01T16:45:00-04:00", timeZone: "America/New_York", latitude: 40.6413, longitude: -73.7781 }
  },
  passenger: { name: "ANGELO SOLIVERES", confirmationNumber: "GHK2X9", ticketFareClass: "Y", priorityStatus: "Gold", boardingZone: "3", documentsVerified: true, membershipProgramName: "Rocket Rewards", frequentFlyerNumber: "RP-GOLD-1", seats: [{ number: "14A", cabin: "economy", description: "Window seat" }], boardingGroup: "3", seqNumber: "0042" },
  barcode: { format: "PKBarcodeFormatQR", message: "RP247-SFOJFK-14A-0042", altText: "RP247 14A" },
  iOS26: {
    duration: 19800, securityScreening: "TSA PreCheck", transitInfo: "Train", transitStatus: "On Time", transitStatusReason: "", silenceRequested: false,
    wifi: [{ ssid: "GoGoInflight", password: "RP247" }],
    additionalInfoFields: [{ key: "loyalty", label: "STATUS", value: "Gold" }],
    relevantDates: ["2026-06-01T07:00:00-07:00"],
    eventGuide: { bagPolicyURL: "https://x/bags", orderFoodURL: "https://x/food" },
    upcomingPassInformation: [{ identifier: "b", name: "Boarding", date: "2026-06-01T07:30:00-07:00" }]
  }
};

describe("round-trip: new emitter on migrated state == frozen legacy emitter", () => {
  it("reproduces legacy pass.json byte-for-byte", () => {
    for (const old of [oldBase, oldRich]) {
      expect(formStateToPassJson(migrateFormState(old))).toEqual(legacyFormStateToPassJson(old));
    }
  });
});
```

- [ ] **Step 6: Run it, expect PASS** — `npx vitest run tests/migrate.test.js`.

- [ ] **Step 7: Rewrite `packages/pass-schema/schema.json`** to the new shape:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "wpd/form-state",
  "type": "object",
  "required": ["meta", "branding", "barcode", "semantics", "displayFields"],
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
        "description": { "type": "string" },
        "webServiceURL": { "type": "string" },
        "authenticationToken": { "type": "string", "minLength": 16 }
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
        "labelColor": { "type": "string", "pattern": "^rgb\\(\\d+,\\s*\\d+,\\s*\\d+\\)$" },
        "logoDataUrl": { "type": "string" }
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
    "semantics": { "type": "object" },
    "displayFields": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "header": { "$ref": "#/definitions/fieldList" },
        "primary": { "$ref": "#/definitions/fieldList" },
        "secondary": { "$ref": "#/definitions/fieldList" },
        "auxiliary": { "$ref": "#/definitions/fieldList" },
        "back": { "$ref": "#/definitions/fieldList" }
      }
    },
    "iOS26": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "additionalInfoFields": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["key", "label", "value"],
            "properties": {
              "key": { "type": "string" }, "label": { "type": "string" }, "value": { "type": "string" }, "changeMessage": { "type": "string" }
            }
          }
        },
        "relevantDates": { "type": "array", "items": { "type": "string", "format": "date-time" } },
        "eventGuide": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "bagPolicyURL": { "type": "string" }, "orderFoodURL": { "type": "string" }, "transferURL": { "type": "string" },
            "parkingInformationURL": { "type": "string" }, "directionsInformationURL": { "type": "string" }, "transitInformationURL": { "type": "string" }
          }
        },
        "upcomingPassInformation": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["identifier", "name", "date"],
            "properties": { "identifier": { "type": "string" }, "name": { "type": "string" }, "date": { "type": "string", "format": "date-time" } }
          }
        },
        "wifi": {
          "type": "array",
          "items": { "type": "object", "required": ["ssid"], "properties": { "ssid": { "type": "string" }, "password": { "type": "string" } } }
        }
      }
    }
  },
  "definitions": {
    "fieldList": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["key", "label", "value"],
        "properties": {
          "key": { "type": "string" },
          "label": { "type": "string" },
          "value": { "type": "string" },
          "dateStyle": { "type": "string" },
          "timeStyle": { "type": "string" },
          "changeMessage": { "type": "string" }
        }
      }
    }
  }
}
```

- [ ] **Step 8: Update the JSDoc typedef** in `packages/pass-schema/index.js` (replace the `Endpoint` + `FormState` typedefs):
```js
import schema from "./schema.json" with { type: "json" };
export { schema };

/**
 * @typedef {Object} DisplayField
 * @property {string} key
 * @property {string} label
 * @property {string} value
 * @property {string} [dateStyle]
 * @property {string} [timeStyle]
 * @property {string} [changeMessage]
 */

/**
 * @typedef {Object} FormState  semantics-first boarding-pass design
 * @property {{passTypeId:string, teamId:string, organizationName:string, serialNumber:string, description:string, webServiceURL?:string, authenticationToken?:string}} meta
 * @property {{logoText:string, foregroundColor:string, backgroundColor:string, labelColor:string, logoDataUrl?:string}} branding
 * @property {{format:string, message:string, altText:string}} barcode
 * @property {Record<string, *>} semantics  Apple semantic keys (SEMANTIC_CATALOG), filled-only; wifiAccess lives in iOS26.wifi
 * @property {{header:DisplayField[], primary:DisplayField[], secondary:DisplayField[], auxiliary:DisplayField[], back:DisplayField[]}} displayFields
 * @property {Object} [iOS26]  structural extras: additionalInfoFields, relevantDates, eventGuide, upcomingPassInformation, wifi
 */
```

- [ ] **Step 9: Migrate the 6 committed fixtures in place** (uses `migrateFormState` from Task 1):
```bash
node --input-type=module -e '
import { readdir, readFile, writeFile } from "node:fs/promises";
import { migrateFormState } from "./packages/pass-builder/migrate.js";
for (const f of await readdir("fixtures")) {
  if (!f.endsWith(".json")) continue;
  const p = `fixtures/${f}`;
  const next = migrateFormState(JSON.parse(await readFile(p, "utf8")));
  await writeFile(p, JSON.stringify(next, null, 2) + "\n");
  console.log("migrated", f);
}
'
```

- [ ] **Step 10: Validate fixtures against the new schema** — `npm run check`. Expected: `OK` for all 6 fixtures.

- [ ] **Step 11: Confirm the integration test still passes unchanged** — `npx vitest run tests/integration.test.js`. It builds `fixtures/fully-loaded.json` (now new shape) and asserts `pass.semantics.airlineCode`/`wifiAccess[0].ssid`/`duration` — all still emitted (duration via semantics, wifiAccess via the iOS26.wifi bucket). Expected: PASS, no edits.

- [ ] **Step 12: Full suite + designer build** — `npm test && npm run build:designer`. Expected: all green. (`scripts/field-coverage.mjs` reads fixtures through `formStateToPassJson` and works unchanged with the migrated fixtures; rerun it by hand only when regenerating `docs/field-coverage.md`.)

- [ ] **Step 13: Commit**
```bash
git add packages/pass-builder/form-to-pass.js packages/pass-schema/schema.json packages/pass-schema/index.js fixtures/ tests/form-to-pass.test.js tests/migrate.test.js
git commit -m "feat(designer): emit pass.json from semantics-first FormState; migrate schema + fixtures"
```

---

### Task 3: Server — group-id, build-time migration, FormState status updates

Wire the server onto the new shape. **Migration is applied at use-sites, NOT in `rowToRec`** (`rowToRec`/`snapshot()` must keep returning the stored shape verbatim — `tests/storage-sqlite.test.js` deep-equals a stored `{flight:{}}` stub). Also remove the now-dead `deriveIssueSemantics` (Phase-2 leftover).

**Files:**
- Modify: `apps/server/src/storage.js` (`deriveGroupId`)
- Modify: `apps/server/src/pass-build.js` (`buildStoredPass` migrates `rec.state`)
- Modify: `apps/server/src/routes/admin.js` (`applyStatus` new shape; migrate in status wrapper; `passengerOf` + seat readout)
- Modify: `apps/server/src/template-status.js` (delete `deriveIssueSemantics`)
- Modify: `tests/admin-status.test.js` (rewrite to new shape)
- Modify: `tests/template-status.test.js` (drop the `deriveIssueSemantics` describe block)

- [ ] **Step 1: Rewrite the FormState status test.** Replace the first `describe` block of `tests/admin-status.test.js` (keep the `normalizeStatusBody` block at the bottom unchanged):
```js
import { describe, it, expect } from "vitest";
import { applyStatus } from "../apps/server/src/routes/admin.js";
import { normalizeStatusBody } from "../apps/server/src/template-status.js";

const baseState = () => ({ semantics: { departureGate: "A1" }, displayFields: {} });

describe("applyStatus (FormState, semantics-first)", () => {
  it("maps transitStatus + reason onto semantics and a visible status row with a change banner", () => {
    const next = applyStatus(baseState(), { transitStatus: "Delayed", transitStatusReason: "crew availability" });
    expect(next.semantics.transitStatus).toBe("Delayed");
    expect(next.semantics.transitStatusReason).toBe("crew availability");
    expect(next.iOS26.additionalInfoFields).toEqual([
      { key: "status", label: "STATUS", value: "Delayed — crew availability", changeMessage: "%@" }
    ]);
  });

  it("clears the status row and both semantics with empty strings", () => {
    const set = applyStatus(baseState(), { transitStatus: "Cancelled", transitStatusReason: "aircraft fault" });
    const next = applyStatus(set, { transitStatus: "", transitStatusReason: "" });
    expect(next.semantics.transitStatus).toBeUndefined();
    expect(next.semantics.transitStatusReason).toBeUndefined();
    expect(next.iOS26.additionalInfoFields).toEqual([]);
  });

  it("keeps the delay row independent of the status row", () => {
    const next = applyStatus(baseState(), { delayed: "45 min", transitStatus: "Delayed" });
    expect(next.iOS26.additionalInfoFields.map(f => f.key).sort()).toEqual(["delay", "status"]);
  });

  it("normalizes the {value, changeMessage} object form to the plain value", () => {
    const next = applyStatus(baseState(), { departureGate: { value: "B12", changeMessage: "Gate changed to %@" } });
    expect(next.semantics.departureGate).toBe("B12");
  });

  it("does not mutate the input state", () => {
    const input = baseState();
    applyStatus(input, { departureGate: "B12", transitStatus: "Delayed" });
    expect(input.semantics.departureGate).toBe("A1");
    expect(input.iOS26).toBeUndefined();
  });

  it("maps the semantic schedule keys onto semantics", () => {
    const next = applyStatus(baseState(), {
      departureGate: "C3",
      currentBoardingDate: "2026-06-20T07:30:00-07:00",
      currentDepartureDate: "2026-06-20T08:00:00-07:00",
      currentArrivalDate: "2026-06-20T16:45:00-04:00",
      transitProvider: "Train to Concourse B"
    });
    expect(next.semantics.departureGate).toBe("C3");
    expect(next.semantics.currentBoardingDate).toBe("2026-06-20T07:30:00-07:00");
    expect(next.semantics.currentDepartureDate).toBe("2026-06-20T08:00:00-07:00");
    expect(next.semantics.currentArrivalDate).toBe("2026-06-20T16:45:00-04:00");
    expect(next.semantics.transitProvider).toBe("Train to Concourse B");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run tests/admin-status.test.js`.

- [ ] **Step 3: Rewrite `applyStatus`** in `apps/server/src/routes/admin.js` (replace the whole `applyStatus` function; keep `fieldDataValue` above it):
```js
/**
 * Apply a status change to a pass's FormState. Pure: returns a new state.
 * Semantics-first: the vocabulary is semantic keys; each maps to a semantics
 * entry ("" clears). The visible STATUS / DELAY rows live in iOS26.additionalInfoFields.
 * (Unlike the old shape, the compact gate/time display fields are not re-synced
 * here — iOS 26 renders the expanded view + Live Activity from semantics; see plan
 * open items.) Object-form values are normalized to their value.
 */
export function applyStatus(state, body = {}) {
  const {
    departureGate, currentBoardingDate, currentDepartureDate, currentArrivalDate,
    transitProvider, securityScreening, delayed, transitStatus, transitStatusReason
  } = body;
  const next = structuredClone(state);
  const sem = { ...(next.semantics ?? {}) };
  const set = (key, raw) => { const v = fieldDataValue(raw); if (v) sem[key] = v; else delete sem[key]; };
  if (departureGate !== undefined)        set("departureGate", departureGate);
  if (currentBoardingDate !== undefined)  set("currentBoardingDate", currentBoardingDate);
  if (currentDepartureDate !== undefined) set("currentDepartureDate", currentDepartureDate);
  if (currentArrivalDate !== undefined)   set("currentArrivalDate", currentArrivalDate);
  if (transitProvider !== undefined)      set("transitProvider", transitProvider);
  if (securityScreening !== undefined)    set("securityScreening", securityScreening);

  next.iOS26 ??= {};
  const upsertInfoRow = (key, row) => {
    next.iOS26.additionalInfoFields = (next.iOS26.additionalInfoFields ?? []).filter(f => f.key !== key);
    if (row) next.iOS26.additionalInfoFields.push(row);
  };
  if (delayed !== undefined) {
    const v = fieldDataValue(delayed);
    upsertInfoRow("delay", v ? { key: "delay", label: "DELAY", value: v } : null);
  }
  if (transitStatus !== undefined || transitStatusReason !== undefined) {
    if (transitStatus !== undefined) { const v = fieldDataValue(transitStatus); if (v) sem.transitStatus = v; else delete sem.transitStatus; }
    if (transitStatusReason !== undefined) { const v = fieldDataValue(transitStatusReason); if (v) sem.transitStatusReason = v; else delete sem.transitStatusReason; }
    const display = transitStatusDisplay(sem.transitStatus, sem.transitStatusReason);
    upsertInfoRow("status", display ? { key: "status", label: "STATUS", value: display, changeMessage: "%@" } : null);
  }
  next.semantics = sem;
  return next;
}
```

- [ ] **Step 4: Migrate on read at the FormState use-sites** in `apps/server/src/routes/admin.js`:
  - Add to the import from `@wpd/pass-builder` (line ~5): `migrateFormState` — i.e. `import { applyTemplateData, loadTemplate, migrateFormState } from "@wpd/pass-builder";`
  - In `applyStatusToStoredPass`, change the FormState branch (line ~170) to migrate before mutating:
```js
  return { rec: await updatePassState(serial, state => applyStatus(migrateFormState(state), normalized)), skipped: [] };
```
  - Replace `passengerOf` (line ~131) and the seat readout in `GET /api/passes` so both read the new shape (migrating old-shape rows on the fly):
```js
const passengerOf = (rec) => {
  if (rec.data) return fieldDataValue(rec.data.passenger);
  const pn = migrateFormState(rec.state)?.semantics?.passengerName;
  return pn ? [pn.givenName, pn.familyName].filter(Boolean).join(" ") : undefined;
};
const seatOf = (rec) => {
  if (rec.data) return fieldDataValue(rec.data.seat);
  const s = migrateFormState(rec.state)?.semantics?.seats?.[0];
  return s ? `${s.seatRow ?? ""}${s.seatNumber ?? ""}` || undefined : undefined;
};
```
  - In the `GET /api/passes` map (line ~141), replace the `seat:` line with: `seat: seatOf(rec),`

- [ ] **Step 5: Migrate `rec.state` at build time** in `apps/server/src/pass-build.js`:
  - Add `migrateFormState` to the import (line ~8): `import { buildPkpass, buildPkpassFromTemplate, migrateFormState } from "@wpd/pass-builder";`
  - In `buildStoredPass`, change the FormState branch to migrate (line ~46):
```js
  return buildPkpass({
    state: migrateFormState(rec.state),
    certDir: env.certDir,
    passphrase: env.passphrase,
    overrides: {
```

- [ ] **Step 6: Rework `deriveGroupId`** in `apps/server/src/storage.js`:
  - Add an import at the top: `import { migrateFormState } from "@wpd/pass-builder";`
  - Replace `deriveGroupId` (line ~211):
```js
/** A trip is one flight on one day; every passenger's pass shares this id. */
export function deriveGroupId(state) {
  if (state.meta?.groupId) return state.meta.groupId;
  const sem = migrateFormState(state)?.semantics ?? {};
  const date = (sem.currentDepartureDate ?? sem.originalDepartureDate ?? "").slice(0, 10) || "nodate";
  return `${sem.airlineCode ?? "?"}${sem.flightNumber ?? "?"}@${date}`;
}
```

- [ ] **Step 7: Delete the dead `deriveIssueSemantics`.** Confirm it is unreferenced outside its own test: `grep -rn deriveIssueSemantics apps packages scripts tests`. Expected: only `apps/server/src/template-status.js` (definition) + `tests/template-status.test.js`. Remove the entire `export function deriveIssueSemantics(...) { ... }` from `apps/server/src/template-status.js`, and remove the `describe("deriveIssueSemantics", ...)` block (and any now-unused `seatSemantics`/`splitPersonName` import it relied on **only if** nothing else in that test file uses them) from `tests/template-status.test.js`.

- [ ] **Step 8: Run the touched tests, expect PASS** — `npx vitest run tests/admin-status.test.js tests/template-status.test.js tests/storage-sqlite.test.js`.

- [ ] **Step 9: Full suite green** — `npm test`.

- [ ] **Step 10: Commit**
```bash
git add apps/server/src/storage.js apps/server/src/pass-build.js apps/server/src/routes/admin.js apps/server/src/template-status.js tests/admin-status.test.js tests/template-status.test.js
git commit -m "feat(server): semantics-first FormState status/group-id/build; drop dead deriveIssueSemantics"
```

---

### Task 4: Shift-dates on the new shape

`shiftPassDates` anchored on `flight.departure.depart`. Re-anchor on `semantics.currentDepartureDate`, shift all semantic date keys + any ISO-valued display field (migrated boarding/depart fields carry literal ISO) + the iOS26 extras.

**Files:**
- Modify: `packages/pass-builder/shift-dates.js`
- Modify: `tests/shift-dates.test.js` (rewrite to the new shape)
- Modify: `scripts/build-pass.js` (the `--now` log line)

- [ ] **Step 1: Rewrite the test.** Replace the whole body of `tests/shift-dates.test.js`:
```js
import { describe, it, expect } from "vitest";
import { shiftPassDates } from "../packages/pass-builder/shift-dates.js";

const base = () => ({
  semantics: {
    originalBoardingDate: "2026-06-20T05:05:00+08:00",
    currentBoardingDate:  "2026-06-20T05:05:00+08:00",
    originalDepartureDate: "2026-06-20T05:45:00+08:00",
    currentDepartureDate:  "2026-06-20T05:45:00+08:00",
    originalArrivalDate: "2026-06-20T08:05:00+08:00",
    currentArrivalDate:  "2026-06-20T08:05:00+08:00"
  },
  displayFields: { auxiliary: [{ key: "boarding", label: "BOARDING", value: "2026-06-20T05:05:00+08:00", dateStyle: "PKDateStyleNone", timeStyle: "PKDateStyleShort" }] },
  iOS26: {
    relevantDates: ["2026-06-20T04:45:00+08:00"],
    upcomingPassInformation: [{ identifier: "x", name: "X", date: "2026-06-18T05:45:00+08:00" }]
  }
});
const NOW = Date.parse("2026-01-01T00:00:00Z");

describe("shiftPassDates", () => {
  it("anchors current departure to now + leadMinutes", () => {
    const out = shiftPassDates(base(), { leadMinutes: 60, now: NOW });
    expect(Date.parse(out.semantics.currentDepartureDate) - NOW).toBe(60 * 60000);
  });

  it("preserves the gaps between schedule events", () => {
    const out = shiftPassDates(base(), { leadMinutes: 60, now: NOW });
    const dep = Date.parse(out.semantics.currentDepartureDate);
    expect(dep - Date.parse(out.semantics.currentBoardingDate)).toBe(40 * 60000); // 05:45 - 05:05
    expect(Date.parse(out.semantics.currentArrivalDate) - dep).toBe(140 * 60000); // 08:05 - 05:45
  });

  it("shifts a display field whose value is an ISO datetime", () => {
    const out = shiftPassDates(base(), { leadMinutes: 60, now: NOW });
    const dep = Date.parse(out.semantics.currentDepartureDate);
    expect(dep - Date.parse(out.displayFields.auxiliary[0].value)).toBe(40 * 60000);
  });

  it("shifts relevantDates and upcomingPassInformation", () => {
    const out = shiftPassDates(base(), { leadMinutes: 60, now: NOW });
    const dep = Date.parse(out.semantics.currentDepartureDate);
    expect(dep - Date.parse(out.iOS26.relevantDates[0])).toBe(60 * 60000);
    expect(Date.parse(out.iOS26.upcomingPassInformation[0].date)).toBeLessThan(dep);
  });

  it("emits +08:00 offset strings", () => {
    const out = shiftPassDates(base(), { leadMinutes: 60, now: NOW });
    expect(out.semantics.currentDepartureDate).toMatch(/\+08:00$/);
  });

  it("does not mutate the input", () => {
    const input = base();
    shiftPassDates(input, { leadMinutes: 60, now: NOW });
    expect(input.semantics.currentDepartureDate).toBe("2026-06-20T05:45:00+08:00");
  });

  it("returns the state untouched when there is no departure date", () => {
    const out = shiftPassDates({ semantics: {} }, { now: NOW });
    expect(out.semantics.currentDepartureDate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run tests/shift-dates.test.js`.

- [ ] **Step 3: Rewrite `packages/pass-builder/shift-dates.js`** (keep `toOffsetISO` unchanged at the bottom):
```js
// Shift a pass's schedule so it's relevant "now" — for live Live-Activity demos.
// Pure: returns a new FormState, never mutates the input. Operates on the
// semantics-first shape: re-anchors the schedule semantics, any ISO-valued
// display field, and the iOS 26 relevant/upcoming dates.

import { SEMANTIC_DATE_KEYS } from "./semantics.js";

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * @param {object} state  FormState (new shape)
 * @param {{leadMinutes?:number, offsetMinutes?:number, now?:number}} [opts]
 * @returns {object} new FormState
 */
export function shiftPassDates(state, { leadMinutes = 60, offsetMinutes = 480, now = Date.now() } = {}) {
  const sem = state?.semantics ?? {};
  const anchor = Date.parse(sem.currentDepartureDate ?? sem.originalDepartureDate ?? "");
  if (Number.isNaN(anchor)) return state; // nothing to anchor on — leave untouched
  const delta = (now + leadMinutes * 60000) - anchor;
  const shift = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? iso : toOffsetISO(t + delta, offsetMinutes); };

  const next = structuredClone(state);
  const nsem = next.semantics ?? {};
  for (const k of SEMANTIC_DATE_KEYS) if (nsem[k]) nsem[k] = shift(nsem[k]);

  for (const section of Object.values(next.displayFields ?? {})) {
    if (!Array.isArray(section)) continue;
    for (const f of section) if (typeof f.value === "string" && ISO_DATETIME.test(f.value)) f.value = shift(f.value);
  }

  const ios = next.iOS26 ?? {};
  if (Array.isArray(ios.relevantDates)) ios.relevantDates = ios.relevantDates.map(shift);
  if (Array.isArray(ios.upcomingPassInformation)) {
    ios.upcomingPassInformation = ios.upcomingPassInformation.map(e => e?.date ? { ...e, date: shift(e.date) } : e);
  }
  return next;
}

/** Format an epoch-ms instant as an ISO string at a fixed UTC offset (minutes). */
function toOffsetISO(ms, offsetMinutes) {
  const d = new Date(ms + offsetMinutes * 60000);
  const p = (n) => String(n).padStart(2, "0");
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}
```

- [ ] **Step 4: Fix the `--now` log line** in `scripts/build-pass.js` (line ~57): replace
```js
  console.log(`↻ shifted schedule: departs ${state.flight.departure.depart} (now + ${leadMinutes}m)`);
```
with
```js
  console.log(`↻ shifted schedule: departs ${state.semantics?.currentDepartureDate ?? "?"} (now + ${leadMinutes}m)`);
```

- [ ] **Step 5: Run it, expect PASS** — `npx vitest run tests/shift-dates.test.js`.

- [ ] **Step 6: Full suite + sanity-build the shifted CLI path** —
```bash
npm test
npm run build:pass -- --in fixtures/eva-br262.json --now --lead 30
```
Expected: suite green; the CLI prints a shifted `currentDepartureDate` and writes `out/eva-br262.pkpass`.

- [ ] **Step 7: Commit**
```bash
git add packages/pass-builder/shift-dates.js tests/shift-dates.test.js scripts/build-pass.js
git commit -m "feat(pass-builder): shiftPassDates re-anchors the semantics-first schedule"
```

---

### Task 5: Designer state + form (semantics editor + display-fields editor + Suggest)

Make the Designer authoring surface semantics-first. The default `initial` state is produced by running `migrateFormState` over the old seed (guarantees it matches what the preview expects); persisted localStorage / loaded fixtures are migrated on read. The form keeps Meta/Branding/Assets/Barcode and adds the semantics editor + a display-fields editor with a Suggest button. **Browser-verified** — `form.js` has no DOM unit tests (repo convention); the pure helper is covered in Task 1/2.

**Files:**
- Modify: `apps/designer/src/state.js`
- Modify: `apps/designer/src/form.js`
- Modify: `apps/designer/src/styles.css`

- [ ] **Step 1: Rewrite `apps/designer/src/state.js`** so the seed + persisted + replace paths all go through `migrateFormState`:
```js
// Tiny pub-sub form state. Single source of truth for previews + build.
import { migrateFormState } from "@wpd/pass-builder/migrate.js";

// Old-shape seed, migrated once to the new shape so the default matches the
// preview/emitter exactly (no hand-maintained parallel shape).
const initial = migrateFormState({
  meta: { passTypeId: "pass.com.angelo.airline.boardingpass", teamId: "WB7K79MCZG", organizationName: "Rocket Partners Airlines", serialNumber: "RP-001", description: "Boarding pass" },
  branding: { logoText: "Rocket Partners", foregroundColor: "rgb(255,255,255)", backgroundColor: "rgb(20,30,80)", labelColor: "rgb(180,200,255)" },
  flight: {
    airlineCode: "RP", flightNumber: "247",
    departure: { iata: "SFO", name: "San Francisco Intl", city: "San Francisco", terminal: "2", gate: "B12", boarding: "2026-06-01T07:30:00-07:00", depart: "2026-06-01T08:15:00-07:00" },
    arrival:   { iata: "JFK", name: "John F. Kennedy Intl", city: "New York", terminal: "4", arrive: "2026-06-01T16:45:00-04:00" }
  },
  passenger: { name: "ANGELO SOLIVERES", seats: [{ number: "14A", cabin: "economy", row: "14", letter: "A" }], boardingGroup: "3", seqNumber: "0042" },
  barcode: { format: "PKBarcodeFormatQR", message: "RP247-SFOJFK-14A-0042", altText: "RP247 14A" },
  iOS26: { duration: 19800, securityScreening: "TSA PreCheck", wifi: [{ ssid: "GoGoInflight", password: "RP247" }] }
});

const STORAGE_KEY = "wpd:form-state";

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migrateFormState(JSON.parse(raw)); // pre-Phase-3 saved state -> new shape
  } catch { return null; }
}

export const state = loadPersisted() ?? structuredClone(initial);
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  listeners.forEach(fn => fn(state));
};

export function resetState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, structuredClone(initial));
  notify();
}

/** Replace the whole state object (used when loading a fixture). Migrates old-shape input. */
export function replaceState(next) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, structuredClone(migrateFormState(next)));
  notify();
}

/** Set a deep path like "displayFields" or "meta.serialNumber" to a value. */
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

- [ ] **Step 2: Rewrite `apps/designer/src/form.js`.** Keep Meta/Branding/Assets/Barcode (trim Flight/Departure/Arrival/Passenger/Seat/iOS26), then mount the semantics + display-fields editors:
```js
import { setPath, getPath, state } from "./state.js";
import { scanBarcode } from "./scan.js";
import { renderSemanticsEditor } from "./semantics-editor.js";
import { suggestDisplayValues } from "@wpd/pass-builder/suggest.js";

const rgbToHex = (s) => {
  const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(s || "");
  if (!m) return "#000000";
  return "#" + [1, 2, 3].map(i => Number(m[i]).toString(16).padStart(2, "0")).join("");
};
const hexToRgb = (h) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || "");
  return m ? `rgb(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)})` : "rgb(0,0,0)";
};

const SECTIONS = ["header", "primary", "secondary", "auxiliary", "back"];
const SECTION_LABEL = { header: "Header", primary: "Primary", secondary: "Secondary", auxiliary: "Auxiliary", back: "Back" };

// The Designer's built-in semanticKey -> displayField-key map (its own field
// vocabulary). "Suggest values" fills these display fields from the semantics.
const DESIGNER_SUGGEST_MAP = {
  departureGate: "gate", seats: "seat",
  departureAirportCode: "depart", destinationAirportCode: "arrive",
  passengerName: "passenger", flightCode: "flight",
  currentBoardingDate: "boarding", currentDepartureDate: "depart-time",
  boardingGroup: "group", boardingSequenceNumber: "seq",
  membershipProgramNumber: "ff", departureTerminal: "terminal-dep", destinationTerminal: "terminal-arr"
};

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
    { path: "branding.foregroundColor", label: "Foreground", type: "color" },
    { path: "branding.backgroundColor", label: "Background", type: "color" },
    { path: "branding.labelColor", label: "Label", type: "color" }
  ]],
  ["Assets", [
    { path: "branding.logoDataUrl", label: "Logo image (PNG/SVG)", type: "file" }
  ]],
  ["Barcode", [
    { path: "barcode.format", label: "Format", type: "select", options: ["PKBarcodeFormatQR", "PKBarcodeFormatPDF417", "PKBarcodeFormatAztec", "PKBarcodeFormatCode128"] },
    { path: "barcode.message", label: "Message", type: "text" },
    { type: "scan", forPath: "barcode.message", label: "Scan barcode (camera / photo) → fills Message" },
    { path: "barcode.altText", label: "Alt Text", type: "text" }
  ]]
];

export function renderForm(root) {
  root.innerHTML = "";
  for (const [title, fields] of sections) root.appendChild(renderStaticSection(title, fields, root));
  root.appendChild(renderSemanticsSection());
  root.appendChild(renderDisplayFieldsSection());
}

function renderStaticSection(title, fields, root) {
  const fs = document.createElement("fieldset");
  const lg = document.createElement("legend");
  lg.textContent = title;
  fs.appendChild(lg);
  for (const f of fields) {
    const lbl = document.createElement("label");
    lbl.textContent = f.label;
    fs.appendChild(lbl);

    if (f.type === "file") {
      const input = document.createElement("input");
      input.type = "file"; input.accept = "image/*";
      input.addEventListener("change", e => {
        const file = e.target.files?.[0];
        if (!file) { setPath(f.path, ""); return; }
        const reader = new FileReader();
        reader.onload = () => setPath(f.path, reader.result);
        reader.readAsDataURL(file);
      });
      fs.appendChild(input);
      if (getPath(f.path)) {
        const note = document.createElement("div");
        note.style.cssText = "font-size:11px;color:#888;margin-top:2px";
        note.textContent = "✓ logo set (clear by choosing a new file)";
        fs.appendChild(note);
      }
      continue;
    }
    if (f.type === "color") {
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;gap:6px;align-items:center";
      const picker = document.createElement("input");
      picker.type = "color";
      picker.style.cssText = "width:42px;height:32px;padding:0;border:1px solid #ccc;border-radius:4px;flex:none";
      const text = document.createElement("input");
      text.type = "text"; text.dataset.path = f.path; text.value = getPath(f.path) ?? "";
      picker.value = rgbToHex(text.value);
      picker.addEventListener("input", () => { const rgb = hexToRgb(picker.value); text.value = rgb; setPath(f.path, rgb); });
      text.addEventListener("input", () => { setPath(f.path, text.value); picker.value = rgbToHex(text.value); });
      wrap.append(picker, text);
      fs.appendChild(wrap);
      continue;
    }
    if (f.type === "scan") {
      const btn = document.createElement("button");
      btn.type = "button"; btn.textContent = "📷 Scan barcode";
      btn.style.cssText = "background:#1a2150;color:#fff;border:none;padding:8px 12px;border-radius:6px;cursor:pointer";
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "Scanning…";
        try {
          const text = await scanBarcode();
          if (text) {
            setPath(f.forPath, text);
            const inp = root.querySelector(`[data-path="${f.forPath}"]`);
            if (inp) inp.value = text;
          }
        } finally { btn.disabled = false; btn.textContent = "📷 Scan barcode"; }
      });
      fs.appendChild(btn);
      continue;
    }
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
    input.dataset.path = f.path;
    input.addEventListener("input", e => setPath(f.path, e.target.value));
    fs.appendChild(input);
  }
  return fs;
}

function renderSemanticsSection() {
  const fs = document.createElement("fieldset");
  const lg = document.createElement("legend");
  lg.textContent = "Semantics (Apple)";
  fs.appendChild(lg);
  fs.appendChild(renderSemanticsEditor({
    values: state.semantics ?? {},
    onChange: (next) => setPath("semantics", next)
  }));
  return fs;
}

function renderDisplayFieldsSection() {
  const fs = document.createElement("fieldset");
  const lg = document.createElement("legend");
  lg.textContent = "Display fields";
  fs.appendChild(lg);

  const suggest = document.createElement("button");
  suggest.type = "button"; suggest.className = "suggest-btn"; suggest.textContent = "✨ Suggest values from semantics";
  suggest.addEventListener("click", () => {
    const filled = suggestDisplayValues(state.semantics ?? {}, DESIGNER_SUGGEST_MAP);
    const df = structuredClone(state.displayFields ?? {});
    for (const section of SECTIONS) for (const f of df[section] ?? []) {
      if (f.key in filled) { f.value = filled[f.key]; delete f.dateStyle; delete f.timeStyle; } // value is now literal text
    }
    setPath("displayFields", df);
    rerender();
  });
  fs.appendChild(suggest);

  const body = document.createElement("div");
  fs.appendChild(body);

  function rerender() {
    body.innerHTML = "";
    const df = state.displayFields ?? {};
    for (const section of SECTIONS) {
      const block = document.createElement("div");
      block.className = "df-section";
      const head = document.createElement("div");
      head.className = "df-head"; head.textContent = SECTION_LABEL[section];
      block.appendChild(head);
      (df[section] ?? []).forEach((f, i) => block.appendChild(fieldRow(section, f, i)));
      const add = document.createElement("button");
      add.type = "button"; add.className = "df-add"; add.textContent = "+ add field";
      add.addEventListener("click", () => {
        const next = structuredClone(state.displayFields ?? {});
        (next[section] ??= []).push({ key: `field${next[section].length + 1}`, label: "", value: "" });
        setPath("displayFields", next);
        rerender();
      });
      block.appendChild(add);
      body.appendChild(block);
    }
  }

  function fieldRow(section, f, i) {
    const row = document.createElement("div");
    row.className = "df-row"; row.dataset.k = f.key;
    const key = mk("df-key", f.key, "key");
    const label = mk("df-label", f.label ?? "", "LABEL");
    const value = mk("df-value", f.value ?? "", "value");
    const update = (prop, v) => {
      const next = structuredClone(state.displayFields ?? {});
      next[section][i][prop] = v;
      setPath("displayFields", next);
    };
    key.addEventListener("input", () => update("key", key.value));
    label.addEventListener("input", () => update("label", label.value));
    value.addEventListener("input", () => update("value", value.value));
    const rm = document.createElement("button");
    rm.type = "button"; rm.textContent = "✕"; rm.title = "remove field";
    rm.addEventListener("click", () => {
      const next = structuredClone(state.displayFields ?? {});
      next[section].splice(i, 1);
      setPath("displayFields", next);
      rerender();
    });
    row.append(key, label, value, rm);
    return row;
  }

  function mk(cls, value, placeholder) {
    const i = document.createElement("input");
    i.className = cls; i.value = value; i.placeholder = placeholder;
    return i;
  }

  rerender();
  return fs;
}
```

- [ ] **Step 3: Add CSS** to `apps/designer/src/styles.css` (the `.sem-*` rules already exist from Phase 2):
```css
.suggest-btn { background:#1a2150; color:#fff; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:12px; margin-bottom:6px; }
.df-section { border-top: 1px solid #ececf2; padding: 6px 0; }
.df-head { font-size: 11px; text-transform: uppercase; color: #888; margin-bottom: 3px; }
.df-row { display: flex; gap: 6px; align-items: center; margin: 3px 0; }
.df-row .df-key { flex: 0 0 96px; font-size: 12px; }
.df-row .df-label { flex: 1; }
.df-row .df-value { flex: 2; }
.df-row button { flex: none; }
.df-add { font-size: 12px; margin-top: 2px; }
```

- [ ] **Step 4: Build + browser-verify.**
```bash
npm run build:designer
( cd apps/designer/dist && python3 -m http.server 8099 >/dev/null 2>&1 & echo $! > /tmp/wpd-http.pid )
chrome-devtools-axi open http://localhost:8099
```
Verify in the Designer view: (a) the **Semantics (Apple)** fieldset renders typed inputs — the date semantics show a `datetime-local`, `passengerName` shows given/family, `seats` shows the composite; (b) the **Display fields** fieldset lists header/primary/secondary/auxiliary/back rows with key/label/value; (c) clicking **✨ Suggest values from semantics** fills `gate`/`seat`/`depart`/`arrive`/`passenger`/`flight`/`boarding` from the semantics; (d) the live preview (front/back/detail tabs) still renders. Capture a screenshot:
```bash
chrome-devtools-axi screenshot /tmp/wpd-phase3-designer.png
kill "$(cat /tmp/wpd-http.pid)"
```

- [ ] **Step 5: Full suite (no regressions)** — `npm test`. (No new unit tests here; `form.js` DOM is browser-verified per repo convention.)

- [ ] **Step 6: Commit**
```bash
git add apps/designer/src/state.js apps/designer/src/form.js apps/designer/src/styles.css
git commit -m "feat(designer): semantics-first form (semantics editor + display-fields editor + Suggest)"
```

---

### Task 6: Trip panel on the new shape

`trip.js` seeds passengers from the design and builds one FormState pass per passenger. Re-point it at `semantics` + `displayFields`. **Browser-verified** (no unit tests for `trip.js`'s DOM; `tests/trip-shared.test.js` covers `issue.js`, not this).

**Files:**
- Modify: `apps/designer/src/trip.js` (`seedPassengers`, `buildPassState`, imports)

- [ ] **Step 1: Update imports + `seedPassengers` + `buildPassState`** in `apps/designer/src/trip.js`. Add the import at the top:
```js
import { seatSemantics, splitPersonName } from "@wpd/pass-builder/semantics.js";
```
Replace `seedPassengers` (reads `state.semantics` now):
```js
function seedPassengers() {
  const sem = state.semantics ?? {};
  const pn = sem.passengerName ?? {};
  const seat = sem.seats?.[0];
  return [{
    name: [pn.givenName, pn.familyName].filter(Boolean).join(" "),
    seat: seat ? `${seat.seatRow ?? ""}${seat.seatNumber ?? ""}` : "",
    cabin: seat?.seatType ?? "economy",
    group: sem.boardingGroup ?? "", seq: sem.boardingSequenceNumber ?? "", ff: sem.membershipProgramNumber ?? ""
  }];
}
```
Replace `buildPassState` (overrides per-passenger semantics + display fields + barcode on the new shape):
```js
// Mirror per-passenger values onto any display field whose key matches.
function setDisplayValues(displayFields, byKey) {
  const next = structuredClone(displayFields ?? {});
  for (const section of Object.values(next)) {
    if (!Array.isArray(section)) continue;
    for (const f of section) if (f.key in byKey) f.value = byKey[f.key];
  }
  return next;
}

function buildPassState(p, i) {
  const base = structuredClone(state);
  const sem = base.semantics ?? {};
  const seatId = (p.seat || String(i + 1)).replace(/\s+/g, "");
  const flightCode = sem.flightCode ?? `${sem.airlineCode ?? ""}${sem.flightNumber ?? ""}`;
  const dep = sem.departureAirportCode ?? "", arr = sem.destinationAirportCode ?? "";
  return {
    ...base,
    meta: { ...base.meta, serialNumber: `${flightCode}-${seatId}` },
    semantics: {
      ...sem,
      passengerName: splitPersonName(p.name),
      seats: [seatSemantics(p.seat, sem.seats?.[0]?.seatType ? { seatType: sem.seats[0].seatType } : {})],
      boardingGroup: p.group,
      boardingSequenceNumber: p.seq,
      ...(p.ff ? { membershipProgramNumber: p.ff } : {})
    },
    displayFields: setDisplayValues(base.displayFields, { passenger: p.name, seat: p.seat, group: p.group, seq: p.seq }),
    barcode: {
      ...base.barcode,
      message: `${flightCode}${dep}${arr}${p.seat}${p.seq}`,
      altText: `${flightCode} ${p.seat}`
    }
  };
}
```
(The group-update buttons — `g-gate`/`g-delay`/`g-boarding`/`g-clear` — already post legacy verbs that `normalizeStatusBody` maps to semantic keys, so they need no change.)

- [ ] **Step 2: Build + browser-verify the trip flow.**
```bash
npm run build:designer
( cd apps/designer/dist && python3 -m http.server 8099 >/dev/null 2>&1 & echo $! > /tmp/wpd-http.pid )
chrome-devtools-axi open http://localhost:8099
```
In the Designer view's **Trip — passengers on this flight** panel: confirm the seeded passenger row shows the name/seat/group/seq from the current semantics. (Issuing requires the API + a signing cert — verify end-to-end against a running `npm run dev` if available; otherwise confirm the page loaded clean and screenshot:)
```bash
chrome-devtools-axi screenshot /tmp/wpd-phase3-trip.png
kill "$(cat /tmp/wpd-http.pid)"
```

- [ ] **Step 3: Full suite + build** — `npm test && npm run build:designer`. Expected: green.

- [ ] **Step 4: Commit**
```bash
git add apps/designer/src/trip.js
git commit -m "feat(designer): trip panel issues semantics-first per-passenger passes"
```

---

### Task 7: Pin `REQUIRED_SEMANTICS` against the validator

Carried-over open item from Phases 1–2: the required set is a seed. Build a real FormState pass and run Apple's `buildpass validate` (the CI gate's authority) to confirm/tighten it.

**Files:**
- Possibly modify: `packages/pass-builder/semantics.js` (`REQUIRED_SEMANTICS`) — only if the validator demands it.

- [ ] **Step 1: Build a pass from the (migrated) full fixture** — `npm run build:pass -- --in fixtures/fully-loaded.json`. Expected: `out/fully-loaded.pkpass` written.

- [ ] **Step 2: Run the Apple validators** — `npm run validate:apple`. If the `buildpass` binary is present it validates structure/semantics; if absent it exits 0 with a skip note (CI is the real gate — `.github/workflows/apple-validate.yml` builds `dev-sample` and runs `buildpass validate` at the pinned SHA).

- [ ] **Step 3: Reconcile the required set.** If `validate` reports a missing/extra required boarding semantic, update `REQUIRED_SEMANTICS` in `packages/pass-builder/semantics.js` to match, then re-run `npm test` (the `semantics-catalog` test asserts `REQUIRED_SEMANTICS` ⊆ catalog and matches the per-entry `required` flag) and `npm run check`. If the validator is unavailable locally, leave the seed and rely on the CI gate on push.

- [ ] **Step 4: Commit (only if the set changed)**
```bash
git add packages/pass-builder/semantics.js
git commit -m "fix(pass-builder): pin REQUIRED_SEMANTICS to the boarding validator"
```

---

### Final: merge

- [ ] `npm test && npm run check && npm run build:designer` — all green.
- [ ] `git checkout main && git merge --ff-only feat/semantics-first-phase3 && git push` (user confirms the merge per phase).
- [ ] Push triggers `.github/workflows/apple-validate.yml` — the real `buildpass validate` gate. Confirm green.

---

## Self-Review

**Spec coverage (§4–5 Designer flow + §"Data model & migration"):**
- New `FormState` = meta/branding/barcode + first-class `semantics` + `displayFields{header,primary,secondary,auxiliary,back}` + carried iOS26 extras — Task 2 (schema), Task 1/2 (migration produces it) ✓
- `formStateToPassJson` rewritten to emit from the new shape (filled-only semantics, boardingPass from displayFields, barcodes, meta passthrough, iOS26 extras) — Task 2 ✓
- `migrateFormState(old)→new`, pure + unit-tested, fixtures migrated in place — Task 1 (impl + shape tests), Task 2 (fixtures + round-trip exactness) ✓
- Migration on read so already-issued FormState passes keep building — Task 3 (build-time + status + list use-sites; deliberately NOT `rowToRec`, with rationale) ✓
- Designer form = Meta/Branding/Assets/Barcode + semantics editor (reuse `renderSemanticsEditor`) + display-fields editor with Suggest (reuse `suggestDisplayValues`) — Task 5 ✓
- Preview unchanged (reads `pass.json`) — confirmed in Architecture; no task needed ✓
- Required-vs-optional pinned via the validator — Task 7 ✓

**Adjacent surfaces the spec implies but doesn't enumerate (found by tracing old-shape readers):** `shiftPassDates` (Task 4), `deriveGroupId` (Task 3), `applyStatus` FormState status path + passenger/seat readouts (Task 3), the Trip panel (Task 6), `scripts/build-pass.js` log line (Task 4), `state.js` seed + persisted migration (Task 5). `field-coverage.mjs` needs no change (reads fixtures through the emitter).

**Placeholder scan:** every code step is complete; the only "if X then change" is Task 7 (validator-driven, inherently conditional) and the dead-code grep in Task 3 Step 7 (verification, with the exact removal named).

**Type consistency:** `migrateFormState`/`legacyFormStateToPassJson` (Task 1) ↔ `formStateToPassJson`/`emitSemantics` (Task 2) agree on the new shape; the `iOS26` bucket keys (`additionalInfoFields, relevantDates, eventGuide, upcomingPassInformation, wifi`) are identical across `migrate.js`, the emitter, the schema, `shift-dates.js`, and `applyStatus`; `displayFields` section keys (`header/primary/secondary/auxiliary/back`) are identical across emitter, schema, `form.js` `SECTIONS`, `shift-dates.js`, and `trip.js`; `DESIGNER_SUGGEST_MAP` target keys (`gate/seat/depart/arrive/passenger/flight/boarding/depart-time/group/seq/ff/terminal-dep/terminal-arr`) match the keys the legacy emitter (hence migration + the seeded default) produces.

## Open items (carry forward)
- **Compact display-field re-sync on live status updates.** `applyStatus` (FormState) updates semantics + STATUS/DELAY rows but not the baked compact gate/time display value (iOS 26 renders the expanded view + Live Activity from semantics). Matches the template path's unbound-semantic behavior. Revisit if the card-face compact field must reflect a live gate change.
- **Client-side required-empty blocking.** Deferred until `REQUIRED_SEMANTICS` is pinned (Task 7); the editor already marks required keys with `*`. Add a build/issue block once the set is confirmed.
- **`gateOpen`** (old Endpoint field) is dropped by migration — it was never emitted to `pass.json`, so no loss.

## Execution
Per the established workflow this phase is executed **inline** (no subagents): TDD per task, per-task commits on `feat/semantics-first-phase3`, `git merge --ff-only` to `main` when green, user confirms each phase merge.

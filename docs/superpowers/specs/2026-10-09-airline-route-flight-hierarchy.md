# Template hierarchy — Airline › Route › Flight

**Status:** direction agreed 2026-10-09 (design discussion in session); not yet planned or implemented.

## Why

Templates are flat: every saved Studio design is a whole pass — look, route, schedule *and* a sample passenger. The deploy box shows the cost: four Philippine Airlines designs (`MNL-TAC`, `PAL`, `PR2987MNL-TAC`, `TAC-MNL`) that are mostly the same pass saved repeatedly, each carrying "Nina Jane Tubigon", seat 42A and a fixed date. Changing PAL's look means editing four files; the latest edit (`PR2987MNL-TAC`, 2026-08-27) also carries Cebu Pacific leftovers (event-guide URLs, `CebPac-WiFi`, fare "GoLite", June dates) copied from the cebpac sample.

## The hierarchy

| Tier | Example | Lives | Owns |
|---|---|---|---|
| **Airline** | Philippine Airlines | Templates shelf (a Studio design **or** a Pass Designer bundle) | colours, images, field layout + labels, barcode format, back-field layout, `eventGuide`, wifi, airline identity (`airlineCode`, organization name) |
| **Route** | PR 2987 MNL → TAC | Templates shelf, under its airline | flight number/code, airports (codes, names, cities, locations), terminals, time zones, duration, **times of day** (boarding 16:05, departure 16:35, arrival 17:55 + day offset) |
| **Flight** | PR 2987 on Oct 12 | Flights board — **already exists** as a `groupId` (`PR2987-2026-10-12`) | date, gate, status, delays; owns the issued passes |
| Passenger | TUBIGON/NINA JANE | issued pass | name, seats, sequence, booking ref, group/zone, fare class, membership/frequent flyer, barcode message |

Rules:

- **A Flight is never saved on the shelf.** Issuing from a Route + a date creates it; it lives on the board where status pushes happen. No new store.
- **Booking ref is a passenger value, not a tier.** One flight carries many bookings; making the booking part of the Flight would split one plane into several board rows and require one push per booking. It stays a per-passenger slot that a party can share (`PER_PASSENGER_DEFAULT` already models this).
- **Routes fill values; they never change layout.** A route that needs a different layout uses an airline *variant* (a second template with the same `airlineCode`, e.g. "Philippine Airlines — International"). Layout changes then always happen in exactly one place.
- **Live inheritance for designs, snapshots for passes.** A route references its airline: recolour the airline and every route follows. Issued passes keep today's snapshot (`rec.state` / `rec.data`) — editing an airline never silently rewrites installed passes.
- **Polarity rule holds.** Route values are keyed by **semantic** (resolved to fields through bindings, exactly as Issue does today); only fields with no bound semantic are keyed by field key.

## Data model

### Airline

No new record. An airline *is* a template — a Studio design (`designs/<name>.json`) or a bundle (`templates/<id>.pkpasstemplate/`) — with route/flight/passenger values stripped. The shelf groups templates by `semantics.airlineCode` (fallback `organizationName`); several templates under one code are variants.

### Persisted bindings for Studio designs (prerequisite)

Today `/api/studio-templates` gets a design's bindings from `discoverBindings(passJson)`, which is **value-driven** — it matches field values against the design's own sample semantics. PAL's field keys (`depart`, `boarding`, `passenger`, …) aren't semantic names, so once an airline design is stripped of its values discovery finds nothing, Issue gets no bound slots, and route values have nowhere to land.

Decision: **persist bindings for Studio designs in `template_bindings`**, the same table and Bindings review screen bundles already use (keyed `studio:<name>` so a design can't collide with a bundle id). `/api/studio-templates` reads persisted bindings first and falls back to discovery for designs that have none (new, unconverted designs keep working). Saving a design from Design never overwrites persisted bindings; Studio cards gain the **Bindings** action. Conversion records the bindings discovered from the *full* source design before stripping it (plus the time-field bindings created by its review step, below).

Rejected alternative: tokens in field values (`{departureAirportCode}` as the value *is* the binding). It unifies binding and labels, but needs a new authoring syntax across Design/form.js and a second binding mechanism alongside bundles'.

An airline design's own preview (Design, shelf thumbnail) has blank values; it renders with its first route's values merged when one exists, else with labels only.

### Route — new, `routes/<id>.json` (gitignored user data, like `designs/`)

```json
{
  "id": "PR2987-MNL-TAC",
  "template": { "kind": "studio", "id": "philippine-airlines" },
  "values": {
    "flightNumber": 2987,
    "departureAirportCode": "MNL", "departureAirportName": "Ninoy Aquino Intl", "departureCityName": "Manila",
    "destinationAirportCode": "TAC", "destinationAirportName": "D Z Romualdez", "destinationCityName": "Tacloban",
    "departureTerminal": "2",
    "departureAirportTimeZone": "Asia/Manila", "destinationAirportTimeZone": "Asia/Manila",
    "departureLocation": { "latitude": 14.5086, "longitude": 121.0194 },
    "destinationLocation": { "latitude": 11.2267, "longitude": 125.0261 },
    "duration": 4800
  },
  "schedule": { "boarding": "16:05", "departure": "16:35", "arrival": "17:55", "arrivalDayOffset": 0 },
  "fields": { "terminal-arr": "" }
}
```

- `values` — semantic → value, the same value shapes the Issue slots use. Date/zone twins are written once and expanded at issue (both `*LocationTimeZone` and `*AirportTimeZone`, as today).
- `schedule` — local times of day in the departure/arrival airport zones. Issue composes them with the chosen date into the six ISO schedule semantics.
- `fields` — raw values for template fields with no bound semantic, by field key.
- `template` — `{kind: "studio"|"designer", id}`. Deleting a template 409s while a route references it (mirrors the bundle/pass rule).

### Passes

Add `route_id TEXT` to `passes` (same pattern as `design_name`). Issue bodies carry an optional `routeId` envelope on both shapes (validated against `routes/`). The shelf counts passes per route; the board can show the route.

## Emit-layer changes (useful on their own; phase 1)

### Label tokens

Field labels may contain `{semanticKey}` or `{semanticKey:upper}` tokens, resolved in `formStateToPassJson` from the pass's semantics (so the preview, issue, and rebuild-at-fetch all agree). Only known semantic keys are replaced; other braces stay literal. A missing value resolves to empty and runs of whitespace collapse. Example — PAL's primary field label becomes `{departureCityName:upper} {departureAirportName:upper}`, so TAC→MNL shows "TACLOBAN D Z ROMUALDEZ" on the left without its own layout.

Scope v1: Studio designs. Bundle labels stay as exported (bundles on disk stay faithful); revisit if a real bundle needs it.

### Times come from the schedule, not typed text

Today `PR2987MNL-TAC`'s BOARDING/DEPART fields hold the literal strings "16:05"/"16:35", disconnected from `originalBoardingDate`. Under the hierarchy a route-time change would leave stale text. Time fields bind to the schedule semantics and get their text from the date:

In both modes the field is **bound** (persisted binding to e.g. `currentBoardingDate`) and its stored value is the ISO date with the airport's offset (`2026-10-12T16:05:00+08:00`) — which is what Issue (`passengerFieldValues`, date kind) and status updates already write into bound date fields.

- **Device format (default):** ISO value + `timeStyle` — Wallet formats it in the phone's locale (12 h or 24 h per the phone's setting) and handles time zones.
- **Fixed 24 h:** new optional field property `timeFormat: "24h"`. `formStateToPassJson` emits `HH:mm` read from the ISO string's own local time (its offset is the airport's), and no `timeStyle`. Because passes rebuild at fetch, a status change to `currentBoardingDate` re-renders the text. A test pins status update → rebuilt text.

Schema: `fieldList` items gain optional `timeFormat` (enum `["24h"]`) — `additionalProperties: false` there, so this is an explicit schema change. `migrate.js` is untouched (new property, new designs only). The airline picks per time field; PAL's current look is fixed 24 h.

## Issue flow

- **From a route** (primary path): the Flight step asks for the **date** and gate; route values pre-fill every shared slot as a new layer — *typed → derived → route → template default*. Schedule semantics come from `route.schedule` + date + zones. Everything route-owned sits behind "Change for this flight" (it doesn't edit the route). `composeGroupId` is unchanged.
- **From an airline** (as today): plus **Save as route** on the Flight step, writing `routes/` from the shared slot values (volatile semantics and per-passenger slots excluded by construction).
- Per-passenger slots and volatile-placeholder clearing are unchanged — a route can never ship a passenger.

## Shelf

```
Philippine Airlines        (studio)      [Edit airline] [+ Route]
  ├─ PR 2987  MNL → TAC  16:35  · 12 issued     [Edit] [Issue →]
  └─ PR 2988  TAC → MNL  18:30                  [Edit] [Issue →]
Cebu Pacific  (Pass Designer)            [Bindings]     [+ Route]
  └─ 5J 5056  MNL → NRT  06:40                  [Edit] [Issue →]
```

Airline cards keep the Apple-faithful thumbnail; route rows render the same preview with route values merged. **Route editor** = the Issue workspace's Flight step (slots from `templateSlots(tpl)`, the same widgets and validation) in a "route" mode: no date, schedule as times of day, Save route instead of Next. Not Design — Design edits a FormState's semantics, a route is a value map over a template's bindings, and one slot UI is enough. "Edit airline" jumps to Design/Bindings for the parent. Templates without routes still issue directly (no forced migration).

## Converting existing designs ("Make airline from this design")

A one-time action on any Studio design card. It **creates** new files and never modifies or deletes the source.

1. **Classify** every value by semantic into a tier (table below). Unbound fields, `iOS26` extras, and back fields go to a review list with a suggested tier.
2. **Review screen** — each item: value · suggested tier · Keep / Move / Drop. Every `iOS26` extra (`additionalInfoFields`, `eventGuide`, `wifi`, `upcomingPassInformation`) and every back field always appears in the list — no silent carry-over. Flags:
   - URL hosts and wifi SSIDs that don't contain the design's airline code or organization name (catches `cebupacificair.com`, `CebPac-WiFi`). Free-text leftovers like fare "GoLite" are not detectable without an airline registry — they surface because they're in the list, suggested as passenger-tier;
   - labels that contain route data (primary-field labels that aren't generic words) → offer label tokens;
   - typed time text that matches a schedule semantic's time of day ("16:05" ↔ `currentBoardingDate` 16:05) → convert to a bound time field (device or fixed 24 h, defaulting to what the text looked like) and record that binding.
3. **Commit** writes the airline design (new name), its persisted bindings, and, if route values exist, a route. The source stays until the operator deletes it.

| Tier | Semantics / parts |
|---|---|
| Airline | `airlineCode`, `organizationName`, branding, layout + labels, barcode format, `eventGuide`, `wifi` |
| Route | `flightNumber`, `flightCode`, airport codes/names/cities/location descriptions, `departure/destinationLocation`, terminals, time zones, `duration`, schedule times of day |
| Flight (dropped) | the six schedule dates, gates, status, `relevantDates`, `upcomingPassInformation` |
| Passenger (dropped) | `passengerName`, `seats`, `boardingSequenceNumber`, `confirmationNumber`, `boardingGroup`, `boardingZone`, `ticketFareClass`, `membershipProgramNumber`, barcode message |

Expected result on the box: `PR2987MNL-TAC` → airline **Philippine Airlines** (its look + layout, fixed-24 h times, token labels) + route **PR 2987 MNL→TAC**; `TAC-MNL` → a route under the same airline (route values only); `MNL-TAC` and `PAL` contribute nothing new and can be deleted; `BR262-001` → airline **EVA Air** + route **BR 262**.

## Phases

1. **Bindings + emit layer** — persisted Studio bindings (`studio:<name>` in `template_bindings`, Bindings action on Studio cards, discovery fallback); label tokens; `timeFormat: "24h"`; schema + tests (preview and rebuild agree; status updates re-render time text).
2. **Routes store** — `routes/` CRUD API (control plane, guard unchanged), `passes.route_id`, `routeId` on issue bodies, template-delete 409 on referenced routes.
3. **Shelf + Issue** — grouped shelf, route rows, route editor, Issue-from-route (date + gate), Save as route.
4. **Convert** — Make airline from this design with the review screen; run on the box's PAL/EVA designs.
5. *(later)* **Optional fields** — airline fields marked optional are omitted when blank, so small route additions ("Terminal note") don't need a variant. Today a blank field still emits an empty label.

## Open questions

- Airline display name for bundles whose `organizationName` is generic (`cebpac` says "Airline"): a small per-airline-code name record, or read it from the first studio template with that code?
- Overnight routes: `arrivalDayOffset` covers +1; is anything beyond that needed?
- Should a route ever be shared between variants of the same airline (e.g. switch a route from "PAL" to "PAL — International" without re-entering values)? The value map makes this a re-parent operation; worth a button?

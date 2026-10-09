# Minimum + Expand: Apple's boarding tags, airline services links

> Steps use checkbox (`- [ ]`) syntax. Test-first per task; `npm test` green after each.

**Source:** Apple's [Creating an airline boarding pass using semantic tags](https://developer.apple.com/documentation/walletpasses/creating-an-airline-boarding-pass-using-semantic-tags.md) (read 2026-10-10), the SemanticTags + Pass references, and the pinned `apple/pass-builder` protos (`docs/field-coverage.md`).

**Decided (user, 2026-10-10):** every form shows the **minimum** — Apple's 12 required tags (the pass falls back to the legacy style without any of them) plus whatever the template already binds or bakes — and an **+ Add field** picker adds any other boarding tag on demand. The airline gets an **+ Add link** picker for the boarding-pass services page. Applies everywhere: Issue Flight step, route editor, Design.

**Invariant kept:** `liveDataConfiguration.excludedSemantics: ["departureGate"]` so pushed gates win over Apple's live flight data (which otherwise blanks the gate until the airline's feed reports one). Today only FormState passes get it — bundle passes must too.

## Findings that shape the work

1. Issue treats only the validator's 9 tags as required; Apple's doc requires 12 (adds `departureCityName`, `destinationCityName`, `destinationLocationTimeZone`). A pass missing them silently drops to the legacy style while Issue says "Flight is complete".
2. Time zones accept any text; Apple requires IANA names.
3. Doc vs proto spellings differ for: `departure/destinationLocationSecurityPrograms` (doc) ↔ `departure/destinationAirportSecurityPrograms` (proto); `passengerAirlineSSRs`/`passengerInformationSSRs`/`passengerServiceSSRs` (doc) ↔ `…Ssrs` (proto); `loungePlaceIDs` (doc, array) ↔ `airlineLoungePlaceId` (proto). Emit both, like `*LocationTimeZone`/`*AirportTimeZone`.
4. Missing tags: `membershipProgramStatus`, the three SSR arrays (Wallet badges: `INFT`; `PETC SVAN UMNR WCBD WCBW WCHC WCHR WCHS WCLB WCMP WCOB`), `loungePlaceIDs`.
5. Our `iOS26.eventGuide` links (bag policy, parking, transfer, transit, directions) are **poster-event-ticket only** per Apple's Pass reference; boarding passes use top-level services keys: `managementURL changeSeatURL upgradeURL purchaseWifiURL purchaseAdditionalBaggageURL purchaseLoungeAccessURL entertainmentURL orderFoodURL trackBagsURL reportLostBagURL requestWheelchairURL registerServiceAnimalURL transitProviderWebsiteURL transitProviderEmail transitProviderPhoneNumber`.

## Tasks

### 1. Gate exclusion on bundle passes
`buildPkpassFromTemplate`: merge `excludedSemantics` ∋ `departureGate` into the emitted pass (keep any the bundle lists). Test both paths emit it.

### 2. Catalog
- `REQUIRED_FOR_SEMANTIC_VIEW` = Apple's 12 (time zones in the `*AirportTimeZone` slot spelling); Issue's `REQUIRED` uses it. (`REQUIRED_SEMANTICS` stays pinned to the validator for CI.)
- Add `membershipProgramStatus` (text), `passengerAirlineSSRs`, `passengerInformationSSRs`, `passengerServiceSSRs`, `loungePlaceIDs` (string arrays; SSRs with Apple's codes as options).
- Rename the security-program catalog keys to the doc spelling; `SEMANTIC_KEY_ALIASES` mirrors doc ↔ proto spellings at emit (generalising `TIMEZONE_KEY_ALIASES`), so old designs keep working.
- Passenger-group tags start per passenger in Issue.

### 3. IANA time-zone validation
`validateFieldValue` kind `timezone` (semantic kind for the four zone keys): must be a zone `Intl` knows. Issue, Design and server share it.

### 4. Issue + route editor: minimum + Add field
- `templateSlots(tpl, {extra})`: core = Apple's 12 + flight code + passenger core; template-bound and baked tags as today; `extra` adds slots on demand.
- Flight step: "+ Add an Apple field…" select (grouped; route mode lists route-level tags only); gate/terminal no longer forced into the core (they appear when bound — PAL now binds them — or when added).
- Route values carrying a tag outside the minimum add its slot (already the case via `routeSlots`). A route's raw field whose key a template now binds to a tag fills that tag (fixes PAR412's `terminal-arr`).

### 5. Airline services links
- FormState `services: {managementURL, …}` (schema) → top-level pass.json keys; Design → Advanced "Services page" card with "+ Add link"; conversion keeps them on the airline. `eventGuide` stays readable (back-compat) but the editor only offers it for… nothing on a boarding pass — shown read-only with a "event tickets only" note when present.

### 6. Data, docs, deploy
Fix the box route `PR412-MNL-KIX` (`fields.terminal-arr` → `values.destinationTerminal`), AGENTS/HANDOFF, browser check, deploy.

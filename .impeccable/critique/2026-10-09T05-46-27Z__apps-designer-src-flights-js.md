---
target: Studio-dark overhaul phases 1-2 (Flights, Templates, Bindings, log) + Phase 3 guidance
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
target_identity: "file:/Users/angelo/Documents/fun-stuff/wallet-designer/apps/designer/src/flights.js"
target_fingerprint: "sha256:6bba398023f7e0d8b58f1c6f64c1253f73d1360269269b00b2cfd65431147a40"
target_path: /Users/angelo/Documents/fun-stuff/wallet-designer/apps/designer/src/flights.js
timestamp: 2026-10-09T05-46-27Z
slug: apps-designer-src-flights-js
---
# Critique — Studio-dark overhaul, phases 1–2 (Flights, Templates, Bindings, Device log) + Phase 3 guidance

Method: dual-agent. Overlay blocked by the app CSP (default-src 'self'); fallback DOM measurement used.

## Design Health Score — 24/40

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Push outcome is 11px mono text, no live region/button state/toast; cert badge pings green for a dev cert. |
| 2 | Match system / real world | 3 | Never-pushed pass reads ON TIME (fabricated). |
| 3 | User control and freedom | 2 | Native confirm() everywhere; Clear status pushes live with no confirm/undo. |
| 4 | Consistency and standards | 2 | Two blue primaries on Flights, 1+N on Templates; 5 nav tabs vs spec's 3; no aria-current. |
| 5 | Error prevention | 2 | Trip editor shows placeholder B9 instead of live gate. |
| 6 | Recognition over recall | 2 | Trip editor never restates live values. |
| 7 | Flexibility and efficiency | 2 | 9 date controls before Push; per-pass push behind a details per passenger. |
| 8 | Aesthetic and minimalist | 3 | Board excellent; panel shows 11 fields for a one-field change. |
| 9 | Error recovery | 3 | Inline blur errors correct and specific. |
| 10 | Help and documentation | 3 | Good micro-docs; studio card note is a dead end. |

## Design specificity
Flights: authored for the domain (mono flap flight numbers, amber gates, boards subline, severity-folded flap pills, live clock, on-device bar). Bindings: domain-specific. Templates: thumbnails carry it, chrome is generic SaaS. Device log: generic and under-scoped vs spec (errors only).
Detector: 8 findings — error: infinite ping on #profile-badge::before; warnings: white on #0a84ff 3.6:1 (3.1:1 hover) on every primary, 10px Design preview tabs, Inter (spec-mandated, deliberate), all-caps header row (false positive).
Browser fallback: 18 date/time + 9 offset inputs unnamed; 12 Bindings selects unlabeled; light contrast 1.98–2.4:1 on pills/serials/hints/badge; 10px board headers + status keys; 15px text-link targets; invisible focus on selected row. False positives: hidden Clear status inside closed details; 8–9px Wallet-thumbnail text (pass artwork).

## Priority issues
- [P0] Trip-wide editor hides live values and fabricates defaults (no `current` passed to editorHtml("grp"); pillHtml defaults "On Time"). Fix: trip-level current in flightsFrom; "Not pushed" pill state; drop implicit On Time. → /impeccable harden
- [P0] Mobile Flights non-functional (masthead clips, status keys collide, row tap doesn't scroll panel, Bindings table truncates). Fix: scrollable/3-item masthead <760px; scroll panel into view / bottom sheet <1080px; keys wrap; Bindings rows → cards. → /impeccable adapt
- [P1] Accessibility floor: unnamed picker inputs, unlabeled bind selects, 2.0–2.8:1 contrast on --faint and pill-on-soft pairs, 10px functional text, invisible row focus, keys without aria-pressed, perpetual badge ping. → /impeccable audit
- [P1] Push feedback + destructive confirms below the stakes: button states + aria-live + toast; Clear status quiet + confirmed; delete confirm in flight terms; Delete flight into More. → /impeccable clarify, /impeccable animate
- [P1] Bindings cries wolf: all 16 dev-sample rows amber incl. key-identical pairs; Confirm flips all to manual. Fix: confidenceLabel treats stem-matching value/name matches as matched; amber only for date-proximity, seat-composite, unrelated keys; badge counts from that; date samples in display format. → /impeccable clarify

## Before Phase 3 (Issue workspace)
Multi-line BCBP paste (one per line); keep shared vs per-passenger (individualKeys) with right-pane rows flipping a field; replace end-of-flow serial confirm() with inline "will update …-001" + honest CTA "Issue 1 · update 1"; Issued screen uses appleWalletButton verbatim, grid layout, Copy all links first, lazy QR, real "Open flight" hop that selects the trip; readiness in footer instead of pre-touch disabled Issue.

## Persona red flags
Alex (gate agent): B9 placeholder; "—" key first/widest; 9 date controls push primary below fold; "Push to 0 devices"; silent result.
Sam (phone): masthead clips; row tap no visible result; keys collide; Delete 14px from Wallet badge; ~1400px panel.
Taylor (keyboard/SR): no aria-current; invisible row focus; keys announce nothing; 12 unlabeled selects; --faint at 2.2–2.8:1; two perpetual animations.

## Minor observations
Templates one-primary rule (New design + Issue per card; studio cards need disabled quiet Issue); no hashchange listener; Departs subline truncates boarding time; clock/board times show no zone; Delete flight wraps; Bindings preview static; duplicate affordances for Bindings/New design; badge says dev cert not APNs state; .btn:hover shadow in light theme.

## Questions
Status row as the whole editor with "Change schedule…" behind it? Primary for 0-on-device flights = Share links? Bindings as a two-row interstitial inside Issue?

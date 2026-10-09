---
target: Issue + Design workspaces
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/angelo/Documents/fun-stuff/wallet-designer/apps/designer/src/issue/index.js"
target_fingerprint: "sha256:cee824de06504a01f2f78f67b925e1fcb55bcc899d05b777087bdcbd160ff9ac"
target_path: /Users/angelo/Documents/fun-stuff/wallet-designer/apps/designer/src/issue/index.js
timestamp: 2026-10-09T06-58-23Z
slug: apps-designer-src-issue-index-js
---
Method: dual-agent (A: design review · B: detector + browser) — 2026-10-09, Issue + Design workspaces (UI overhaul phases 3–4)

## Design Health Score — 27/40
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | "flight: N to fix" named no fields (fixed: "Fix flight: … →") |
| 2 | Match system / real world | 3 | jargon leaks: BCBP parse error, "Apple set", raw keys in Design's right pane |
| 3 | User control and freedom | 3 | no review step before issuing (deliberate: inline warning + honest CTA) |
| 4 | Consistency and standards | 2 | Design Fields show raw ISO text; name lived in the footer (fixed) |
| 5 | Error prevention | 3 | update of an existing pass has no confirm (by decision) |
| 6 | Recognition vs recall | 3 | serial/trip-id dependency on Flight only visible as empty field (fixed: "needs flight") |
| 7 | Flexibility and efficiency | 3 | no "apply to all passengers", no shortcuts |
| 8 | Aesthetic and minimalist | 2 | long Flight form; field list shown three times in Design |
| 9 | Error recovery | 3 | paste errors didn't say what's wrong (fixed) |
| 10 | Help and documentation | 2 | Share vs Vary, serials, "Apple set" unexplained |

## Detector
CLI: 1 finding — overused-font (Inter) in index.html: deliberate, documented. Browser overlay blocked by the CSP (default-src 'self') on all views — expected, not worked around.

## Priority issues
- [P1] No pre-issue confirmation — kept by decision (inline warning + "Issue 1 · update 1").
- [P1] Flight blocker a dead end — FIXED (footer fix link, "needs flight").
- [P2] Dense Flight form, default-vs-value ambiguity — partly FIXED (defaults in placeholders + one note); open: collapse "Also on this pass" / time zones.
- [P2] Pass scrolls away while editing — FIXED (sticky canvas).
- [P2] Design inconsistent/noisy — partly FIXED (name in bar, Start over quiet, Fields headers); open: typed date pickers in Fields, slimmer right pane.

## Open questions
- Footer as a departures-board "gate strip" doubling as the commit summary?
- Flight values as read-only chips with Edit for template defaults?
- Design right pane only the iOS 26 blockers?

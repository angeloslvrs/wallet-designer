# Audit Remediation Plan — 2026-07-04

Source: security + code-quality audit of the frontend and backend (four parallel
reviewers, all top findings verified against the code by the orchestrator).
`npm audit` clean; SQL/path-traversal/XSS/auth-boundary/pass-identity invariants
all verified sound. This plan covers only the confirmed defects.

## Orchestration model

- **Orchestrator: Fable (interactive).** Fable owns sequencing, dispatch,
  verification, and the final review pass. Fable does small edits inline rather
  than dispatching a subagent for a one-line change.
- **Default executor: Opus 4.8 subagents at calibrated effort** (low /
  medium / high). Every task below names the intended executor and effort.
- **Fable subagents: sparingly, only where flagged.** Reserved for tasks whose
  *reasoning* is the hard part — subtle async/concurrency correctness or
  cross-module lifecycle invariants — not merely tasks that touch many files.
  A task is escalated to Fable only if flagged `Fable-if-needed` **and** Opus's
  high-effort attempt fails verification.
- **Verification gate per task:** `npm test` + `npm run check` stay green, plus
  the task-specific check noted. Batches land behind these gates before the next
  phase starts.

Effort key: **L** = mechanical, well-scoped. **M** = multi-file or needs a
small design choice. **H** = subtle correctness reasoning required.

---

## Phase 1 — Stop the bleeding (Critical + High, mostly mechanical)

Land these first; they close the outage and DoS surfaces. All are low-risk,
high-confidence edits.

### T1 — `[CRITICAL]` Async handler crash guard
- **Finding:** Express 4.19 does not auto-catch async rejections; no error
  middleware, no `unhandledRejection` handler. One corrupt DB row → whole-process
  outage on the next `GET /api/passes`.
- **Files:** `apps/server/src/routes/{admin,wallet,templates}.js`,
  `apps/server/src/index.js`.
- **Fix:** add a tiny `asyncHandler(fn)` wrapper; apply to every async route.
  Register a final Express error-handling middleware that logs the real error and
  returns a generic body (no stack, no path). Add `process.on("unhandledRejection")`
  log-and-continue as a backstop.
- **Executor:** Opus 4.8 · **M** (mechanical but broad; error middleware must not
  leak internals).
- **Check:** add a test that a handler throwing/rejecting yields a 500 and the
  process survives (simulate a corrupt `state_json` row).

### T2 — `[HIGH]` Zip-bomb pre-inflation guard
- **Finding:** `entry.getData()` inflates fully before the size check → OOM from a
  small crafted upload.
- **File:** `packages/pass-builder/template-zip.js:54-63`.
- **Fix:** check `entry.header.size` (declared uncompressed) against a per-entry
  cap **before** `getData()`; also sum declared sizes across entries and reject
  before decompressing any. Keep the existing post-inflate `total` check as a
  belt-and-suspenders.
- **Executor:** Opus 4.8 · **L**.
- **Check:** unit test with a fixture whose declared size exceeds the cap → throws
  before allocation; a normal template still loads.

### T3 — `[HIGH]` Cap device registrations + validate pushToken
- **Finding:** `registrations` has no row cap (unlike `device_log`); `pushToken`
  only truthiness-checked, stored verbatim; public surface.
- **Files:** `apps/server/src/routes/wallet.js:24-38`,
  `apps/server/src/storage.js:404`.
- **Fix:** validate `pushToken` as APNs-shaped (64 hex chars) and bound
  `deviceLibraryIdentifier` length → 400 on violation. Cap registrations per serial
  (small N) in `registerDevice`.
- **Executor:** Opus 4.8 · **M** (needs the per-serial cap policy decided —
  suggest reuse/evict-oldest vs reject).
- **Check:** test that a malformed pushToken → 400; that the Nth+1 registration for
  a serial is bounded.

### T4 — `[HIGH]` Manage delete/edit fetch error handling
- **Finding:** edit/del/grp-del handlers have no try/catch and don't check `r.ok`;
  failures are silent, a failed delete looks like success.
- **File:** `apps/designer/src/manage.js:308-334`.
- **Fix:** wrap in try/catch mirroring `pushOne`/`pushGroup`, check `r.ok`, surface
  via `setStatus`/inline message; only `load()` on success.
- **Executor:** Opus 4.8 · **L**.
- **Check:** manual/dom test — offline delete shows an error, not a silent no-op.

### T5 — `[MED]` Public error-message leak
- **Finding:** `GET /v1/passes` returns raw `err.message` to the internet.
- **File:** `apps/server/src/routes/wallet.js:83`.
- **Fix:** log server-side, return generic `{ error: "build failed" }`. Folds into
  T1's error-middleware pattern.
- **Executor:** Opus 4.8 · **L** (do together with T1).

---

## Phase 2 — APNs connection lifecycle (subtle; failure-prone, untested)

These three are interrelated resource/concurrency bugs in the same module with
zero existing test coverage. Do them as one unit and add a fake-`http2` test.

### T6 — `[MED]` `connect()` rejection cached forever
- **Finding:** if cert `readFile` rejects, `clientPromise` is never reset → push
  permanently dead until restart.
- **File:** `apps/server/src/apns.js:29-46`.
- **Fix:** on rejection inside `connect()`/`getClient()`, reset `clientPromise = null`
  before propagating so the next attempt reconnects.

### T7 — `[MED]` `forceNewClient` leaks the old session
- **Finding:** drops the reference without `session.destroy()`; the orphan's
  close/error handlers later null the *new* `clientPromise`; socket leak under
  repeated GOAWAYs.
- **File:** `apps/server/src/apns.js:73-76`.
- **Fix:** capture and `destroy()` the previous session (guard the handlers so an
  orphan can't clobber the current promise — e.g. compare identity before nulling).

### T8 — `[MED]` `sendOne` has no per-request timeout
- **Finding:** a stalled stream hangs `Promise.all` in `deliver()`, blocking the
  whole status-update response.
- **File:** `apps/server/src/apns.js:79-101`.
- **Fix:** per-stream timeout that resolves as a `transportError` and closes the
  stream.

- **Executor:** Opus 4.8 · **H** for T6–T8 as a batch (the handler-identity guard
  in T7 is the tricky part). **Fable-if-needed** — escalate only if Opus's
  high-effort pass can't get the orphan-session guard provably correct.
- **Check:** new `tests/apns-lifecycle.test.js` with an injected fake http2:
  cert-read failure recovers on next call; a forced reconnect destroys the old
  session and the orphan's late `close` does not null the live promise; a stalled
  request times out.

---

## Phase 3 — Concurrency & atomicity (design-sensitive)

### T9 — `[HIGH]` Stale-mount race wipes in-progress input
- **Finding:** `load()` fetches aren't tied to `root._mountAbort`; a late resolve
  re-renders with stale closure state, blanking user edits.
- **Files:** `apps/designer/src/issue.js`, `apps/designer/src/manage.js`.
- **Fix:** pass `{ signal }` to the `load()`/`loadLog()` fetches and/or guard every
  post-`await` DOM write with `if (signal.aborted) return;`.
- **Executor:** Opus 4.8 · **H** (must trace every async chain in both views; easy
  to miss one). **Fable-if-needed.**
- **Check:** throttled-network repro no longer resets a filled form on
  Issue→Manage→Issue.

### T10 — `[MED]` Non-atomic template re-upload
- **Finding:** deletes the working bundle before writing the replacement; a
  mid-write failure bricks every already-issued pass.
- **File:** `apps/server/src/routes/templates.js:60-75`.
- **Fix:** write to a temp dir, validate with `loadTemplate`, then atomically
  `rm` old + `rename` temp → final.
- **Executor:** Opus 4.8 · **M**.
- **Check:** test that a write failure leaves the previous bundle intact.

### T11 — `[MED]` Group-status partial-apply, no rollback
- **Finding:** a mid-loop throw leaves a trip half-updated and half-pushed with a
  bare 500.
- **File:** `apps/server/src/routes/admin.js:340-359`.
- **Fix:** per-member try/catch (or `Promise.allSettled`), return
  `{ results, errors }` so the caller sees which passes updated.
- **Executor:** Opus 4.8 · **M** (small response-shape design choice).
- **Check:** test that one failing member doesn't abort the rest and the response
  reports it.

### T12 — `[MED]` Check-then-act race on the `created` flag
- **Finding:** concurrent double-submit of a new serial reports `created:true`
  twice, defeating the anti-clobber signal.
- **Files:** `apps/server/src/routes/admin.js:221,434`, `storage.js`.
- **Fix:** derive `created` from an `INSERT … ON CONFLICT` in the write helper;
  return whether the row pre-existed.
- **Executor:** Opus 4.8 · **M**.

---

## Phase 4 — Hardening & polish (Low; batch together)

One Opus 4.8 · **L** subagent can take this whole batch.

- **T13** Branding image: validate/decode before `setPath`, add `reader.onerror`
  with a visible message — `apps/designer/src/form.js:128-143`.
- **T14** Copy-link: await `writeText`, report real success/failure, fall back for
  no-Clipboard-API — `apps/designer/src/issue.js:916`.
- **T15** `deepMerge`: skip `__proto__`/`constructor`/`prototype` keys —
  `packages/pass-builder/template.js:179`.
- **T16** `saveDesign()`: wrap fetch in try/catch — `apps/designer/src/main.js:56`.
- **T17** Add a `default-src 'self'` CSP meta tag — `apps/designer/index.html`.
- **T18** `[Deploy/defense-in-depth]` Bind Express to `127.0.0.1` in prod (or set
  an explicit trusted-proxy CIDR) so a spoofed `X-Forwarded-For` can't bypass
  Basic Auth — `apps/server/src/index.js`, `docs/deploy.md`. **Orchestrator
  decision, not a subagent** (depends on the nginx-same-host assumption; confirm
  before changing bind address).

---

## Suggested execution order

1. **Phase 1** as one batch (T1+T5 together, then T2, T3, T4) → gate.
2. **Phase 2** (T6–T8 + tests) → gate.
3. **Phase 3** tasks individually (T9 is the riskiest; T10–T12 independent) → gate.
4. **Phase 4** as one batch → gate.

Fable runs the final cross-cutting review after each phase. Fable subagents are
expected only at T7/T8 or T9, and only if Opus high-effort verification fails.

## Explicitly out of scope (verified clean — do not touch)
SQL parameterization, path-traversal guards, `esc.js`/XSS discipline, the
public/control-plane auth boundary, server-forced pass identity, per-serial token
stability, timing-safe comparisons, `migrate.js` (frozen), CORS absence,
`associatedStoreIdentifiers` absence.

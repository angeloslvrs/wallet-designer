# Plan: Project Health Review & Cleanup — 2026-07-02

**Source**: Inline inspection of working tree at `fb679ea` (+ uncommitted changes)
**Complexity**: Small
**Verified locally**: `npm test` (56 files, 381 tests, all pass under Vitest 4), `npm run check` (all fixtures OK), `npm run build:designer` (Vite 8/rolldown, builds in ~400ms), `npm audit` (0 vulnerabilities)

## Summary of Current Status

The project is in good shape. All five findings from yesterday's review (`findings.md`, 2026-07-01)
have already been fixed by the last five commits:

| findings.md item | Resolved by |
|---|---|
| P2 serial-only pass identity | `a4bc0ab` + `4ed257c` (serial passType guard) |
| P2 registration always 201 | `4ed257c` (201 new / 200 existing) |
| P2 no Node CI gate | `f8df5a2` (`.github/workflows/node-ci.yml`) |
| P3 permissive schema | `003ce93` (strict nested objects, semantic-key warnings) |
| P3 eager 1.4 MB bundle | `655e9d8` (code-split views, lazy bwip-js/@zxing) |

**What is actually in flight right now**: an uncommitted dependency upgrade — Vite 5 → 8.1.2
(rolldown-based) and Vitest 1 → 4.1.9 — touching `package.json`, `apps/designer/package.json`,
and `package-lock.json`. Tests, fixture checks, and the production build are all green under the
new versions, but the upgrade has three loose ends (Tasks 1–3) that should be fixed before committing.

## Findings & Recommendations

### F1 (fix before commit) — `vite` landed in root **production** `dependencies`

`package.json:33-36` now pins `"vite": "8.1.2"` under `dependencies`. This violates a documented
deploy invariant (CLAUDE.md: *"the box runs prod deps only (no Vite)"*) — a production
`npm ci --omit=dev` on the deploy box would now install Vite and its rolldown native binaries
for nothing. Vite is already correctly declared as `^8.1.2` in `apps/designer/package.json`
devDependencies, and `scripts/dev.js:19` invokes it via `npx vite` from `apps/designer`, so the
root entry is unnecessary.

### F2 (fix before commit) — stale `allowScripts` entry for removed package

`package.json:37-41` allowlists `esbuild@0.21.5`, but esbuild left the tree with the Vite 8
upgrade (rolldown replaces it): `npm ls esbuild` → `(empty)`. Also, npm warns on every run:
`.npmrc allow-scripts setting is being ignored because package.json declares its own allowScripts
field` — the two config sources should be reconciled (keep the `package.json` field, drop the
stale entry; verify `.npmrc` isn't needed).

### F3 (housekeeping) — `findings.md` is untracked and now fully resolved

Every item in it is fixed. Either delete it or move it to `docs/reviews/2026-07-01-findings.md`
and commit, so the repo root stays clean and the review is preserved as a record.

### F4 (minor) — workspace dependency drift: two dotenv majors

Root depends on `dotenv@^17.4.2` while `apps/server` resolves `dotenv@16.6.1`
(`apps/server/node_modules/dotenv`). One project, two majors of the same lib. Align
`apps/server` to `^17.4.2` (v17 is backward-compatible for `config()` usage).

### F5 (optional, risk-ranked) — remaining outdated majors

`npm audit` is clean, so none of these are urgent. If pursued, do each as its own commit with
the full validation suite:

| Package | Current → Latest | Risk / note |
|---|---|---|
| `@zxing/browser` | 0.1.5 → 0.2.0 | Low; lazy-loaded scanner only. Test Issue-view scan flow manually. |
| `ajv-formats` | 2.1.1 → 3.0.1 | Low; schema validation covered by `npm run check` + tests. |
| `concurrently` | 8.2.2 → 10.0.3 | Low; dev-only (`scripts/dev.js` orchestration). |
| `sharp` | 0.33.5 → 0.35.3 | Low; dev-only (`npm run init` asset generation). Update `allowScripts` pin to match. |
| `archiver` | 7.0.1 → 8.0.0 | Medium; core `.pkpass` zip path — manifest/sign tests cover it, also build + install a real pass. |
| `express` | 4.22.2 → 5.2.1 | **High; defer.** Express 5 changes routing/middleware semantics; the guard middleware + `trust proxy` security boundary would need careful re-verification. Not worth it now. |

### F6 (informational, no action) — expected build warning & test noise

- The Vite 8 "chunks larger than 500 kB" warning refers to `bwip-js` (931 kB) and `zxing`
  (436 kB) chunks that are already lazy-loaded — the split is working as designed. Optionally set
  `build.chunkSizeWarningLimit: 1000` in `apps/designer/vite.config.js` to silence it.
- Vitest 4 on Node 26 prints `ExperimentalWarning: localStorage is not available` per worker —
  cosmetic; ignorable.

## Tasks

### Task 1: Remove `vite` from root production dependencies
- **Action**: Delete `"vite": "8.1.2"` from `dependencies` in root `package.json` (leave `dotenv`). Run `npm install` to regenerate the lockfile, confirm `apps/designer` still resolves vite ^8.1.2 via its own devDependency.
- **Validate**: `npm run dev` starts both processes; `npm run build:designer` succeeds; `npm ls vite` shows it only under the designer workspace.

### Task 2: Clean up `allowScripts` / `.npmrc` conflict
- **Action**: Remove the `esbuild@0.21.5` entry from `allowScripts`. Check `.npmrc` for an `allow-scripts` line and remove/align it so the npm warning disappears. Keep `fsevents` and `sharp` entries (still in tree).
- **Validate**: `npm install` runs without the allow-scripts warning; `npm test` passes.

### Task 3: Commit the Vite 8 / Vitest 4 upgrade
- **Action**: Commit `package.json`, `apps/designer/package.json`, `package-lock.json` as e.g. `build(deps): upgrade vite 5→8 (rolldown) and vitest 1→4`.
- **Mirror**: conventional-commit style of recent history (`perf(designer): …`, `fix(schema): …`).
- **Validate**: `git status` clean except `findings.md`; CI (`node-ci.yml` + `apple-validate.yml`) green on push.

### Task 4: Archive or remove `findings.md`
- **Action**: Move to `docs/reviews/2026-07-01-findings.md` (or delete, per user preference) and commit.
- **Validate**: repo root contains no stray review files.

### Task 5: Align dotenv across workspaces
- **Action**: Bump `dotenv` to `^17.4.2` in `apps/server/package.json`; `npm install`.
- **Validate**: `npm test`; `npm run dev` boots the server with `.env` loaded (check a known env-driven behavior, e.g. `CERT_PROFILE`).

### Task 6 (optional): Low-risk dependency bumps from F5
- **Action**: One commit each for `@zxing/browser`, `ajv-formats`, `concurrently`, `sharp` (update `allowScripts` version pin when bumping sharp). Skip `express`; do `archiver` only with a real-pass build check.
- **Validate**: full suite below after each bump; for archiver additionally `npm run build:pass -- --template dev-sample` and unzip-inspect the output.

## Validation (run after each task)

```bash
npm test                                              # 381 tests
npm run check                                         # fixture/schema validation
npm run build:designer                                # production SPA bundle
npm run build:pass -- --template dev-sample --serial PLAN-CHECK
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Removing root vite breaks `scripts/dev.js` npx resolution | Low | It runs from `apps/designer` which declares vite; validate `npm run dev` immediately |
| Lockfile churn breaks `npm ci` in CI | Low | Push and watch both workflows before stacking further changes |
| archiver 8 changes zip output subtly (pass rejected by iOS) | Medium | manifest/sign tests + Apple `buildpass validate` CI gate + manual install test |
| express 5 migration breaks guard/trust-proxy security boundary | High if attempted | Explicitly deferred — not in scope |

## Acceptance

- [x] Root `package.json` has no `vite` in production dependencies
- [x] No stale `allowScripts` entries; no npm allow-scripts warning
- [x] Vite 8 / Vitest 4 upgrade committed (`4f47993`); both CI workflows green
- [x] `findings.md` archived to `docs/reviews/2026-07-01-findings.md` (`6be4ed1`)
- [x] dotenv on one major (`^17.4.2`) across workspaces
- [x] All validation commands pass (381 tests, fixtures OK, designer build, dev-sample `.pkpass` built)

Completed 2026-07-02. Task 6 (optional low-risk dependency bumps) not executed — see F5 table.

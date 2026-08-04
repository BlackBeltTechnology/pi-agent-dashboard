# Test Plan — match-local-installs-by-package-name

Stage: apply   Generated: 2026-08-04

No clarifications needed — every Triple slot is concrete (post doubt-review).

Harness exemplars (copy glue from these):
- **L1** → `packages/server/src/__tests__/recommended-routes.test.ts` (`fastify.inject` on `/api/packages/recommended`, `vi.mock("../package/npm-search-proxy.js")`, real tmp dirs for `installedPath`), and `packages/server/src/__tests__/installed-package-enricher.test.ts` (`readPackageJsonName` fail-closed cases).
- **L3** → `tests/e2e/recommended-requires.spec.ts` (Packages tab vs docker harness, port from `.pi-test-harness.json#dashboardPort` — never hardcode `:18000`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 decorated local install matches by name | EP (nominal) | L1 | automated | installed row `installedPath=<tmp>/image-fit-extension`, its `package.json` name `@blackbelt-technology/pi-image-fit-extension`; recommended entry `source=npm:@blackbelt-technology/pi-image-fit-extension`; basename `image-fit-extension` ≠ unscoped name | GET `/api/packages/recommended` | that entry: `installed.scope` = its scope (global/local) AND `activeInPi=true`; response object shape unchanged (same keys as a string-matched entry) |
| E2 | R3 unrelated local package | EP (invalid) | L1 | automated | installed row `installedPath=<tmp>/some-other-pkg`, `package.json` name `@acme/unrelated`; recommended entry `source=npm:@blackbelt-technology/pi-image-fit-extension` | GET `/api/packages/recommended` | that entry: `installed.scope=null` AND `activeInPi=false` |
| E3 | R4 name mismatch does not break a valid string match | decision-table | L1 | automated | installed row whose `source` string-matches the entry via `sourcesMatch` (basename == unscoped npm name), but `package.json` name is absent/different | GET `/api/packages/recommended` | entry still `installed.scope` non-null (string match wins; either-match, name never overrides a valid string match) |
| E4 | Non-Goal: git entry not name-matched | decision-table | L1 | automated | recommended entry `source=git:github.com/owner/repo`; a local install under decorated dir with any `package.json` name | GET `/api/packages/recommended` | git entry `activeInPi`/`installed.scope` unchanged from today (name path returns false for non-npm; no throw) |
| E5 | R1 scoped-name exact compare | EP (nominal) | L1 | automated | `package.json` name is a scoped name `@blackbelt-technology/pi-anti-slop`; entry `source=npm:@blackbelt-technology/pi-anti-slop` | GET `/api/packages/recommended` | matched (`activeInPi=true`) — exact scoped-string compare, no unscoping |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R2 fail-closed: package.json absent | fault-injection | L1 | automated | `installedPath` dir exists, no `package.json` in it; entry source basename-matches the dir | GET `/api/packages/recommended` | no throw; falls back to string `sourcesMatch` (basename case still matched if applicable) |
| X2 | R2 fail-closed: invalid JSON | fault-injection | L1 | automated | `package.json` present but content is `{invalid` | GET `/api/packages/recommended` | no throw; name path returns false; degrades to string-only result |
| X3 | R2 fail-closed: non-string name | fault-injection | L1 | automated | `package.json` with `"name": 42` (or `name` absent) | GET `/api/packages/recommended` | no throw; name path returns false |
| X4 | R2 fail-closed: no candidate path | fault-injection | L1 | automated | active source string is `npm:...` (not a directory) / installed row `installedPath` undefined | GET `/api/packages/recommended` | no throw; `readPackageJsonName` returns undefined → name path false |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R1 activeInPi is the site that fixes the bug | state-convergence | L1 | automated | decorated local install present ONLY via `activeSources` (settings `packages[]` path string, no installed row); `package.json` name == entry npm name | GET `/api/packages/recommended` | entry `activeInPi=true` — asserted specifically on `activeInPi`, not just `installed.scope` (the `activeSources` site, not the installed-rows site) |
| F2 | R6 inner .find() gate fires for newly-matched entry | state-transition | L1 | automated | decorated local install with `package.json` carrying `version` + `pi.skills`; entry name-matches but does NOT string-match | GET `/api/packages/recommended` | `skillsRegistered` populated from the on-disk `pi.skills` AND `updateAvailable` computed (proves the version/skills read was not skipped) |
| F3 | R1 end-to-end Packages tab | state-convergence | L3 | automated | docker harness with a decorated local install whose `package.json` name matches a recommended npm entry (seed via harness fixture) | Packages tab "Recommended for this dashboard" loads | that card renders Active/Remove (not Install/Optional); missing-required count reflects it as active |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | R7 memoized reads, bounded IO | invariant-count | L1 | automated | N recommended entries × M installed rows, several sharing one `installedPath` | spy on `readPackageJsonName` (or `fs.readFileSync`): each distinct path read ≤ 1× per request; total reads ≤ number of distinct local paths touched by a failed string match | one GET request |

### Structural

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| S1 | R8 sourcesMatch stays fs-free | static-guard | L1 | automated | `packages/shared/src/source-matching.ts` source text | grep/import scan in a unit test | file contains no `node:fs` / `"fs"` import (purity preserved for wizard + plugin loader) |

### Manual

| id | requirement | technique | level | disposition | surface | human action | expected observable |
|----|-------------|-----------|-------|-------------|---------|--------------|---------------------|
| M1 | R10 real monorepo dashboard | manual verification | — | manual-only | live Packages tab in this monorepo checkout | restart server, open Packages tab | all 7 locally-installed recommended packages show Active/Remove; "suggested missing" count drops accordingly (env-specific to the dev monorepo's 7/7 local installs) |

---

## Coverage summary

- Requirements covered: R1, R2, R3, R4, R6, R7, R8, R10 (8 mapped); R5 (git non-goal) covered by E4; R9 (shape unchanged) folded into E1's observable.
- Scenarios by class: edge 5 · perf 1 · frontend 3 · error 4 · structural 1 · manual 1
- Scenarios by level: L1 12 · L2 0 · L3 1 · manual-only 1
- Scenarios by disposition: automated 14 · manual-only 1

## New infra needed

- **F3 (L3)** needed a docker-harness fixture seeding a decorated local install. **RESOLVED — implemented, not downgraded.** `docker/test-entrypoint.sh` seeds `/fixtures/local-pkg/image-fit-extension` (`package.json#name` = `@blackbelt-technology/pi-image-fit-extension`) into settings.json `packages[]` under the existing `PI_E2E_SEED` gate, reusing the same pattern the pi-flows peer wiring already uses. Verified no perturbation: no e2e spec asserts recommended-package counts, and `recommended-requires.spec.ts` still passes alongside the new spec.

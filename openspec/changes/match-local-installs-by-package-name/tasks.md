## 1. Implementation

- [ ] 1.1 In `packages/server/src/routes/recommended-routes.ts`, add `npmNameMatchesPath(entry, candidatePath)`: return false unless `parseSourceKey(entry.source).kind === "npm"`; call the **existing exported** `readPackageJsonName(candidatePath)` from `../package/installed-package-enricher.ts`; return `name === parsedNpmName`. Fail closed (false) on non-npm entry, missing/unreadable path, invalid JSON, or non-string `name`. Do NOT author a new package.json reader.
- [ ] 1.2 Add a per-request `Map<string, string | undefined>` memo wrapping `readPackageJsonName` so N entries × M rows don't re-read the same file; thread it into `enrichEntry`.
- [ ] 1.3 Apply the either-match `sourcesMatch(...) || npmNameMatchesPath(...)` at ALL THREE sites in `enrichEntry`: (a) `inGlobal`/`inLocal` (candidate = `row.installedPath`); (b) the inner `installed.find(...)` predicate that gates the `version`/`pi.skills` read (candidate = `row.installedPath`); (c) `activeInPi` over `activeSources` (candidate = the active source string as a local path).
- [ ] 1.4 Update `recommended-routes.ts` doc comment to describe the npm-name fs fallback and its three application sites; keep `sourcesMatch` / `source-matching.ts` untouched.

## 2. Tests

All L1 rows: author in `packages/server/src/__tests__/recommended-routes.test.ts` (see it for `fastify.inject` + `vi.mock("../package/npm-search-proxy.js")` + tmp-dir `installedPath` glue); fail-closed reader cases may also lean on `packages/server/src/__tests__/installed-package-enricher.test.ts`.

- [ ] 2.1 L1 (test-plan #E1): decorated local install matches by name. Input: installed row `installedPath=<tmp>/image-fit-extension`, `package.json` name `@blackbelt-technology/pi-image-fit-extension`; entry `source=npm:@blackbelt-technology/pi-image-fit-extension` · trigger: GET `/api/packages/recommended` · observable: entry `installed.scope` set AND `activeInPi=true`, response shape unchanged.
- [ ] 2.2 L1 (test-plan #E2): unrelated local package. Input: `installedPath` `package.json` name `@acme/unrelated` vs entry `npm:@blackbelt-technology/pi-image-fit-extension` · trigger: GET recommended · observable: `installed.scope=null` AND `activeInPi=false`.
- [ ] 2.3 L1 (test-plan #E3): name mismatch never breaks a valid string match. Input: row whose `source` string-matches entry but `package.json` name absent/different · trigger: GET recommended · observable: `installed.scope` still non-null (either-match).
- [ ] 2.4 L1 (test-plan #E4): git entry not name-matched (Non-Goal). Input: entry `source=git:github.com/owner/repo` + a decorated local install · trigger: GET recommended · observable: git entry state unchanged, no throw.
- [ ] 2.5 L1 (test-plan #E5): scoped-name exact compare. Input: `package.json` name `@blackbelt-technology/pi-anti-slop`, entry `npm:@blackbelt-technology/pi-anti-slop` · trigger: GET recommended · observable: `activeInPi=true` (no unscoping).
- [ ] 2.6 L1 (test-plan #X1): fail-closed, package.json absent. Input: `installedPath` dir with no `package.json`, entry basename-matches · trigger: GET recommended · observable: no throw; string `sourcesMatch` fallback applies.
- [ ] 2.7 L1 (test-plan #X2): fail-closed, invalid JSON. Input: `package.json` content `{invalid` · trigger: GET recommended · observable: no throw; name path false; string-only result.
- [ ] 2.8 L1 (test-plan #X3): fail-closed, non-string name. Input: `package.json` `"name": 42` (or absent) · trigger: GET recommended · observable: no throw; name path false.
- [ ] 2.9 L1 (test-plan #X4): fail-closed, no candidate path. Input: active source `npm:...` (not a dir) / `installedPath` undefined · trigger: GET recommended · observable: no throw; `readPackageJsonName` undefined → false.
- [ ] 2.10 L1 (test-plan #F1): `activeInPi` is the bug-fixing site. Input: decorated local install present ONLY via `activeSources` settings string (no installed row), `package.json` name == entry npm name · trigger: GET recommended · observable: entry `activeInPi=true` asserted specifically (the `activeSources` site).
- [ ] 2.11 L1 (test-plan #F2): inner `.find()` gate fires for newly-matched entry. Input: decorated local install with `version` + `pi.skills`, name-matches but not string-matches · trigger: GET recommended · observable: `skillsRegistered` populated from on-disk `pi.skills` AND `updateAvailable` computed (read not skipped).
- [ ] 2.12 L1 (test-plan #P1): memoized, bounded IO. Input: N entries × M rows sharing paths · trigger: one GET recommended · observable: spy on `readPackageJsonName`/`fs.readFileSync` — each distinct path read ≤ 1×; total ≤ distinct local paths touched by a failed string match.
- [ ] 2.13 L1 (test-plan #S1): `sourcesMatch` stays fs-free. Input: `packages/shared/src/source-matching.ts` source text · trigger: import/grep scan in a unit test · observable: no `node:fs`/`"fs"` import.
- [ ] 2.14 L3 (test-plan #F3): Packages tab end-to-end — see `tests/e2e/recommended-requires.spec.ts` for harness glue (port from `.pi-test-harness.json#dashboardPort`, never `:18000`). Input: harness fixture seeding a decorated local install whose `package.json` name matches a recommended npm entry · trigger: Packages tab "Recommended" loads · observable: that card shows Active/Remove (not Install/Optional); missing-required count reflects it active. If the harness cannot cheaply seed this, downgrade to manual and merge into 3.3 (per test-plan "New infra needed").

## 3. Validate

- [ ] 3.1 `npm test 2>&1 | tee /tmp/pi-test.log` green (see AGENTS "Running Tests").
- [ ] 3.2 `openspec validate match-local-installs-by-package-name --strict`.
- [ ] 3.3 (test-plan: manual-only) (test-plan #M1) Manual/QA: restart server, open Packages tab in this monorepo, confirm all 7 locally-installed recommended packages show Active/Remove and the "suggested missing" count drops accordingly.

## 4. Docs

- [ ] 4.1 Update `packages/server/src/routes/AGENTS.md` row for `recommended-routes.ts` with the local-name fallback + `See change:`.

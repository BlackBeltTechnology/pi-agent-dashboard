## 1. Implementation

- [x] 1.1 In `packages/server/src/routes/recommended-routes.ts`, add `npmNameMatchesPath(entrySource, candidatePath, readPkg)`: return false unless `parseSourceKey(entrySource).kind === "npm"` and a candidate path is given; compare `readPkg(candidatePath)?.name` exactly to the parsed npm name. Fail closed (false) on non-npm entry, missing path, or missing/invalid/non-string `name`.
- [x] 1.2 Add `createPkgReader()` — a per-request memoized `dir → parsed package.json | undefined` (swallow-on-error) — and route BOTH the name match and the existing `version`/`pi.skills` read through it, so each distinct path is read at most once per request and the route keeps exactly one package.json reader.
- [x] 1.3 Apply the either-match `sourcesMatch(...) || npmNameMatchesPath(...)` at ALL THREE sites in `enrichEntry`: (a) `inGlobal`/`inLocal` (candidate = `row.installedPath`); (b) the inner `installed.find(...)` predicate that gates the `version`/`pi.skills` read (candidate = `row.installedPath`); (c) `activeInPi` over `activeSources` (candidate = the active source string as a local path).
- [x] 1.4 Update `recommended-routes.ts` doc comment to describe the npm-name fs fallback and its three application sites; keep `sourcesMatch` / `source-matching.ts` untouched.

## 2. Tests

All L1 rows: author in `packages/server/src/__tests__/recommended-routes.test.ts` (see it for `fastify.inject` + `vi.mock("../package/npm-search-proxy.js")` + tmp-dir `installedPath` glue); fail-closed reader cases may also lean on `packages/server/src/__tests__/installed-package-enricher.test.ts`.

- [x] 2.1 L1 (test-plan #E1): decorated local install matches by name. Input: installed row `installedPath=<tmp>/image-fit-extension`, `package.json` name `@blackbelt-technology/pi-image-fit-extension`; entry `source=npm:@blackbelt-technology/pi-image-fit-extension` · trigger: GET `/api/packages/recommended` · observable: entry `installed.scope` set AND `activeInPi=true`, response shape unchanged.
- [x] 2.2 L1 (test-plan #E2): unrelated local package. Input: `installedPath` `package.json` name `@acme/unrelated` vs entry `npm:@blackbelt-technology/pi-image-fit-extension` · trigger: GET recommended · observable: `installed.scope=null` AND `activeInPi=false`.
- [x] 2.3 L1 (test-plan #E3): name mismatch never breaks a valid string match. Input: row whose `source` string-matches entry but `package.json` name absent/different · trigger: GET recommended · observable: `installed.scope` still non-null (either-match).
- [x] 2.4 L1 (test-plan #E4): git entry not name-matched (Non-Goal). Input: entry `source=git:github.com/owner/repo` + a decorated local install · trigger: GET recommended · observable: git entry state unchanged, no throw.
- [x] 2.5 L1 (test-plan #E5): scoped-name exact compare. Input: `package.json` name `@blackbelt-technology/pi-anti-slop`, entry `npm:@blackbelt-technology/pi-anti-slop` · trigger: GET recommended · observable: `activeInPi=true` (no unscoping).
- [x] 2.6 L1 (test-plan #X1): fail-closed, package.json absent. Input: `installedPath` dir with no `package.json`, entry basename-matches · trigger: GET recommended · observable: no throw; string `sourcesMatch` fallback applies.
- [x] 2.7 L1 (test-plan #X2): fail-closed, invalid JSON. Input: `package.json` content `{invalid` · trigger: GET recommended · observable: no throw; name path false; string-only result.
- [x] 2.8 L1 (test-plan #X3): fail-closed, non-string name. Input: `package.json` `"name": 42` (or absent) · trigger: GET recommended · observable: no throw; name path false.
- [x] 2.9 L1 (test-plan #X4): fail-closed, no candidate path. Input: active source `npm:...` (not a dir) / `installedPath` undefined · trigger: GET recommended · observable: no throw; `readPackageJsonName` undefined → false.
- [x] 2.10 L1 (test-plan #F1): `activeInPi` is the bug-fixing site. Input: decorated local install present ONLY via `activeSources` settings string (no installed row), `package.json` name == entry npm name · trigger: GET recommended · observable: entry `activeInPi=true` asserted specifically (the `activeSources` site).
- [x] 2.11 L1 (test-plan #F2): inner `.find()` gate fires for newly-matched entry. Input: decorated local install with `version` + `pi.skills`, name-matches but not string-matches · trigger: GET recommended · observable: `skillsRegistered` populated from on-disk `pi.skills` AND `updateAvailable` computed (read not skipped).
- [x] 2.12 L1 (test-plan #P1): memoized, bounded IO. Input: N entries × M rows sharing paths · trigger: one GET recommended · observable: spy on `readPackageJsonName`/`fs.readFileSync` — each distinct path read ≤ 1×; total ≤ distinct local paths touched by a failed string match.
- [x] 2.13 L1 (test-plan #S1): `sourcesMatch` stays fs-free. Input: `packages/shared/src/source-matching.ts` source text · trigger: import/grep scan in a unit test · observable: no `node:fs`/`"fs"` import.
- [x] 2.14 L3 (test-plan #F3): Packages tab end-to-end — see `tests/e2e/recommended-requires.spec.ts` for harness glue (port from `.pi-test-harness.json#dashboardPort`, never `:18000`). Input: harness fixture seeding a decorated local install whose `package.json` name matches a recommended npm entry · trigger: Packages tab "Recommended" loads · observable: that card shows Active/Remove (not Install/Optional); missing-required count reflects it active. If the harness cannot cheaply seed this, downgrade to manual and merge into 3.3 (per test-plan "New infra needed").

## 3. Validate

- [x] 3.1 `npm test 2>&1 | tee /tmp/pi-test.log` green (see AGENTS "Running Tests"). 11454 passed; 2 pre-existing failures unrelated to this change (`test-up-port-derivation` docker-gated, `git-worktree-lifecycle-ops` remote-gated) — verified failing on the merged tree with this change stashed.
- [x] 3.2 `openspec validate match-local-installs-by-package-name --strict`.
- [x] 3.3 (test-plan: manual-only) (test-plan #M1) Manual/QA: restart server, open Packages tab in this monorepo, confirm all 7 locally-installed recommended packages show Active/Remove and the "suggested missing" count drops accordingly.

## 4. Docs

- [x] 4.1 Update `packages/server/src/routes/AGENTS.md` row for `recommended-routes.ts` with the local-name fallback + `See change:`. Also added rows for the new L3 spec (`tests/e2e/AGENTS.md`) and the harness seed (`docker/AGENTS.md`).

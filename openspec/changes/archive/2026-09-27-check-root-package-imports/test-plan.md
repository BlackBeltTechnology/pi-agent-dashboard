# Test Plan: check-root-package-imports

Stage: design   Generated: 2026-09-23

No clarifications are needed. Every Triple resolves from the delta specs and design:
- the credit rule and its reachability closure;
- the exclusion pattern list and its order;
- the summary string `N root import(s) credited via reachable workspace`;
- the P1 budget of 120 s;
- the smoke's 60 s `/api/health` probe.

Levels:
- **L1** is the `scripts` vitest project (fixtures built in `mkdtemp`, with the checker driven as a library).
- **ci** is a `RUN_CI_SCENARIOS=1` scenario, a workflow-structure assertion, or a workflow gate.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | credit: direct workspace | EP | L1 | automated | Fixture root with `dependencies: {"@f/server": "1"}`. `packages/server/package.json` is `{name: "@f/server", dependencies: {fastify: "1"}}`. Packed `packages/server/src/x.ts` has `import "fastify"` | `analyzeRepository(root)` | no finding for `fastify` |
| E2 | credit: transitive | EP | L1 | automated | E1, plus server depends on `@f/shared`, and `@f/shared` declares `bonjour-service`. Packed `packages/shared/src/y.ts` imports `bonjour-service`. The root does not list `@f/shared` | `analyzeRepository(root)` | no finding |
| E3 | credit: unreachable | EP | L1 | automated | Packed `packages/other/src/z.ts` imports `left-pad`. `@f/other` declares it, but no root runtime dependency reaches `@f/other` | `analyzeRepository(root)` | exactly one `undeclared-import` with `specifier: "left-pad"`, file `packages/other/src/z.ts` |
| E4 | credit: dev-only in owner | decision table | L1 | automated | `@f/server` declares `vitest` in `devDependencies` only; the root does not declare it at runtime. Packed `packages/server/src/x.ts` imports `vitest` | `analyzeRepository(root)` | one `dev-only-import`, `specifier: "vitest"` |
| E5 | credit: root devDep does not shadow | decision table | L1 | automated | The root has `devDependencies: {fastify: "1"}`, and the reachable `@f/server` has `dependencies: {fastify: "1"}`. Packed `packages/server/src/x.ts` imports `fastify` | `analyzeRepository(root)` | no finding, and no `dev-only-import` in particular |
| E6 | credit: outside packages/ | EP | L1 | automated | Packed root `scripts/a.cjs` has `require("fastify")`, and only `@f/server` declares it | `analyzeRepository(root)` | one `undeclared-import` at `scripts/a.cjs` |
| E7 | credit: bundle output | EP | L1 | automated | Packed `packages/dist/client/assets/a.js` has `import "left-pad"`. There is no `packages/dist/package.json` | `analyzeRepository(root)` | one `undeclared-import` at `packages/dist/client/assets/a.js` |
| E8 | credit: cycle | state (graph) | L1 | automated | The root depends on `@f/a`; `@f/a` depends on `@f/b`, and `@f/b` depends on `@f/a`. Packed `packages/b/src/q.ts` imports a package that `@f/b` declares | `analyzeRepository(root)` finishes within the vitest 5 s timeout | no finding; the call returns |
| E9 | core: exception is root-only | EP | L1 | automated | Non-root workspace `packages/w` (`@f/w`) depends on `@f/v`. Its packed `src/i.ts` imports a package that only `@f/v` declares | `analyzeWorkspace(ws, packed)` | one `undeclared-import` (no cross-manifest credit) |
| E10 | directory boundary | BVA | L1 | automated | Reachable `@f/server` at `packages/server` declares `fastify`. Unreachable `@f/server-extra` at `packages/server-extra`. Packed `packages/server-extra/src/e.ts` imports `fastify` | `analyzeRepository(root)` | one `undeclared-import` (the `server-extra` path is not attributed to `server`) |
| E11 | root: full rule set | EP | L1 | automated | Fixture public root with `files: ["index.js","tsconfig.json"]`; `index.js` imports `left-pad`, and `tsconfig.json` extends `./missing.json`. This replaces #726's "ONLY the tsconfig rule" test, whose contract this change reverses | `analyzeRepository(root, {allowlist: []})` | rules are exactly `["dangling-tsconfig-extends", "undeclared-import"]` |
| E12 | root: private skipped | EP | L1 | automated | Fixture root with `private: true` and an undeclared import | `analyzeRepository(root)` | `workspaces` does not contain `rel: "."`, and there is no finding for the root |
| E13 | credit count summary | EP | L1 | automated | Fixture from E1 plus E2, giving 2 credited imports | run the CLI `main` summary (or the exported summary formatter) on the result | output contains `2 root import(s) credited via reachable workspace` |
| E14 | packaging: exclusions | EP | ci | automated | Real repository root | `npm pack --dry-run --json` at the root (`RUN_CI_SCENARIOS=1`) | 0 packed paths under `packages/` contain `__tests__/`, `__fixtures__/` or `__mocks__/`, or match `.test.`, `.spec.`, `/AGENTS.md` or `.AGENTS.md` |
| E15 | packaging: root AGENTS.md ships | EP | ci | automated | Real repository root | same pack as E14 | the packed set contains `AGENTS.md` and `tsconfig.base.json` |
| E16 | packaging: negation order | invariant | L1 | automated | Real root `package.json` `files` | static read | the index of every `!`-prefixed entry is greater than the index of every non-negated entry |
| E17 | real repo passes | EP | ci | automated | Real repository, unbuilt | `node scripts/verify-published-imports.mjs` (existing P1 run in `dependency-declarations.test.mjs`) | exit 0 with the root (`rel "."`) in the checked set under the full rules |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | P1 budget with the full root analysis | threshold | ci | automated | full CLI across all non-private packages plus the root (about 550 extra parsed root files) | wall-clock < 120 s (existing P1 assertion) | one run |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | over-exclusion caught | fault-injection (remove target) | L1 | automated | Packed `packages/server/src/a.ts` imports `./__tests__/helper.js`, which is absent from the packed set | `analyzeRepository(root)` | one `dangling-relative-import`, `specifier: "./__tests__/helper.js"` |
| X2 | reachability: malformed workspace manifest | fault-injection (abort) | L1 | automated | `packages/broken/package.json` is `{ not json`. The root depends on `@f/server` (valid) | `analyzeRepository(root)` | no throw; `@f/server` credit still applies to E1's import |
| X3 | post-build CI run wired | structure assertion | ci | automated | `.github/workflows/ci.yml` | parse the `ci` job steps | a step running `node scripts/verify-published-imports.mjs` has an index greater than the `Build (fail on regressed warnings)` step |
| X4 | built tree passes | EP | ci | automated | CI tree after `npm run build` (`packages/dist/` populated) | the new post-build step | exit 0 (apply-time triage of the first built run before merge) |
| X5 | installed root boots | fault-injection (missing files) | ci | automated | Packed root plus workspace tarballs, installed into an isolated `HOME` (`scripts/test-standalone-npm-install.sh`, `publish.yml` gate via `_smoke.yml`) | start `pi-dashboard`, then poll | `/api/health` `ok: true` within 60 s; `find <installed root>/packages \( -name __tests__ -o -name '*.test.*' -o -name '*.AGENTS.md' \)` prints nothing |

---

## Coverage summary

- Requirements covered: 5/5. They are: core (modified), root full rules (modified), reachable credit (added), post-build CI run (added), and the packaging exclusions (added).
- Scenarios by class: edge 17 · perf 1 · frontend 0 · error 5
- Scenarios by level: L1 16 · ci 7 · L2 0 · L3 0
- Scenarios by disposition: automated 23 · manual-only 0

## New infra needed

- None. X3 follows `packages/shared/src/__tests__/nightly-workflow-contract.test.ts`. E14 and E15 follow `scripts/__tests__/kb-packaging.test.mjs`. X5 extends the existing `scripts/test-standalone-npm-install.sh`.

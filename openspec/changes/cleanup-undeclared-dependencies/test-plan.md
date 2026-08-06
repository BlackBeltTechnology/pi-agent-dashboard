# Test Plan — cleanup-undeclared-dependencies

Stage: design   Generated: 2026-08-06

All five HARD-gate clarifications resolved before writing (C1 devDeps-in-shipped-files,
C2 60s budget, C3 inline temp fixture, C4 dry-run + post-release, C5 highest-lower-bound).
No `[NEEDS CLARIFICATION]` markers remain.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | publish-check: undeclared shipped import fails | EP (invalid partition) | L1 | automated | temp fixture workspace whose shipped `index.js` imports `left-pad`, manifest declares nothing | run checker as a library against the fixture | exits non-zero; message names the workspace, `index.js`, and `left-pad` |
| E2 | publish-check: declared runtime dep passes | EP (valid partition) | L1 | automated | temp fixture shipping `index.js` importing `fastify`, manifest `dependencies.fastify: "^5.0.0"` | run checker | exits zero, zero findings |
| E3 | publish-check: devDependency in a shipped file FAILS | EP (invalid — stricter than Biome) | L1 | automated | temp fixture shipping `index.js` importing `vitest`, manifest declares `vitest` only in `devDependencies` | run checker | exits non-zero; message states the dep is dev-only and will not install for a consumer |
| E4 | publish-check: devDependency imported only by non-shipped files passes | EP (valid boundary) | L1 | automated | temp fixture with `files: ["dist/"]`, `src/test-support/h.ts` importing `vitest`, `vitest` in `devDependencies` | run checker | exits zero — the importing file is outside the packed set |
| E5 | publish-check: peer + optional peer satisfy | EP (valid partition) | L1 | automated | temp fixture shipping code importing `pi-ai`, manifest `peerDependencies` + `peerDependenciesMeta.optional: true` at `^0.75.5` | run checker | exits zero |
| E6 | publish-check: deep subpath resolves to package name | BVA (specifier segmentation) | L1 | automated | shipped file importing `dagre-d3-es/src/dagre/index.js`, manifest declares `dagre-d3-es` | run checker | exits zero; no finding named `dagre-d3-es/src/dagre/index.js` |
| E7 | publish-check: scoped package resolves to two segments | BVA (specifier segmentation) | L1 | automated | shipped file importing `@mdi/react`, manifest declares `@mdi/react` | run checker | exits zero |
| E8 | publish-check: scoped deep subpath resolves to two segments | BVA (specifier segmentation) | L1 | automated | shipped file importing `@scope/pkg/sub/path.js`, manifest declares `@scope/pkg` | run checker | exits zero |
| E9 | publish-check: Node builtins never reported | EP (excluded partition) | L1 | automated | shipped file importing `node:path`, `path`, `node:fs` | run checker, manifest declares none of them | exits zero |
| E10 | publish-check: dangling relative import fails | EP (invalid partition) | L1 | automated | shipped `index.js` importing `./missing.js`, target absent from the packed file list | run checker | exits non-zero, names the dangling relative import |
| E11 | publish-check: private workspaces skipped | decision-table | L1 | automated | fixture with `"private": true` and an undeclared shipped import | run checker | workspace skipped; exits zero |
| E12 | publish-check: allowlisted specifier not reported | decision-table | L1 | automated | fixture importing `@pi/anthropic-messages`, allowlist entry with a reason string | run checker | exits zero; specifier not reported |
| E13 | publish-check: allowlist entry without a reason is rejected | decision-table | L1 | automated | allowlist entry lacking a `reason` field | run checker | exits non-zero, so exceptions cannot accumulate silently |
| E14 | fixture leaves no repository artifact | state (setup/teardown) | L1 | automated | the E1–E13 fixture suite | suite completes | no fixture dir remains under `packages/`; repo-wide run unaffected |
| E15 | biome: repo-root undeclared probe reports zero | EP (target state) | ci | automated | the repository after all declarations, overrides, and ignores land | `npx biome lint --only=correctness/noUndeclaredDependencies . --max-diagnostics=20000` | reports zero findings |
| E16 | biome: build/config override matches no `src/**` file | BVA (over-match guardrail) | L1 | automated | the `biome.json` build/config override block | enumerate every file it matches | none lies under any `src/` directory |
| E17 | biome: override covers non-obvious build entry points | EP (known-missed partition) | L1 | automated | `vite.main.config.ts`, `vite.preload.config.ts`, `scripts/vite-build.mjs`, `scripts/download-git-windows.mjs` | apply the override | all four are matched |
| E18 | biome: spec asserts no override that is absent from config | decision-table | L1 | automated | this capability's asserted override set vs `biome.json` | compare | every asserted override exists in `biome.json` (catches the `packages/server/**` + `scripts/**` drift) |
| E19 | ranges: reused range must be satisfied by the resolving version | EP (valid) | L1 | automated | a dep already declared elsewhere, resolving version satisfies that range | apply the range-selection rule | the reused range is chosen |
| E20 | ranges: unsatisfiable existing range is NOT propagated | EP (invalid — real cases) | L1 | automated | `typebox` existing `^1.3.7` with `1.3.6` resolving; `vitest` existing `^2.1.8` with `4.1.10` resolving | apply the rule | the unsatisfiable range is rejected; a caret on the resolving version is chosen |
| E21 | ranges: highest lower bound wins among disagreeing siblings | decision-table | L1 | automated | `wouter` siblings `>=3.0.0`, `^3.0.0`, `^3.9.0`; resolving `3.10.0` | apply the rule | `^3.9.0` chosen |
| E22 | ranges: no wildcard in any non-private workspace | EP (invalid partition) | L1 | automated | all four dependency fields of every non-private workspace | scan after the change | no declared range equals `"*"` |
| E23 | optional host-provided deps are concrete optional peers | decision-table | L1 | automated | `packages/extension` after the change | read the manifest | `@earendil-works/pi-ai` in `peerDependencies` at a concrete range, `peerDependenciesMeta["@earendil-works/pi-ai"].optional === true` |
| E24 | every non-private workspace declares public access | EP (set-based) | L1 | automated | every `packages/*/package.json` without `"private": true` | read each | each declares `publishConfig.access === "public"` (fails today on `bus-client`; passes after the D7 fix) |
| E25 | root tooling deps are devDependencies, not dependencies | decision-table | L1 | automated | root `package.json` after declaring `jiti` and `yaml` | read the manifest | both in `devDependencies`; neither in `dependencies` (root ships only 2 scripts, not the importers) |
| E26 | publish dry-run lists every non-private workspace | EP (set-based) | ci | automated | the workspace set | `npm publish --workspaces --include-workspace-root --dry-run` | one entry per non-private workspace; no entry for any `private: true` workspace |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | publish-check completes within the CI budget | threshold | ci | automated | all non-private workspaces (32 at time of writing), full pack + parse | total wall-clock < 60s | single CI run |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | publish-check survives a workspace that fails to pack | fault-injection (abort) | L1 | automated | a workspace whose `npm pack --dry-run` exits non-zero | run the checker across the set | the checker reports that workspace as an error and exits non-zero — it does NOT silently skip it and report success |
| X2 | publish-check handles an unparseable source file | fault-injection (malformed input) | L1 | automated | a shipped file containing a syntax error | run the checker | reports the file as unparseable and exits non-zero, rather than treating "no specifiers found" as a pass |
| X3 | publish-check handles a missing `node_modules` entry during range verification | fault-injection (absent dependency) | L1 | automated | a dep declared but not installed, as `@blackbelt-technology/pi-anthropic-messages` is today | run range verification | reports the range as unverifiable rather than crashing or silently passing |
| X4 | biome probe fails loudly on an invalid rule name | fault-injection (bad invocation) | L1 | automated | `--only=correctness/noSuchRule` | run the probe | non-zero exit — guards against a probe that reports zero because it ran nothing |

### Post-release verification

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | every non-private workspace resolves on the registry | set-based assertion | ci | automated | every `packages/*/package.json` without `"private": true` | after a tagged release publishes `<version>` | `npm view <name> version` returns `<version>` for each |

---

## Coverage summary

- Requirements covered: 13/13
- Scenarios by class: edge 26 · perf 1 · frontend 0 · error 4 · post-release 1
- Scenarios by level: L1 24 · L2 0 · L3 0 · ci 8
- Scenarios by disposition: automated 32 · manual-only 0

No frontend-quirk scenarios: this change touches manifests, Biome config, and a
CLI verification script. It renders nothing, so an L3 Playwright row would be
theatre.

No `manual-only` rows: every observable here is a file fact, an exit code, or a
registry response. Nothing rests on human judgment.

## New infra needed

- **The publish-correctness checker itself** (`scripts/`, alongside
  `verify-release-deps.mjs` and `verify-lockfile-versions.mjs`). It is the
  subject of E1–E14, P1 and X1–X3, and does not exist today. It must be
  importable as a library, not only runnable as a CLI, so the fixture tests can
  invoke it against a temp directory.
- **A CI job** wiring the checker + E15 + E26 + P1 into `ci.yml`.
- **A post-release assertion** for R1 in `publish.yml` or a release-verification
  step — it cannot run pre-merge, because its observable only exists after a tag
  publishes.

# Test Plan — fix-ci-pipeline-followups

Stage: design   Generated: 2026-09-16

Gate: HARD, satisfied. Two unfillable observables were resolved by decision before this file was written:

- **canary `otool` exec failure** → `::error::` + `exit 1` (same as a missing prebuilt; a floor check that cannot run its tool is misconfigured). Drives `X1`.
- **macOS-leg duration budget** for the added ~100 MB prebuilt download → **no budget**; cost accepted untested. No performance scenario is emitted (see Notes).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | electron-build-pipeline · "Canary sample is installed before the floor check runs" | state-transition (step ordering) | ci | automated | `_electron-build.yml` darwin leg step list | workflow-contract test parses the file | a `node install.js` step exists on the darwin legs, its electron dir comes from `pi-dashboard-resolve-tool.cjs electron`, and its index is **before** the floor-check step's index |
| E2 | electron-build-pipeline · same, resolver clause | decision-table (scanned vs unscanned file) | L1 | automated | a literal `node_modules/electron/dist` string planted in `_electron-build.yml` | `no-hardcoded-node-modules-paths.test.ts` runs | the test FAILS naming `_electron-build.yml` (i.e. `SCAN_FILES` now reaches it); with the resolver call instead, it passes |
| E3 | electron-build-pipeline · "Blind extractor fails the job instead of passing it" | EP (invalid partition) | L1 | automated | `otool -l` fixture text with neither `LC_BUILD_VERSION` nor `LC_VERSION_MIN_MACOSX` | canary predicate invoked with that text | status `blind-extractor`; message contains the literal `extractMinosValues` AND the prebuilt path; verdict maps to `::error::`/exit 1, never `::warning::` |
| E4 | electron-build-pipeline · "Novel shape on the produced binary alone still warns" | BVA (valid nominal, pass-through) | L1 | automated | canary fixture with one slice, numeric major `12` | canary passes, then produced-binary text yields no `minos` | canary status `ok`; produced-binary status stays `not-extractable` → `::warning::` + exit 0 (pre-existing tolerance intact) |
| E5 | electron-build-pipeline · "Non-numeric canary result fails the job" | BVA (just-outside valid: present but unusable) | L1 | automated | canary fixture whose `minos` major is `n/a` (non-numeric, non-empty) | canary predicate invoked | verdict is the error verdict, NOT `ok` and NOT the `non-numeric`→warning mapping the produced-binary path uses |
| E6 | electron-build-pipeline · "Missing produced binary fails the job" | state-transition (illegal edge) | ci | automated | the floor-check step's `else` branch in `_electron-build.yml` | workflow-contract test parses the branch | branch contains `::error::` and `exit 1`; the string `skipping otool check` is absent; `hdiutil detach` still runs before the exit |
| E7 | marketing-site · "Contract test refuses the trigger's return" (block form) | decision-table (YAML trigger forms) | L1 | automated | `sync-release-version.yml` containing `on:`→`release:` in block form | site-deploy contract test runs | test FAILS; the failure message contains `sync-release-version.yml`, and the owning `describe` names that workflow (not `deploy-site.yml`) |
| E8 | marketing-site · same, inline-mapping form | decision-table | L1 | automated | `on: {release: [published]}` | same test runs | test FAILS — the block-form-only regex `/^\s*release:\s*$/m` is not sufficient |
| E9 | marketing-site · same, sequence form | decision-table | L1 | automated | `on: [release]` | same test runs | test FAILS |
| E10 | marketing-site · "Dispatch input survives the removal" | EP (valid partition) | L1 | automated | the shipped `sync-release-version.yml` after the trigger removal | same test runs | `workflow_dispatch.inputs.correlation` is present and the suite passes — the removal did not take the dispatch input with it |
| E11 | marketing-site · "Site declares \"Pi blue\" design tokens as CSS variables" | EP + negative assertion | L1 | automated | `site/index.html` and `site/404.html` text | token-contract test parses both | `:root` declares all 13 named tokens (`--bg-primary|secondary|tertiary`, `--text-primary|secondary|tertiary`, `--accent|-solid|-text`, `--status-idle|working|needs-you`, `--border`); a `[data-theme="light"]` block redeclares the same set; occurrences of `--pi-`, `rgb(var(`, and `root.dark` are each **0** |
| E12 | ci-cd-pipeline · "CI workflow on push and PR" / "ci-checks mirrors PR CI" | EP (command sequence) | L1 | automated | `ci.yml` and `publish.yml` text | `pnpm-migration-contract.test.ts` X5 runs | both workflows install via `pnpm install --frozen-lockfile` and run lint→test→build in that order; no `npm ci` remains in either install path (extend X5 if it asserts only the install verb, not the order) |
| M1 | marketing-site · "Manual dispatch still works" | live-infrastructure | — | manual-only | a real `workflow_dispatch` of `sync-release-version` from the Actions UI | maintainer dispatches after a hand-published draft | run rewrites the download block and commits to `develop`; then a `deploy-site` dispatch publishes it. [judgment: requires live GitHub Actions + a real release — the static contract tests explicitly disclaim live coverage] |
| M2 | ci-cd-pipeline ×4 + marketing-site ×1 spec corrections | post-archive text verification | — | manual-only | the synced `openspec/specs/**` after `openspec archive` | archive sync completes | each re-stated requirement block carries the pnpm / static-site wording; the deliberately-surviving hits are untouched (`npm ci` in "Build tools…" and in marketing-site's forbidden-command SHALL NOT; `Astro` at marketing-site "Performance and accessibility budgets"). [judgment: one-shot scoped greps against a synced tree — no standing test owns spec prose] |
| M3 | proposal · `spa404Fallback` docstring (#577) | doc read | — | manual-only | `packages/shell/vite.config.ts` comment | reviewer reads the comment | comment names `site/404.html` and `/app/`, and does not claim Pages serves the shell for unknown paths. [judgment: comment prose; a text assertion here would be brittle and pin wording, not behaviour] |

### Performance

None. The one perf-relevant change (the added darwin prebuilt download) has no threshold, metric, or measurement window in the spec, and the budget question was answered "accept untested" — so per the skill's rule no scenario is invented. See Notes.

### Frontend-quirk

None. This change touches no rendered UI: the client/shell edit is comment-only and inert under hash routing.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | electron-build-pipeline · canary, exec-failure path (gate decision) | fault-injection (abort) | L1 | automated | `otool` cannot be executed — absent from PATH, or exits non-zero | canary runs over the prebuilt | `::error::` + exit 1, naming the extractor and the sample — NOT the `::warning::`+exit-0 path `verify-macos-floor.mjs:46` uses for the produced binary |
| X2 | electron-build-pipeline · canary, missing-sample path | fault-injection (abort) | L1 | automated | `<electron-dir>/dist/.../Electron` does not exist (e.g. the new install step was removed or failed) | canary runs | `::error::` + exit 1 naming the sample path; the job does not fall through to the produced-binary check |

---

## Coverage summary

- Requirements covered: 11/11 asserted requirement-scenarios across the 3 capabilities (4 `ci-cd-pipeline` MODIFIED blocks share one observable, E12).
- Scenarios by class: edge 15 · perf 0 · frontend 0 · error 2
- Scenarios by level: L1 11 · L2 0 · L3 0 · ci 2 · — (manual) 3
- Scenarios by disposition: automated 14 · manual-only 3

## New infra needed

- **A pure canary verdict helper is required, not optional.** E3/E4/E5/X1/X2 are all routed L1, but `packages/electron/vitest.build-contract.config.ts` mandates "pure predicates only, no ambient environment" and runs on Linux, where `otool` does not exist. So the canary's verdict — including the *exec-failed* and *file-missing* inputs, not just the otool text — must resolve through one pure function in `macos-floor.mjs` (e.g. taking `{ otoolOutput, execFailed, sampleMissing }`), with the `execFileSync` staying in `verify-macos-floor.mjs`. A canary written inline in the script is untestable in CI and E3/E5/X1/X2 could not be authored.
- **One new L1 test file** for E11 (site design tokens). No existing unit test reads `site/index.html`; the two site-related tests found are L3 Playwright contrast specs. Author it as a text-contract test in the `packages/shared/src/__tests__/*-contract.test.ts` style.
- No new level or harness otherwise: E1/E6 extend workflow-text assertions, E3–E5/X1/X2 extend `packages/electron/src/__tests__/macos-floor-check.test.ts` (which already reads `_electron-build.yml` and owns the `not-extractable`/`non-numeric` cases), E7–E10 extend `site-deploy-workflow-contract.test.ts`, E12 extends `pnpm-migration-contract.test.ts`, E2 extends `no-hardcoded-node-modules-paths.test.ts`.

## Notes

- **Accepted untested:** the darwin `node install.js` step adds a ~100 MB download per macOS leg. No wall-clock budget is asserted (gate decision). If macOS-leg duration later becomes a concern, the automatable follow-up is a cache assertion on the `@electron/get` cache dir, not a timing threshold.
- **Unpinnable by construction:** the "hand-published draft SHALL be followed by two dispatches" obligation (M1) is a maintainer action; no test can assert a future human step. The spec states this explicitly rather than implying test coverage.

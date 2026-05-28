## Why

The `standalone-install-smoke` matrix runs 7 container jobs (Linux × 6 Node-image combos + Windows × 1) on **every push to every PR** targeting `develop`. For typical PRs that touch only client TS or server logic, this is wasted CI minutes and slow feedback. Meanwhile the actual release path — `publish.yml` — has **no test or smoke gate at all**: it trusts that `develop` was last green when the tag was cut. The `ci-cd-pipeline` spec already *claims* "CI failure prevents publish" (Scenario in `openspec/specs/ci-cd-pipeline/spec.md`), but the implementation never enforced this for the smoke matrix and the lint/test/build gate is also missing from the actual `publish.yml`. The spec drifted from reality.

We want the cost where the risk is: **release time, not every commit**.

## What Changes

- **BREAKING (developer workflow)**: `standalone-install-smoke-linux` and `standalone-install-smoke-windows` jobs SHALL no longer run on `push` or `pull_request`. PR feedback for smoke goes away by default.
- Extract the smoke matrix into a reusable workflow `.github/workflows/_smoke.yml` (`on: workflow_call`), mirroring the `_electron-build.yml` pattern.
- Add a manual entry point `.github/workflows/ci-smoke.yml` (`on: workflow_dispatch`) so operators can run the smoke matrix on demand against any branch (sibling of `ci-electron.yml`).
- Keep the cheap `ci` job (lint + test + build, Node 22, ~3 min) on `push` and `pull_request` to `develop` — this remains the PR safety net.
- **`publish.yml`** SHALL gain a `release-gate` job between `prepare` and `publish` that:
  - runs `npm ci && npm run lint && npm test && npm run build` on Node 22 (matches `ci.yml`'s `ci` job)
  - calls `_smoke.yml` (full 7-leg matrix) via `uses:`
  - is wired as `needs: [prepare, release-gate]` on `publish` so npm publish is blocked on failure
- Document the smoke matrix as a first-class spec requirement in `ci-cd-pipeline` so it cannot silently disappear again.
- Update `ci-cd-pipeline` spec to match reality on the trigger branch (`develop`, not `main`) and to encode the new trigger model.

**Out of scope** (explicit non-goals):
- Electron build ordering is **unchanged** — it remains `needs: [prepare, publish]` because the bundled server's `npm install` resolves `@blackbelt-technology/*` from the npm registry post-publish. See `_electron-build.yml` header comment.
- QA VM tests (`qa/Makefile`) remain manual-only.
- No path-filter or label-trigger heuristic for smoke on PRs — pure manual dispatch keeps the YAML simple.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ci-cd-pipeline`: trigger model for smoke matrix moves from auto-on-PR to manual-dispatch; release flow gains a hard test+smoke gate before npm publish; smoke matrix becomes a documented spec requirement.

## Impact

**Affected files**:
- `.github/workflows/ci.yml` — remove `standalone-install-smoke-linux` and `standalone-install-smoke-windows` jobs (keep `ci` job)
- `.github/workflows/_smoke.yml` — **NEW**, reusable workflow encapsulating the 7-leg matrix
- `.github/workflows/ci-smoke.yml` — **NEW**, `workflow_dispatch` entry point calling `_smoke.yml`
- `.github/workflows/publish.yml` — insert `release-gate` job, add `needs:` on `publish`
- `openspec/specs/ci-cd-pipeline/spec.md` — sync with reality (branch name) + add smoke-matrix requirement + add release-gate requirement
- `AGENTS.md` "Key Files" — add rows for `_smoke.yml` and `ci-smoke.yml` (per docs protocol, route per-file detail to `docs/file-index-*.md` if a CI split exists; otherwise inline backbone row)

**Affected workflows / operators**:
- Release operators (`release-cut` skill users): no behavior change at the surface — `git tag v*` or "Run workflow" still kicks the pipeline. New cost: release gains ~10 min of release-gate runtime before npm publish starts. Failures abort the release cleanly *before* publish, which is the whole point.
- PR authors: lose automatic smoke signal. Mitigation = (a) release-gate catches it before npm, (b) operators can dispatch `ci-smoke.yml` manually against a feature branch when the change is installer-shaped (lockfile, bundle-server, native deps).
- CI cost: dominant savings on PR churn (7 containers × N pushes per PR → 0). Release cost rises by one matrix run. Net negative cost in steady state.

**Risks**:
- **Tag-before-gate**: today `prepare` on `workflow_dispatch` bumps versions, commits, tags, and pushes *before* `publish`. If `release-gate` fails after that, we have a tag pointing at a bad commit with no npm artifact. Mitigation options (to resolve in design.md):
  1. Move `release-gate` to run **before** `prepare`'s commit-and-tag step (requires splitting `prepare` into `resolve` + `tag-and-push`).
  2. Keep current ordering and accept that failed releases require `release-revoke` skill.
- **PR regression detection delay**: a PR that breaks the installer (e.g. lockfile bump that doesn't resolve in alpine) won't fail CI; it'll fail at release time on someone else's tag-push. Mitigation = strong norm to dispatch `ci-smoke.yml` against branches that touch lockfile / bundle-server / native deps / preload-fastify.
- **Spec/impl drift recurring**: the current drift exists because no test asserts the publish.yml shape matches the spec. Consider adding a repo-lint test (`packages/shared/src/__tests__/publish-workflow-contract.test.ts` already pins `needs:` array shape — extend it).

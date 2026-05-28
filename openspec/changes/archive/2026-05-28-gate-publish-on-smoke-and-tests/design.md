## Context

The release pipeline currently has two trigger paths into `publish.yml`:

```
   tag push (v*)                workflow_dispatch
   ──────────────               ─────────────────
   Human cuts tag locally,      Operator clicks "Run workflow",
   git push --tags              types version string

         │                              │
         ▼                              ▼
   prepare resolves version       prepare:
   from GITHUB_REF                  - bumps every package.json
   (no bump, no commit,             - syncs versions
    no tag — tag already             - promotes CHANGELOG [Unreleased]
    exists)                          - commits "chore(release): vX.Y.Z"
                                     - tags vX.Y.Z
                                     - git push branch + tag
         │                              │
         └──────────────┬───────────────┘
                        ▼
                   publish (npm × 5)
                        │
                        ▼
                   electron (6 legs)
                        │
                        ▼
                   github-release (draft)
```

Today there is **no test gate** between `prepare` and `publish`. The `ci-cd-pipeline` spec already claims one exists (`Scenario: CI failure prevents publish`), but the implementation never enforced it. The smoke matrix (`standalone-install-smoke-{linux,windows}` in `ci.yml`) is the load-bearing regression guard — it caught the v0.5.3 install regressions per the comment in `ci.yml` line 16. It currently runs on every PR push.

This change moves smoke from "every PR push" to "release-gate + manual dispatch", and finally implements the test gate the spec already promises.

Relevant files:
- `.github/workflows/ci.yml` — `ci` job + `standalone-install-smoke-{linux,windows}` jobs
- `.github/workflows/publish.yml` — `prepare` → `publish` → `electron` → `github-release`
- `.github/workflows/_electron-build.yml` — already the precedent for a `workflow_call` reusable
- `.github/workflows/ci-electron.yml` — already the precedent for a `workflow_dispatch` entry calling a reusable
- `openspec/specs/ci-cd-pipeline/spec.md` — out of date (references `main`, omits smoke matrix)
- `packages/shared/src/__tests__/publish-workflow-contract.test.ts` — repo-lint pinning `needs:` array; the place to extend with new gate contract

## Goals / Non-Goals

**Goals:**
- Smoke matrix no longer runs on `push` / `pull_request` automatically.
- Operators can run the smoke matrix on demand against any branch via a manual workflow.
- `publish.yml` enforces lint + test + build + smoke as a hard gate before `npm publish`.
- `ci-cd-pipeline` spec accurately reflects implementation (no more drift).
- Extend repo-lint to assert the gate's `needs:` shape so the drift can't recur silently.

**Non-Goals:**
- **Electron build ordering stays put.** `electron` remains `needs: [prepare, publish]` because the bundled server's `npm install` resolves `@blackbelt-technology/*` from the npm registry post-publish. Adding electron to the pre-publish gate would require teaching `bundle-server.mjs` to consume workspace tarballs, which is its own change.
- **No PR-time smoke heuristics** (path filters, labels, schedule). Pure on/off — auto on PRs is removed, dispatch is added. Heuristics can be a follow-up change if the manual norm proves brittle.
- **No QA-VM hookup.** `qa/Makefile` stays manual-only.
- **No changes to `ci-electron.yml`'s scope.** It already exists for installer dev builds; the new `ci-smoke.yml` is a sibling, not a replacement.

## Decisions

### Decision 1: Extract the smoke matrix into `_smoke.yml` (reusable, `workflow_call`)

Mirror the existing `_electron-build.yml` pattern: one reusable workflow defining the matrix, consumed by both the manual dispatch entry and the release gate.

**Inputs** to `_smoke.yml`:
- `ref` (string, required) — git ref to check out (sha for release-gate, branch HEAD for dispatch)

The Node-image × distro matrix is hard-coded inside `_smoke.yml`; no `legs` input in this iteration (unlike `_electron-build.yml`). If matrix subsetting becomes useful later (e.g. "alpine-only after a musl fix"), add a `legs` input then.

**Why over inlining**:
- One source of truth for the matrix definition.
- Same idiom the repo already uses for electron.
- Repo-lint can target one file when asserting matrix shape.

**Alternatives considered**:
- *Inline matrix in both `ci-smoke.yml` and `publish.yml`* — rejected, duplication drifts.
- *Composite action* — rejected, composite actions can't define a job matrix; this is fundamentally a workflow, not a step.

### Decision 2: Add `ci-smoke.yml` as `workflow_dispatch` entry

New top-level workflow at `.github/workflows/ci-smoke.yml`. Sibling of `ci-electron.yml`. Single job that `uses: ./.github/workflows/_smoke.yml` with `ref: ${{ github.ref }}`.

**Why a separate file** (vs adding `workflow_dispatch:` to `ci.yml`):
- Keeps `ci.yml` lean and PR-focused.
- Discoverable in the Actions UI as a distinct entry (matches `ci-electron.yml` UX).
- Independent concurrency group — dispatching smoke on a branch doesn't fight with PR `ci.yml` runs.

**Concurrency**: `group: ci-smoke-${{ github.ref }}`, `cancel-in-progress: true`. Re-dispatching on the same branch cancels the prior run.

### Decision 3: Release-gate splits `prepare` into `resolve` + `tag-and-push`

This is the load-bearing structural change.

**Old `prepare` (today)**: single job that resolves version AND (on dispatch) bumps/commits/tags/pushes.

**New shape**:

```
   ┌─────────┐    ┌─────────────┐    ┌────────────────┐    ┌─────────┐
   │ resolve │ →  │release-gate │ →  │ tag-and-push   │ →  │ publish │
   │         │    │             │    │ (dispatch only)│    │         │
   └─────────┘    └─────────────┘    └────────────────┘    └─────────┘
                       │
                       ├─ ci-checks (lint+test+build, Node 22)
                       └─ smoke (uses: _smoke.yml)
```

- **`resolve`**: pure version resolution. On dispatch, computes the target version string but does NOT yet write/commit/tag. On tag-push, extracts version from `GITHUB_REF`. Outputs: `version`, `tag`, `is_prerelease`, `ref` (the sha the gate should test).
- **`release-gate`**: two parallel sub-jobs.
  - `ci-checks`: `npm ci && npm run lint && npm test && npm run build` on Node 22. Mirrors `ci.yml`'s `ci` job.
  - `smoke`: `uses: ./.github/workflows/_smoke.yml` with `ref: ${{ needs.resolve.outputs.ref }}`.
- **`tag-and-push`** (runs only on `workflow_dispatch`): does the bump/sync/promote/commit/tag/push that `prepare` used to do. Skipped on tag-push because the tag is already there.
- **`publish`**: `needs: [resolve, release-gate, tag-and-push]`. The `if:` allows `tag-and-push` to be skipped on tag-push entry without blocking.

**Why split rather than gate-after-tag**:
- On `workflow_dispatch`: gate runs before the tag is written. Gate failure → nothing committed, nothing tagged, nothing published. Clean rollback = no rollback needed.
- On `tag-push`: the tag already exists from the human's `git push --tags`. Gate failure → publish skipped, but tag remains. This is acceptable because (a) the human explicitly cut the tag knowing this risk, (b) the `release-revoke` skill handles tag removal.

**Asymmetry is intentional**: dispatch entry gets the cleaner "no tag on failure" property because we control the tag-push step. Tag-push entry can't have that property by construction. The gate itself is uniform across both paths.

**Alternatives considered**:
- *Keep `prepare` monolithic, run gate after `prepare`, accept dangling tags on dispatch failure too* — rejected. Dispatch is the primary release path; making it as safe as we can is worth the refactor.
- *Run gate inline as steps inside `prepare`* — rejected. Steps can't fan out into a 7-leg matrix; the smoke matrix has to be a separate job/workflow.
- *Use environments + manual approval gate* — rejected, this is automated gating not human gating.

### Decision 4: `release-gate` uses fan-out (parallel `ci-checks` + `smoke`)

`ci-checks` (lint+test+build) and `smoke` run in parallel under the `release-gate` umbrella. `publish` depends on both via `needs:`.

**Why parallel**: smoke takes ~10 min, `ci-checks` takes ~3 min. Serial would block release behind ~13 min instead of ~10. The two are independent — no need to serialize.

### Decision 5: Repo-lint extension to pin the new contract

Extend `packages/shared/src/__tests__/publish-workflow-contract.test.ts` to assert:
- `publish.yml` defines jobs named `resolve`, `release-gate` (or its constituents `ci-checks` + `smoke`), `tag-and-push`, `publish`, `electron`, `github-release`.
- `publish` job has `needs:` containing `release-gate` (or `ci-checks` AND `smoke`).
- `tag-and-push` job has `if: github.event_name == 'workflow_dispatch'`.

This is the **mechanism that prevents the drift from recurring**. The existing test already pins the electron job's `needs:` array — this is the same protection applied to the new gate.

### Decision 6: `ci.yml` keeps the cheap `ci` job; smoke jobs removed entirely

`ci.yml` still runs `npm ci && npm run lint && npm test && npm run build` on `push` and `pull_request` to `develop`. Only the smoke jobs are removed from this file. PR authors keep the 3-minute lint/test/build signal.

The smoke jobs are not "moved" to a different trigger in `ci.yml` — they are deleted from `ci.yml` and re-homed in `_smoke.yml` (which `ci-smoke.yml` and `publish.yml` consume).

## Risks / Trade-offs

- **Tag-push entry can dangle on gate failure** → Mitigation: documented in proposal, `release-revoke` skill covers cleanup. We accept this because tag-push is the secondary path; dispatch is primary and safe.

- **PR no longer catches installer regressions automatically** → Mitigation:
  1. The release-gate catches them before npm publish.
  2. Operators should manually dispatch `ci-smoke.yml` against PR branches that touch installer-shaped paths (lockfile, `scripts/bundle-*`, `packages/server/preload-*`, `scripts/fix-pty-permissions.cjs`, native dep upgrades).
  3. Add a callout in `docs/faq.md` and the `release-cut` skill: "Before tagging, dispatch `ci-smoke.yml` against `develop` to catch regressions while there's still time to fix without revoking."

- **Release wall-clock time increases by ~10 min** → Mitigation: parallelism inside `release-gate` keeps the added latency to roughly one smoke run, not smoke + ci serialized. Net: release time goes from ~25 min to ~35 min for the dispatch path. Acceptable for a per-release cost.

- **Spec/impl drift could recur on other jobs** → Mitigation: Decision 5's repo-lint extension. Long-term: every job whose `needs:` matters for safety should be pinned by a contract test. Out of scope for this change to backfill all of them; in scope to pin the new gate.

- **`_smoke.yml` shape change requires touching three workflows** → Mitigation: minimal input surface (`ref` only); shape changes are rare in practice. The `_electron-build.yml` precedent has been stable.

- **`tag-and-push` skipping on tag-push relies on `if:` semantics for downstream `needs:`** → Mitigation: `needs:` with a skipped predecessor is treated as success by default. `publish` job's `needs:` includes `tag-and-push`; on tag-push entry, `tag-and-push` is skipped (not failed), so `publish` runs. Verified by GitHub Actions docs and the existing `ci-electron.yml` pattern that uses similar `if:` skipping.

## Migration Plan

1. Land `_smoke.yml` and `ci-smoke.yml` first (additive — no behavior change yet).
2. Land the `publish.yml` refactor (`resolve` + `release-gate` + `tag-and-push` + updated `publish.needs`).
3. Land the repo-lint extension. This will fail in step 1 if landed first, so order matters.
4. Remove smoke jobs from `ci.yml` last. Until removed, the smoke matrix runs in two places (old `ci.yml` jobs + new gate on next release). This is wasteful but safe; deleting last avoids a window where neither path is active.
5. Update `ci-cd-pipeline` spec to match the new reality.
6. Update `release-cut` skill to recommend dispatching `ci-smoke.yml` before cutting.
7. **Rollback**: each step is independently revertable via `git revert`. The `_smoke.yml` and `ci-smoke.yml` files are additive; removing them leaves the system in the post-step-4 state (no smoke at all). To fully roll back, revert all five PRs in reverse order.

**Verification after each step**:
- Step 1: dispatch `ci-smoke.yml` against `develop`, observe 7-leg matrix succeeds.
- Step 2: dispatch `publish.yml` with a `-rc` prerelease version, observe gate runs before tag-push, observe publish blocked if gate fails (manually break a test to verify).
- Step 3: contract test passes locally and in CI.
- Step 4: open a no-op PR, observe `ci` job runs, no smoke jobs appear.
- Step 5: `openspec validate gate-publish-on-smoke-and-tests` is clean; spec deltas apply.

## Open Questions

None blocking implementation. Two deferred:

1. Should `ci-electron.yml` also gain a `release-gate` dependency before producing dev installers? Currently it builds whatever the dispatched ref is, even if tests are broken. Argument for: dev installers shouldn't lie about being installable. Argument against: dev installers are explicitly for debugging packaging, sometimes you want to build them against a known-broken tree. Defer until someone hits a case.
2. Nightly cron on `develop` calling `_smoke.yml`? Would catch base-image / registry drift within 24h regardless of PR activity. Cheap to add (one cron-triggered workflow). Defer to a follow-up change after we see whether manual dispatch discipline holds.

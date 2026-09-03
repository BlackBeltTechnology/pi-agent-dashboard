---
session: 019e5f42
week: 2026/W22
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-ci-electron-on-demand-build]
proposal_excerpt: "Electron installers (DMG / AppImage / DEB / Windows ZIP + portable .exe) are produced only by the release pipeline (`.github/workflows/publish.yml`), which requires a SemVer tag, an npm publish, and a GitHub Release."
---

# How we did it: Making the `ci-electron` on-demand build actually dispatch and run — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a terse kickoff:

> "Current proposal: add-ci-electron-on-demand-build. I would like to make CI tests"

The *real* objective, once steering clarified it, was **not** to write more test
files. It was to get the already-drafted `ci-electron` workflow — an on-demand
(`workflow_dispatch`) Electron installer build that runs *without* cutting a
release — to actually **register, dispatch, and execute end-to-end on GitHub
Actions**, then drive out the real bugs that only surface once the pipeline runs on
CI. The proposal existed; the implementation on the feature branch had never been
validated against GitHub's runtime, and it was silently broken in several places.

## 2. TL;DR playbook

1. **Put the dispatch-marker file on the default branch first.** GitHub only
   registers `workflow_dispatch` for a workflow whose file exists on the *default
   branch* (`develop`). Push just `ci-electron.yml` to `develop` as a registration
   marker — the feature branch's copy of both yml files is what actually runs at
   dispatch time.
2. **Dispatch against the feature ref:** `gh workflow run ci-electron.yml --ref feat/...`.
3. **Let GitHub's semantic parser be your first validator.** Job-level `if:` that
   references `matrix.*` is illegal (`Unrecognized named-value: 'matrix'`). Replace
   the per-leg filter with a `resolve` job that emits a **JSON matrix** and
   `strategy.matrix: ${{ fromJSON(needs.resolve.outputs.matrix) }}`.
4. **Smoke-test jq filters locally before pushing** — bind the row to `$r` so `.`
   inside a pipe doesn't lose the row reference.
5. **Fix Node 22 type-stripping under `node_modules`** with a tsx loader shim
   (`vite-build.mjs` that registers `tsx/esm/api` then imports `vite/bin/vite.js`),
   and wire it into the `build`/`prepare` scripts.
6. **Mirror the *full* version-stamp sequence from `publish.yml`** into the reusable
   `_electron-build.yml` — not just `npm version`, but also `sync-versions.js`,
   `npm install --package-lock-only`, and `verify-lockfile-versions.mjs`.
7. **Re-dispatch after every fix and watch the early phase** (`gh run watch` /
   `gh run view --log-failed`) — each fix uncovers the next real bug.
8. **When you run out of budget, print a clean hand-off prompt** capturing exact run
   IDs, the failing job, the root-cause hypothesis, and what's still open.

## 3. How the collaboration unfolded

**Phase 1 — Reframe the ask (Discovery).** The AI paused on the vague "make CI tests"
and asked what the tests should cover. The pivotal discovery: the workflow couldn't
even be dispatched because `workflow_dispatch` isn't registered until the file lives
on the default branch. The AI laid out a per-file table of *what must be on `develop`
vs. what resolves against the dispatched ref* — turning a fuzzy request into a
concrete "push one marker file" move.

**Phase 2 — Register and hit the first real bug (Dispatch).** After pushing the
marker and dispatching, GitHub's own semantic parse rejected the file:
`Unrecognized named-value: 'matrix'` on a job-level `if:`. The AI correctly
identified that GHA evaluates job-level `if:` *before* matrix expansion, and offered
two options. The human chose **Option A/B** (dynamic matrix), and the AI refactored
to a `resolve` job emitting `fromJSON()` matrix output — filtered legs never spawn.

**Phase 3 — Peel the onion (Iterate).** Each re-dispatch surfaced the next real
defect: a jq row-binding bug (fixed with `$r`), then the Node 22
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` failure (fixed with the tsx loader
shim), then a plugin slot-taxonomy mismatch. The AI consistently smoke-tested fixes
locally before pushing, and validated that the `publish-workflow-contract.test.ts`
still passed after each `_electron-build.yml` edit.

**Phase 4 — Root-cause the version drift (Diagnose).** The slot mismatch traced to
`_electron-build.yml` running `npm version --workspaces` but skipping the three
follow-up steps `publish.yml` uses (`sync-versions.js`, lockfile regen, verify).
Result: cross-refs stayed `^0.5.3`, which SemVer says doesn't satisfy the
prerelease `0.5.3-ci.X`, so npm resolved plugins from the **registry's** older slot
taxonomy. The human's own hunch — *"maybe local version is used of that plugins
causing the mismatch"* — pointed straight at this.

**Phase 5 — Honest hand-off (Stop).** With the version-drift fix pushed but a
residual 19-vs-21-id mystery still failing (prepare-script ordering triggers vite
before the sync steps run), the AI wrote a status table and a copy-paste prompt for
the next session rather than burning more budget guessing.

## 4. Prompts that worked

- **The goal prompt** (weak as written): *"…I would like to make CI tests."* Too
  vague — it invited scope confusion. **Stronger version:** *"The
  add-ci-electron-on-demand-build workflow is on `feat/...` but has never run on CI.
  Get it to dispatch and execute end-to-end, and fix whatever real bugs surface."*
- **"No. Just print a prompt which I can give a session to able to fix it"** — a
  high-leverage redirect. It set a *budget boundary*: don't rabbit-hole, produce a
  self-contained hand-off artifact. This is the single most reusable move in the
  session.
- **"Option a"** — a one-word decision that unblocked the whole matrix refactor. The
  AI had pre-structured the choice as labeled options, so the human could steer in
  two characters.
- **"Maybe local version is used of that plugins causing the mismatch"** — a domain
  hunch that seeded the correct root cause. Short, speculative, and *right* — worth
  voicing even when uncertain.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Interpret "make CI tests" as *write test files* | Redirecting to *make the workflow actually run on CI* | State the objective as a runtime outcome ("dispatch + execute end-to-end"), not an artifact |
| Keep iterating on the failing build | "No. Just print a prompt I can give a session to fix it" | Set a budget boundary up front; ask for a hand-off prompt when stuck |
| Present a fix as the fix | Choosing "Option a" from pre-structured options | Always surface labeled A/B options for irreversible or costly directions |
| Look for the bug in the workflow yaml | "Maybe local version is used of that plugins" | Trust the operator's domain hunches; test them before the generic hypotheses |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created in this session. The workflow is clearly repeatable,
so **the skill that *should* exist** is a `ci-electron-dispatch-debug` procedure
capturing:

- The default-branch `workflow_dispatch` registration rule (marker file on
  `develop`, real run against the dispatched ref).
- The GHA job-level-`if:` / `matrix.*` illegality and the `resolve`→`fromJSON()`
  dynamic-matrix pattern.
- The full `publish.yml` version-stamp sequence that any reusable build workflow
  *must* mirror (`npm version` → `sync-versions.js` → `--package-lock-only` →
  `verify-lockfile-versions.mjs`), and *why* skipping it causes registry-resolution
  drift.
- The Node 22 `node_modules` type-stripping shim (`tsx/esm/api` + dynamic
  `vite/bin/vite.js` import).

This repo already ships a `ci-troubleshoot` skill — these findings belong folded
into it. It removes the multi-hour rediscovery of GitHub's dispatch semantics and
the SemVer-prerelease resolution trap.

## 7. Pitfalls & dead ends

- **`Unrecognized named-value: 'matrix'`** → job-level `if:` can't see `matrix.*`.
  Don't guard legs with a job `if:`; build a dynamic matrix from a `resolve` job.
- **jq filter loses the row inside a pipe** → `(... | split(",")) | index(...)`
  rebinds `.`. Bind the row to `$r` first, and smoke-test the jq locally on all
  shapes before pushing.
- **`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`** on Node 22 → it refuses to strip
  `.ts` files resolved under `node_modules/` (workspace symlinks trip the guard).
  Fix with a `vite-build.mjs` shim that registers `tsx/esm/api` and imports
  `vite/bin/vite.js` via `require.resolve('vite/package.json')` (bin isn't in
  `exports`).
- **Slot taxonomy mismatch (19 vs 21 ids)** → a reusable build workflow that runs
  `npm version --workspaces` but omits `sync-versions.js` + lockfile regen leaves
  cross-refs as `^0.5.3`, which SemVer won't match to `0.5.3-ci.X`, so npm pulls the
  *published registry* copy with the older slot list. Mirror `publish.yml`'s full
  sequence.
- **Ordering trap (still open):** `npm version --workspaces` fires each workspace's
  `prepare` script *before* the sync/lockfile steps run — so `packages/client`'s
  prepare (`vite-build.mjs`) executes vite (and the plugin validator) against the
  pre-sync state. If you hit this, move the version-stamp steps ahead of any
  prepare-triggering `npm version`, or neutralize prepare during the stamp.

## 8. Reproduce it faster — checklist

- [ ] Confirm the workflow file is on the **default branch** (`develop`) — push a
      marker if not.
- [ ] `gh workflow run ci-electron.yml --ref feat/...` and immediately
      `gh run watch` the early phase.
- [ ] If `Unrecognized named-value: 'matrix'` → convert per-leg `if:` to a `resolve`
      job + `fromJSON()` dynamic matrix.
- [ ] Smoke-test any jq filter locally (bind row to `$r`) before pushing.
- [ ] Ensure `vite-build.mjs` tsx shim is wired into `build`/`prepare` and `tsx` is
      a direct dep of `packages/client`.
- [ ] Verify `_electron-build.yml` mirrors `publish.yml`'s **full** version-stamp
      sequence (version → sync-versions → package-lock-only → verify), and that it
      runs *before* any prepare-triggering step.
- [ ] Keep `publish-workflow-contract.test.ts` green after every `_electron-build.yml`
      edit.
- [ ] When budget runs out, emit a hand-off prompt with exact run/job IDs, root-cause
      hypothesis, and open items.

**Key inputs:** `gh` authenticated, push rights to `develop` + feature branch,
`openspec/changes/add-ci-electron-on-demand-build/`.

**Artifacts produced:** `packages/client/scripts/vite-build.mjs` (new);
edits to `.github/workflows/_electron-build.yml`, `packages/client/package.json`.

---

_Generated from session `019e5f42-1d1a-7d92-9e0b-ac0f43cefddb` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-25. Source extract: `/tmp/facts-57149-1784854194.md`._

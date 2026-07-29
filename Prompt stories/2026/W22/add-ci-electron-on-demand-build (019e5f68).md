---
session: 019e5f68
week: 2026/W22
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-ci-electron-on-demand-build, eliminate-electron-runtime-install]
proposal_excerpt: "Electron installers (DMG / AppImage / DEB / Windows ZIP + portable .exe) are produced only by the release pipeline (`.github/workflows/publish.yml`), which requires a SemVer tag, an npm publish, and a GitHub Release.…"
---

# How we did it: Getting the on-demand `ci-electron` matrix green — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator was working the `add-ci-electron-on-demand-build` proposal on branch
`feat/enable-standalone-npm-install`. The on-demand `ci-electron` workflow finally
*dispatched* and reached the real build phase, but the Linux x64 leg died inside Vite:

> "The ci-electron workflow now dispatches cleanly and reaches the actual build phase,
> but the Linux x64 leg fails inside vite during plugin manifest validation:
> `claims[0].slot "session-card-flows" is not a known slot id`… The validator's 'Valid
> ids' list has **19** entries. The source `slot-types.ts` on the tested commit has
> **21**… The lockfile pins `@b…`"

The *real* objective, once the investigation clarified it: **make the CI machinery that
builds Electron installers on-demand pass end-to-end**, by finding why the build was
resolving a *stale, pre-bump* copy of `pi-dashboard-shared` (19 slot ids) instead of the
workspace source (21 ids) — and then cleaning up the collateral CI breakage that the same
underlying cleanup commit (`d3fe2163`) had left behind across both `_electron-build.yml`
and `ci.yml`.

## 2. TL;DR playbook

1. **Reproduce the exact failing step.** `gh run view <id> --job <id> --log-failed`, then
   diff the validator's "Valid ids" count against the source `slot-types.ts` count. A
   count mismatch (19 vs 21) = a *stale artifact* is being resolved, not a code bug.
2. **Suspect lifecycle-script ordering, not the code.** The build ran during `npm version
   --workspaces` — *before* `sync-versions.js` made cross-workspace specifiers coherent.
   Add a **diagnostic step** after `npm ci` to dump on-disk state and prove where the stale
   copy comes from.
3. **Learn the npm bug.** `--ignore-scripts` does **not** apply to the implicit `prepare`
   that `npm version --workspaces` fires (npm/cli#4128). Replace `npm version` with
   `npm pkg set version=…` — a pure JSON edit, zero lifecycle scripts.
4. **Keep the develop marker copy in sync.** `_electron-build.yml` + `ci-electron.yml` have
   marker copies on `develop` for dispatch registration. Mirror every edit there via a
   throwaway `git worktree add /tmp/dev-mirror origin/develop`, commit, remove the worktree.
5. **Dispatch narrow, then wide.** `gh workflow run ci-electron.yml --ref <branch> -f
   legs=linux-x64` to prove one leg, then `-f legs=all` for the full matrix. Poll with
   `gh run list --workflow=ci-electron.yml --limit 1`.
6. **Trace collateral breakage to the same root.** Vestigial workflow steps + `ci.yml`
   smoke steps + stale tests all referenced scripts/routes deleted by `d3fe2163`. Remove
   the vestigial steps, `if: false`-skip the un-restorable smoke, delete the stale tests.
7. **Separate "run failed" from "the work failed."** With `fail-fast: false`, GitHub marks
   the whole run `failure` if *any* leg fails. Report per-leg outcomes, not the aggregate.

## 3. How the collaboration unfolded

**Phase 1 — Diagnose the stale artifact (reads + git archaeology).** The AI confirmed
develop and feat were bit-identical on the two workflow files, then checked whether `npm
version` triggers `prepare`, inspected `slot-types.ts` (21 ids) vs the built
`slot-types.js`, and read `sync-versions.js`. *Why it worked:* it treated the 19-vs-21
count as the signal — a resolution/ordering problem, not a missing slot definition.

**Phase 2 — Fix the ordering, learn the npm bug (edit + dispatch + poll).** First attempt:
add `--ignore-scripts` + a diagnostic step. The diagnostic **proved** `npm ci` was clean
(21 ids resolve) — so the stale copy could only come from the version-triggered prepare.
That evidence led to the real fix: swap `npm version` → `npm pkg set version=…`. *Decision
point:* rather than guess, the operator's AI added a diagnostic step whose only job was to
falsify a hypothesis, then removed it once its job was done.

**Phase 3 — Clean up d3fe2163 residue (workflow surgery).** With the slot failure gone, the
build failed at "Bundle first-party recommended extensions" — a step invoking
`bundle-recommended-extensions.mjs`, deleted by `d3fe2163`. The AI removed 5 vestigial
steps, re-dispatched `linux-x64` (✓ ~284 MB artifact), then the full matrix: **4/6 legs
green**, both Windows legs failing on a `@electron/packager` resedit version-string error
(pre-existing, Windows-specific, out of scope).

**Phase 4 — Answer the "every build failed" steering with data.** The operator pushed back
twice (see §5). The AI pulled per-job conclusions and showed 4/6 legs succeeded with
artifacts; the run-level `failure` was only GitHub's matrix-aggregation rule.

**Phase 5 — The PR `ci.yml` was a different beast.** The second steering URL pointed at
`ci.yml` (PR CI), not `ci-electron`. The AI proved every prior run on the branch had failed
too (back past `0b10b7c`, before any of its commits) — so nothing was a regression. Three
pre-existing failure modes, all traceable to `d3fe2163`: 2 stale tests (deliberately-removed
`upgrade-pi` subcommand + bootstrap `503` gate), a Linux smoke step referencing a deleted
`.sh`, and a Windows smoke polling a removed `/api/bootstrap/status`. Fix: delete the 3
stale tests, `if: false` the Linux smoke with a TODO, allowlist the dependency-free
`recovery-server.ts` in the `no-direct-child-process` lint. Result: **8/10 jobs green, up
from 0/10**; the 3 Windows-smoke failures are the actual branch feature work, out of scope.

## 4. Prompts that worked

- **The goal prompt (excellent kickoff).** It carried the exact failing step, the precise
  error, the *count discrepancy* (19 vs 21), the two ancestor commits that added the slots,
  and the `gh run view … --log-failed` selector. That front-loaded evidence let the AI skip
  guessing and go straight to "why is a stale artifact resolving." **Reuse this shape:**
  failing command + exact error + the one measurable discrepancy + how to reproduce.
- **"Check the last execution, every build failed"** — a blunt correction that forced the AI
  to stop narrating optimism and produce a *per-leg table* with real conclusions.
- **"But what about this execution? <URL>"** — pointed at a *different* workflow. A single
  URL redirected the whole investigation to `ci.yml` vs `ci-electron`. **Lesson for the
  operator:** paste the run URL; it disambiguates which workflow you mean instantly.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Report a matrix run as a single pass/fail and lean optimistic | "every build failed" | State up front: "give me per-leg conclusions with `fail-fast:false`; the run-level status is just GitHub's aggregation." |
| Assume the failing run was the workflow it just fixed (`ci-electron`) | Pasting the actual run URL, which was `ci.yml` | Always confirm *which workflow* a run belongs to before triaging; `gh run view <id>` shows the workflow name. |
| Risk claiming its own commits broke CI | Implicitly, by asking to re-examine | Prove regression-vs-pre-existing by checking a commit *before* your first commit (`0b10b7c` here) failed the same way. |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created this session. But the workflow is highly repeatable and a
skill **should** exist:

- **A `ci-electron-triage` skill** capturing: (1) the 19-vs-21 "count mismatch = stale
  artifact resolution" heuristic; (2) the npm/cli#4128 rule (`--ignore-scripts` doesn't
  cover `npm version --workspaces`' implicit prepare → use `npm pkg set version=…`); (3)
  the develop marker-copy mirror ritual via a throwaway `/tmp/dev-mirror` worktree; (4) the
  `legs=linux-x64` → `legs=all` dispatch ladder; (5) "run-level failure ≠ per-leg failure
  under `fail-fast:false`." The repo already ships a `ci-troubleshoot` skill — this belongs
  as an extension of it.

## 7. Pitfalls & dead ends

- **`--ignore-scripts` is a trap on `npm version --workspaces`.** It silently does *not*
  suppress the implicit `prepare` (npm/cli#4128). If a build fires when you only meant to
  bump a version, switch to `npm pkg set version=…`.
- **A slot/enum "not a known id" error is usually a stale build, not a missing entry.**
  Count the validator's list vs the source before touching any slot definition.
- **`git log d3fe2163 -1 --stat -- <path>` failed** when the path had been *deleted* by that
  commit — use `git show --stat <commit>` and `git log --all --oneline -- <path>` to find
  deletions instead.
- **The Windows resedit error and the Windows smoke are two different Windows failures.** The
  packager `Incorrectly formatted version string` (5-component CI slug) is in `ci-electron`;
  the smoke `.ps1` polling `/api/bootstrap/status` is in `ci.yml`. Don't conflate them.
- **Don't restore a deleted script blindly.** The Linux smoke's `.sh` *and* the route it
  polled (`/api/bootstrap/status`) were both removed — restoring the script alone wouldn't
  help. `if: false` + a TODO for the branch maintainer was the honest scope boundary.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the failing `gh run`/`--job` ids, push access to the branch, the
name of the develop marker copies to keep in sync (`_electron-build.yml`, `ci-electron.yml`).

- [ ] `gh run view <id> --job <id> --log-failed` — pin the exact failing step + error.
- [ ] If it's a slot/enum "not a known id": compare validator count vs `slot-types.ts` count.
      Mismatch ⇒ stale artifact / lifecycle ordering, not a code fix.
- [ ] Add a throwaway diagnostic step after `npm ci` to prove where the stale copy resolves.
- [ ] Replace `npm version --workspaces` with `npm pkg set version=…` (npm/cli#4128).
- [ ] Mirror every workflow edit to develop's marker copies via `/tmp/dev-mirror` worktree.
- [ ] Dispatch `-f legs=linux-x64`, confirm the artifact, then `-f legs=all`.
- [ ] Grep the workflow for steps invoking scripts deleted by the cleanup commit; remove them.
- [ ] For collateral `ci.yml` failures: verify they pre-date your commits, then delete stale
      tests / `if: false` un-restorable smoke / allowlist deliberate exceptions.
- [ ] Report **per-leg** outcomes, never the aggregate `failure` under `fail-fast:false`.

**Final artifacts produced:** edits to `_electron-build.yml`, `ci.yml`,
`cli-parse.test.ts`, `pi-changelog-routes.test.ts`, `no-direct-child-process.test.ts`, and
`add-ci-electron-on-demand-build/tasks.md`. Commits `f601921f`, `2206c1e5`, `351237e2`,
`45730a79`, `19b31806`. Outcome: **8/10 PR CI jobs green (from 0/10)**, `ci-electron` **4/6
legs building end-to-end with uploaded artifacts**; remaining Windows failures are the
branch's own feature work, out of scope.

---

_Generated from session `019e5f68-85d4-7bf4-be85-ffc884e2dbaa` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-25. Source extract: `/tmp/facts-G38pqi.md`._

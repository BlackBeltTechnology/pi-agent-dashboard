---
session: 019ec38c
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [optimize-openspec-poll-derive-artifacts-locally]
proposal_excerpt: "The periodic OpenSpec poll spawns `openspec status --change <name> --json` **once per change, per cwd, every tick**. On this machine that is 66 active changes in `pi-agent-dashboard` alone (~96 across 11 pinned dirs).…"
---

# How we did it: Kill the OpenSpec poll spawn storm — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change optimize-openspec-poll-derive-artifacts-locally
```

The real objective, decoded from the proposal: the dashboard's periodic OpenSpec
poll was spawning `openspec status --change <name> --json` **once per change, per
cwd, every tick** — ~66 active changes in this repo alone (~96 across 11 pinned
dirs). The change replaces that per-change CLI spawn storm with a **pure local
derivation** (`deriveArtifactStatus`) that reads local files + the single `openspec
list` output, keeping force-refresh on the authoritative CLI. The later steering
turns extended the ask end-to-end: **implement → archive → PR → pass CI → fix
CodeRabbit → merge and clean up the worktree.**

## 2. TL;DR playbook

1. Run `/skill:openspec-apply-change <change-name>`; let it load the proposal,
   design, and tasks, then read `openspec-poller.ts` + `directory-service.ts`.
2. **Before writing code, measure CLI reality.** Run `openspec status --json` /
   `openspec list --json` across *all* real changes and decode the true state
   machine — do not trust the design's stated rule.
3. When the measured CLI contradicts the spec artifacts, **stop and surface the
   evidence table**, propose the corrected rule, get approval, then fix
   `design.md`/`tasks.md` *first*.
4. Implement the pure helper (`deriveArtifactStatus`, probe-injected), wire it into
   `pollOne` on the `force === false` path only, and bump the poll interval config.
5. Add a **parity test** asserting `deriveArtifactStatus === buildOpenSpecData(runOpenSpecStatus(...))`
   across every real change in the repo.
6. Run `npm test 2>&1 | tee /tmp/pi-test.log`; expect the old-contract
   directory-service tests to fail — rewrite their spawn-count assertions, keep
   the derived-outcome checks.
7. If mocks resolve a stale shared package, **`npm install` in the worktree** so
   `node_modules/@blackbelt-technology/shared` points at the worktree copy.
8. Delegate every `docs/` write to a general-purpose subagent with the caveman-style
   rule verbatim; update tasks.md; `npx tsc --noEmit` at root.
9. Steer: `archive` → commit (revert any machine-specific `.pi/settings.json`
   rewrite) → push → `gh pr create` → poll `gh pr checks`.
10. Steer: fetch CodeRabbit comments, fix real issues (skip false positives with a
    stated reason), re-push, wait green, squash-merge, delete branch + worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery.** The AI loaded the apply-change skill, read the change
artifacts (0/14 tasks), and read the `pollOne` implementation plus the existing
poller test to mirror style. Effective bit: it grounded itself in *both* the spec
and the real source before touching anything.

**Phase 2 — Measure-first, spec-vs-reality.** The AI ran the real CLI across all 71
changes and discovered the design's stated rule (`tasks:done` iff
`completedTasks === totalTasks`) **mismatched 70 of 71 changes** — CLI actually
returns `tasks:done` iff `totalTasks > 0`. It built a full evidence table of the CLI
state machine and **paused for human approval** before implementing against a broken
spec. *This is the highest-leverage move of the session.*

**Phase 3 — Fix spec, then implement.** After approval it corrected `design.md` and
`tasks.md`, wrote the pure `deriveArtifactStatus` helper, wired it into the gated
poll path, added the repo-wide parity test, and bumped
`DEFAULT_OPENSPEC_POLL.pollIntervalSeconds` 30 → 60.

**Phase 4 — Test blast-radius reconciliation.** The full suite surfaced ~17 failures
across 5 directory-service test files that asserted the *old* contract (gated path
spawns `openspec status`). The AI mapped the blast radius in a table, got approval,
and rewrote spawn-count assertions while preserving derived-outcome checks —
carefully, because these touch safety-critical TOCTOU cache-poisoning guards.

**Phase 5 — Stale-package trap.** Mocks failed because the worktree's near-empty
`node_modules` resolved the shared package to the *main repo* copy. Fix: `npm install`
in the worktree so it resolves the worktree copy.

**Phase 6 — Docs + verify.** Docs writes were delegated to a subagent with the
caveman-style rule; root `tsc --noEmit` was clean; artifacts validated.

**Phase 7 — Ship (steered).** Four short steering prompts drove archive → commit →
PR #109 → CI green → CodeRabbit fixes → squash-merge → worktree/branch cleanup.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change optimize-openspec-poll-derive-artifacts-locally`.
  Effective because the change was already fully specified; the skill supplied the
  proposal/design/tasks context so the AI could start from evidence, not guesswork.
- **`do. not check, check out and archive`** — decisively ended the verify loop and
  moved to archiving; a crisp scope cut.
- **`commit, create PR and monintor CI`** — bundled three ship steps into one
  low-token instruction the AI executed sequentially.
- **`fix coderabbit issues`** — delegated the whole review-response loop; the AI
  fetched comments, fixed the real ones, and skipped false positives with reasons.
- **`merge pr, delete branch and worktree`** — one prompt closed out the entire
  lifecycle including cleanup.

Stronger rewrite of the goal prompt for next time: *"Apply change X; measure the real
`openspec` CLI state machine across all changes before implementing, and stop if the
spec's derivation rule disagrees with reality."* — bakes the phase-2 insight in.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Keep looping in verify/check mode | "do. not check, check out and archive" | State the terminal step up front (archive) once tasks pass |
| Wait for explicit ship instructions | "commit, create PR and monintor CI" | Include ship-through-CI in the initial ask |
| Leave review threads for the human | "fix coderabbit issues" | Add "address CodeRabbit and re-push until green" to the ship ask |
| Stop after merge | "merge pr, delete branch and worktree" | Add worktree+branch cleanup to the definition of done |

Quality bars the AI imposed on itself (worth keeping): surfacing a spec-vs-CLI
evidence table before coding; mapping test blast-radius before rewriting; reverting
the unrelated machine-specific `.pi/settings.json` rewrite before committing.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session. Two general-purpose subagents were
spawned for `docs/` writes ("Update docs for openspec local derivation change" and
"Fix two CodeRabbit docs issues"), each carrying the caveman-style rule verbatim —
the correct pattern per the Documentation Update Protocol (main agent orchestrates,
never edits `docs/` prose directly).

Recommended skill to create: **"measure-cli-before-deriving"** — a procedure that,
whenever a change claims to replace a CLI call with local derivation, first probes
the real CLI across all inputs, decodes its true state machine, and reconciles the
spec against reality *before* implementing. This session proved that step catches
a 70/71 spec error that would otherwise ship.

## 7. Pitfalls & dead ends

- **Trusting the spec's derivation rule.** The design said `tasks:done` iff all
  checkboxes ticked; the real CLI keys it to `totalTasks > 0`. Always measure.
- **Stale shared package in a worktree.** Mocks that spread `...actual` "lose" a new
  export when `node_modules/@blackbelt-technology/shared` resolves to the main repo.
  Fix: `npm install` inside the worktree. Verify with `readlink -f`.
- **Old-contract tests fail loudly and legitimately.** ~17 directory-service tests
  asserted per-change status spawns; the change removes them. Rewrite spawn-count
  assertions, keep outcome assertions — don't delete the safety-critical TOCTOU tests.
- **Full-suite flakes are not your bug.** health/shutdown/doctor/model-proxy/
  image-fit/session-card failures were load-induced (port binding, native image,
  timing); all passed in isolation and on the CI runner.
- **Machine-specific `.pi/settings.json` rewrite.** Tooling rewrote it to an absolute
  path; `git checkout .pi/settings.json` before staging.
- **`gh pr merge --delete-branch` "git error" is benign.** It's only the local
  post-merge `checkout develop` failing (develop is in the main worktree); the remote
  merge succeeded — finish branch/worktree deletion manually.
- **CodeRabbit false positive:** "move change out of `openspec/changes/archive/`" —
  that IS the CLI's designed final location; skip with a stated reason.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-apply-change <change-name>`
- [ ] Probe real CLI (`openspec status/list --json`) across **all** changes; decode
      the true state machine; reconcile spec if it disagrees (get approval).
- [ ] Fix `design.md`/`tasks.md` first, then implement the probe-injected pure helper.
- [ ] Wire into the `force === false` poll path only; keep force-refresh on the CLI.
- [ ] Add a repo-wide parity test (derive == build(runStatus)).
- [ ] `npm install` in the worktree; `npm test 2>&1 | tee /tmp/pi-test.log`.
- [ ] Rewrite old-contract spawn-count assertions; verify flakes pass in isolation.
- [ ] Delegate `docs/` writes to a subagent (caveman rule verbatim); `tsc --noEmit`.
- [ ] archive → commit (revert `.pi/settings.json`) → push → `gh pr create`.
- [ ] Poll `gh pr checks`; fix CodeRabbit; re-push; squash-merge; delete branch + worktree.

Key inputs to have ready: a specified OpenSpec change, `gh` auth, a clean worktree,
and access to the real `openspec` CLI. Final artifacts: PR #109 (merged squash
`704c2be7`), the `deriveArtifactStatus` helper + parity test, and the archived change.

---

_Generated from session `019ec38c` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/os-optimize-openspec-poll-derive-artifacts-locally` · 2026-06-14. Source extract: session facts sheet._

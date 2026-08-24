---
session: 019f2eab
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts); large facts sheet (~12901 tok)"
upgrade_status: pending
openspec_changes: [reopen-sessions-after-shutdown, directory-settings-tree-and-resize, register-plugin-automation-events]
proposal_excerpt: "When a user's machine shuts down or crashes while pi sessions are running, those working sessions are silently lost — on next launch the dashboard shows no indication they existed, and the user must hunt through ~/.p…"
---

# How we did it: doubt-review → land the `reopen-sessions-after-shutdown` change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with two words: **`doubt review`**. The real objective, clarified
by the five steering turns that followed, was the full last mile of an OpenSpec change:
**run an adversarial in-flight review of the `reopen-sessions-after-shutdown`
implementation, fix whatever it surfaces, then actually ship the change** — reconcile a
stale PR, rebase 59 commits of drift onto `develop`, drop an unrelated bundled change,
survive a red CI caused by a *pre-existing develop breakage*, wait it out, and
squash-merge cleanly. It ran across two machines and ~32 hours of wall-clock, but the
active work is a tight doubt-review → fix → rebase → ship pipeline.

## 2. TL;DR playbook

1. **Kick off with `doubt review`** while sitting in the change's worktree — the AI
   loads `doubt-driven-review`, reads the change artifacts + the real diff, and isolates
   *this change's* contribution against its **merge-base** (not vs `develop`, which is
   polluted by drift).
2. **Verify the load-bearing claim first.** Before spawning any reviewer, the AI
   checked the one docstring assertion the whole design rests on (does a clean pi-TUI
   quit persist `status:"ended"`?) by tracing `unregister()` → `onChange` → debounced
   `save()`.
3. **Attempt a fresh-context adversarial reviewer**, but treat empty output as a
   *surfaced failure*, not a pass. When the subagent + both cross-model CLIs
   (`gemini`, `codex`) turn out broken, say so explicitly and fall back to a
   single-model analysis where **every finding is traced to `file:line`**.
4. **Fix the real finding, document the trade-off.** Finding A (a liveness guard never
   reset → resumed-then-crashed sessions wrongly excluded) got a one-line code fix +
   a targeted test; Finding B (a bounded false-positive window) got documented in
   `design.md` Risks.
5. **Reconcile the PR before touching git history** — `there is related PR. Check the
   code and task list`. The AI found a duplicate change dir, a bundled unrelated change,
   and 6 "unchecked" tasks that were actually deliberate SKIP/DEFER triage notes.
6. **`rebase to develop`** — accept `develop`'s deletions for retired files, keep
   `develop`'s refactored import blocks and inject only the change-specific symbols,
   drop the bundled unrelated commit with `git rebase --onto`.
7. **`use ship-change skill`** to drive the verify-gate → CI-watch → CodeRabbit →
   squash-merge pipeline; **STOP** at red CI when the failure is proven inherited from
   `develop`, and post a hold note on the PR.
8. **Resume when the base fix lands.** `Pull` from the other machine, rebase onto the
   `develop` commit that carries the CI fix (`#248`), confirm the blocking tests go
   green **in-tree**, force-push, watch CI, resolve the last CodeRabbit thread, squash-merge.

## 3. How the collaboration unfolded

**Phase 1 — Doubt review (scope isolation + claim verification).** The AI loaded
`doubt-driven-review`, but the first non-trivial move was refusing to trust the raw
`git diff vs develop` (dominated by branch drift). It re-based the diff on the
**merge-base** to see only what the change actually added, then singled out the one
load-bearing docstring claim and verified it against real code paths before forming any
hypothesis. *Why it worked:* it separated signal (this change) from noise (drift) and
grounded the CLAIM in evidence, not the design's own prose.

**Phase 2 — Cross-model attempt that honestly failed.** The skill demands a
*different-architecture* reviewer. The AI tried three channels — a `@fast`
DeepSeek subagent (empty output), the `gemini` CLI (broken dyld/libsimdjson load), and
`codex` (401 + resolved to the wrong model). It **surfaced every failure in a table**
rather than silently proceeding, then continued single-model with `file:line` evidence
for each finding. *Decision point:* the human's `go on` authorized proceeding without
the independent second opinion.

**Phase 3 — Fix + document.** Finding A got a surgical fix
(`stampedLiveEpoch.delete(sessionId)` on `session_register`) proven by
`liveness-stamp-wiring.test.ts` (3 passed). Finding B was documented in the **canonical
archived** `design.md`. Along the way the AI hit `isRecoveryCandidate is not a function`
in local tests, correctly diagnosed it as a **worktree resolution artifact** (the
worktree resolves `pi-dashboard-shared` to the parent checkout, which lacks the new
export) — *not* its own regression — and stopped itself from "drifting into test-infra
archaeology."

**Phase 4 — PR reconciliation.** Prompted by `there is related PR`, the AI mapped the
messy reality: the change lived in *two* dirs (stray active + archived canonical), the
PR bundled an unrelated `register-plugin-automation-events` change, and the 6 unchecked
tasks were deliberate SKIP/DEFER notes. It deleted the duplicate, consolidated on the
archived copy, and committed only the doubt-review changes.

**Phase 5 — Rebase.** 15 ahead / 59 behind → 7 ahead / 0 behind. The recurring conflict
class was import-block conflicts (feature commit predates `develop`'s refactors) and
modify/delete on retired `docs/file-index-*.md`. The AI kept `develop`'s structure and
injected only the change-specific symbols, letting 3 obsolete docs-only commits drop.

**Phase 6 — Ship, stop, resume.** `use ship-change skill` drove the pipeline. CI went
red on 3 `event-reducer` tests — the AI proved its `event-reducer.ts` + tests were
**byte-identical to develop**, identified the failure as `develop`'s tracked
`double-thinking-row-on-replay` breakage, and **stopped per the guardrail** with a hold
note on the PR. ~6h later, `Pull` brought the other machine's develop-merge; the AI
rebased onto `develop`'s `#248` fix, confirmed 39/39 green in-tree, watched CI to green,
re-validated the last CodeRabbit thread as a false positive, and squash-merged
(SHA `72644b2ac`), then force-removed the worktree it was living in.

## 4. Prompts that worked

- **The goal prompt — `doubt review`.** Terse but effective *because the AI was already
  in the change's worktree* and the `doubt-driven-review` skill supplied the whole
  procedure. A stronger, self-contained version: *"Run doubt-driven-review on the
  reopen-sessions-after-shutdown change in this worktree; isolate this change's diff
  against its merge-base, verify the load-bearing claims against real code, and give me
  findings traced to file:line."*
- **`there is related PR. Check the code and task list`** — high-leverage: it redirected
  the AI from pure review into PR/state reconciliation and surfaced the duplicate-dir +
  bundled-change mess before any history rewrite.
- **`rebase to develop`** and **`use ship-change skill`** — each a 3–4 word prompt that
  unlocked a large, well-defined skill-driven workflow. This is the pattern: keep the
  change *in a worktree with a loaded skill*, then drive it with short verb prompts.
- **`In other machine this branch updated. Pull`** — the right instinct: it made the AI
  check for divergence *before* pulling, avoiding a bad merge over its own force-push.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the doubt review as the whole job | `there is related PR. Check the code and task list` | State up front that a doubt review of a mid-flight change must also reconcile the PR + task list |
| Pause after review instead of landing | `rebase to develop` → `use ship-change skill` | Say "review, then rebase and ship via ship-change" in the goal prompt |
| Risk a naive pull that clobbers a local force-push | `In other machine… Pull` (AI then checked divergence) | Always `git fetch` + check `rev-list --left-right` before pulling a cross-machine branch |
| Drift into test-infra archaeology on a red local test | (self-corrected) run the sanctioned `npm test` harness | Trust CI as authoritative in a worktree with no local `node_modules` scope; don't chase worktree-resolution noise |
| Want to proceed despite a failed cross-model review | `go on` | Accept single-model findings only when each is traced to `file:line` and the cross-model failure is surfaced |

The defining quality bar the human implicitly enforced: **never merge over red CI, even
when you're confident it's not your fault** — the AI proved the failure was inherited,
posted a hold, and waited for the base fix instead of forcing through.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session; the work was driven entirely by
**existing** skills, which is itself the lesson:

- **`doubt-driven-review`** — supplied the CLAIM/ARTIFACT/CONTRACT structure, the
  fresh-context-reviewer requirement, and the "surface cross-model failures, don't
  swallow them" rule. Invoke it on any irreversible/high-stakes change *before* it lands.
- **`ship-change`** — owns the verify-gate → CI-watch → CodeRabbit → squash-merge
  pipeline, including the "never merge over red CI" STOP condition that saved this
  session from shipping onto a broken base. Invoke it once a change is implemented and
  the PR is open.

*Worth creating:* a small memory/skill capturing the **worktree shared-package
resolution gotcha** (`isRecoveryCandidate is not a function` = worktree resolves
`pi-dashboard-shared` to the parent checkout; CI is authoritative, local vitest isn't).
It cost real time to diagnose here and will recur for any new export in a worktree.

## 7. Pitfalls & dead ends

- **Cross-model review is fragile.** All three channels failed: `@fast` DeepSeek
  subagent returned empty, `gemini` CLI had a broken binary (dyld/libsimdjson), `codex`
  gave 401 and resolved to the wrong model. *If you hit this:* surface it in a table,
  proceed single-model, and trace every finding to `file:line` — don't pretend a review
  happened.
- **Local vitest lies in a worktree.** `isRecoveryCandidate is not a function` and 30
  local failures were all environmental — the worktree resolves the shared package to
  the parent checkout. *Do:* run the sanctioned `npm test` harness, and treat CI (clean
  checkout) as the authoritative gate.
- **Red CI that isn't yours.** 3 `event-reducer` tests failed on a `develop` breakage
  (`double-thinking-row-on-replay`). *Do:* diff your files vs `develop` to prove
  byte-identity, then STOP and post a hold note rather than forcing through.
- **Bundled unrelated change.** The branch's oldest commit dragged in an unrelated
  archived-elsewhere change. *Do:* `git rebase --onto origin/develop <bundle-commit>` to
  surgically drop it once you've confirmed no in-scope commit touches those paths.
- **`--delete-branch` from inside the worktree.** The squash-merge succeeded but the
  branch/worktree cleanup hit the documented collision. *Do:* finish worktree removal
  from the **parent** repo (`git worktree remove --force`) and expect the session's cwd
  to go invalid afterward.
- **Cross-machine pull after a force-push.** *Do:* `git fetch` + `git rev-list
  --left-right --count origin/develop...HEAD` before pulling; a fast-forward is safe, a
  divergence needs care.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the change's worktree checked out, `gh` authenticated, the
`doubt-driven-review` + `ship-change` skills available, a mental note that local vitest
is unreliable in worktrees.

- [ ] From the worktree: `doubt review` → isolate the diff against the **merge-base**.
- [ ] Verify the design's load-bearing claim against real code before spawning a reviewer.
- [ ] Attempt a fresh-context / cross-model review; if it fails, surface it and go
      single-model with `file:line` evidence.
- [ ] Fix actionable findings + document trade-offs in `design.md` Risks; add a test.
- [ ] `Check the code and task list` — reconcile duplicate dirs, bundled changes, and
      SKIP/DEFER tasks before rewriting history.
- [ ] `rebase to develop` — accept deletions for retired files, keep `develop`'s import
      blocks + inject only change-specific symbols, `--onto` to drop bundled commits.
- [ ] `use ship-change skill`; if CI is red, prove byte-identity vs `develop`, STOP,
      post a hold note.
- [ ] When the base fix lands: `Pull` (check divergence first) → rebase onto the fix
      commit → confirm blockers green in-tree → force-push → watch CI → resolve
      CodeRabbit → `gh pr merge --squash --delete-branch`.
- [ ] Clean up the worktree from the **parent** repo.

**Final artifacts:** PR #210 squash-merged to `develop` (SHA
`72644b2ac092e78adee8ec3061272ff05985a55e`); the C3 liveness-guard fix in
`event-wiring.ts`; the Finding-B risk note in the archived `design.md`; the duplicate
active change dir and the bundled `register-plugin-automation-events` commit removed.

---

_Generated from session `019f2eab` · `pi-agent-dashboard` · 2026-07-06. Source extract: `/tmp/session_facts_96450_10272.md`._

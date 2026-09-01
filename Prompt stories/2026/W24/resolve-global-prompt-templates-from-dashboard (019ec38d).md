---
session: 019ec38d
week: 2026/W24
type: other
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [resolve-global-prompt-templates-from-dashboard]
proposal_excerpt: "Two leftover fixes from the now-archived `fix-slash-dispatch-delivery` change. Its Issues 1 & 2 (delivery param, Path D error feedback) already landed; these two did not."
---

# How we did it: Is it *actually* implemented? — verifying, archiving, and shipping a stalled OpenSpec change

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with two words: **"Is it implemented?"** — asked from inside a
worktree named `os-resolve-global-prompt-templates-from-dashboard` whose `tasks.md`
checkboxes were all still `[ ]`. The real objective, which only emerged as the operator
steered, was: **confirm whether the two leftover fixes from that OpenSpec change had
actually landed in the code (regardless of unticked boxes), prove it with tests, then
formally close the change out** — update `tasks.md`, archive it, ship the archive as a
PR, merge, and tear down the worktree. In short: *reconcile a stalled bookkeeping trail
with the real state of the code, then finish the paperwork.*

## 2. TL;DR playbook

1. **Ask "is it implemented?" and make the AI verify against code, not checkboxes.** The
   `tasks.md` boxes lied; the code was already done. Have the AI grep the two target
   source files (`prompt-expander.ts`, `bridge-context.ts`) for the specific changes.
2. **Run the change's own tests in isolation first**, with an ephemeral HOME:
   `HOME=$(mktemp -d) npx vitest run <the-two-test-files>`. Confirm they're green (43/43).
3. **Say "full test"** to force a whole-suite run — then make the AI *classify* every
   failure as environmental/unrelated vs a real regression before believing it.
4. **Re-run any suspicious failing packages in isolation** to prove they're flaky, not
   caused by this change (93/93 passed clean).
5. **Have the AI tick `tasks.md` truthfully** — check the done items, leave genuinely
   un-run items (`reload:check`, manual smoke) unticked. Do NOT check what wasn't run.
6. **Run `/skill:openspec-archive-change <name>`** to follow the correct archive
   procedure (delta-spec sync assessment → subagent sync → archive move).
7. **Discover the code already shipped separately** (`origin/develop..HEAD` empty → the
   fix merged via an earlier PR). Ship only the archive move as a new docs-only PR.
8. **"merge pr, delete branch and delete worktree"** — merge, delete the remote branch
   manually (gh's auto-delete fails when `develop` is checked out in the main worktree),
   `git worktree remove --force` (worktree dirty with a local `.pi/settings.json` edit).

## 3. How the collaboration unfolded

**Phase 1 — Discovery: checkboxes vs reality.** The AI correctly refused to trust the
unticked `tasks.md`. It read the change's tasks, then grepped the two implementation
files and found both fixes present: the `source: "prompt"` probe in `resolveTemplate`
(prompt-expander.ts) and the `hasDispatchCommand` getter/Proxy fallback
(bridge-context.ts). **Why it worked:** verifying against source, not bookkeeping, caught
the true state — the code was done, only the paperwork was stale.

**Phase 2 — Verify (targeted).** The AI ran the two relevant test files. First run hit a
test-isolation guard; it retried with `HOME=$(mktemp -d)` and got 43/43 green.

**Phase 3 — Verify (full suite).** On the operator's "full test", the whole suite ran:
7528 passed, 28 failed. The high-leverage move was **not** panicking at 28 reds — the AI
classified them: 16 `pi-image-fit` (a `JimpMime` jimp dependency issue), 10
`pi-dashboard-server` (5000ms timeouts under a 306s heavy parallel run), 2 extension
tests that **passed 93/93 when re-run in isolation**. None touched the two changed files.
Verdict: implemented and green; all failures environmental.

**Phase 4 — Truthful bookkeeping.** The AI ticked §1/§2 and 3.1 (with a note recording
the full-test result) but caught itself accidentally checking 3.2/3.3 — `reload:check`
and the manual `/session-summary` smoke, neither of which was actually run — and reverted
those. Decision point: the operator accepted archiving with those two genuinely-incomplete.

**Phase 5 — Archive.** `/skill:openspec-archive-change` drove the procedure: delta-spec
sync assessment (both MODIFIED requirements already byte-identical in the main spec — a
no-op), delegated to a subagent, then the archive move into
`archive/2026-06-14-resolve-global-prompt-templates-from-dashboard/`.

**Phase 6 — Ship & teardown.** The key finding: `git log origin/develop..HEAD` was empty
— the implementation had **already merged via PR #104**. So the only thing left to ship
was the archive move. The AI created a branch, staged the renames (excluding the local
`.pi/settings.json` machine-path edit), opened PR #111 `[ci skip]`, merged it, deleted the
remote branch by hand, and force-removed the dirty worktree.

## 4. Prompts that worked

- **"Is it implemented?"** (goal) — deceptively terse but effective *because the AI
  interpreted it against the worktree context* and verified code over checkboxes. A
  stronger explicit version: *"The tasks.md boxes are unticked — check whether the code
  actually landed in the two target files and prove it with the change's tests."*
- **"full test"** — a two-word unlock that forced whole-suite verification instead of
  trusting the targeted green. High leverage: it surfaced the 28 environmental failures
  that then got correctly triaged.
- **"/skill:openspec-archive-change <name>"** — invoking the skill by name pulled in the
  correct multi-step archive procedure rather than an ad-hoc `mv`.
- **"create new PR"** then **"merge pr, delete branch and delete worktree"** — crisp,
  sequential shipping commands. Each maps to one concrete state transition.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at "targeted tests green" | "full test" | State up front: verify with the whole suite, then triage failures by relatedness. |
| Almost tick `tasks.md` items that were never run (3.2/3.3) | Implicit accuracy bar; the AI self-corrected | Rule: only check a box for work *actually executed here*; note un-run items explicitly. |
| Treat 28 suite failures as blocking | (AI classified them itself) | Pre-state: "classify each failure as environmental vs regression before concluding." |
| Assume the branch still needs the code shipped | (AI found `origin/develop..HEAD` empty) | Always diff against base before opening a PR — the fix may already be merged. |
| Leave the local `.pi/settings.json` edit staged | — (AI excluded it) | Never commit machine-path `.pi/settings.json` edits; leave unstaged. |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this was an *application* of existing ones:

- **`openspec-archive-change` skill** — captures the correct archive sequence (delta-spec
  sync assessment → subagent sync → archive move + confirmation on incomplete tasks). Use
  it whenever closing an OpenSpec change so the specs stay in sync and the archive lands in
  the dated folder. It removes hand-rolled `mv` mistakes and enforces the "confirm before
  archiving with incomplete tasks" gate.
- **`general-purpose` subagent (delta-spec sync)** — isolated the "are the delta
  requirements already in the main spec?" check. Effective because it's self-contained and
  keeps the diffing noise out of the main context.

**Recommended skill to create:** a *"verify-then-archive a stalled change"* playbook —
grep code for the claimed fixes, run the change's own tests with ephemeral HOME, triage
the full suite, truthfully tick tasks, then archive+ship. This exact sequence recurs.

## 7. Pitfalls & dead ends

- **Test-isolation guard fails without a clean HOME** → prefix vitest with
  `HOME=$(mktemp -d)`.
- **28 whole-suite failures that aren't yours** → re-run the suspect packages in isolation;
  `pi-image-fit`'s `JimpMime` issue and server 5000ms timeouts under heavy parallel load
  are environmental, not regressions.
- **Accidentally ticking un-run tasks** → re-read `tasks.md` after editing; only check what
  actually ran.
- **`gh pr merge --delete-branch` fails to delete the branch** when `develop` is checked
  out in the main worktree → delete the remote branch manually:
  `git push origin --delete <branch>`.
- **`git worktree remove` refuses on a dirty tree** (local `.pi/settings.json` edit) → use
  `--force`, and never commit that machine-path file.
- **Opening a PR for code that's already merged** → check `git log origin/develop..HEAD`
  first; here it was empty (code shipped via PR #104), so only the archive move needed a PR.

## 8. Reproduce it faster — checklist

- [ ] Grep the target source files for the claimed fixes — trust code, not `tasks.md`.
- [ ] Run the change's own tests: `HOME=$(mktemp -d) npx vitest run <files>` → expect green.
- [ ] Run the full suite; classify every failure as environmental vs regression.
- [ ] Re-run suspect packages in isolation to confirm flakiness.
- [ ] Tick `tasks.md` truthfully — done items only; leave genuinely un-run items unticked.
- [ ] `/skill:openspec-archive-change <name>` (delta sync → subagent → archive move).
- [ ] `git log origin/develop..HEAD` — if empty, ship only the archive move.
- [ ] PR (docs-only, `[ci skip]`) excluding `.pi/settings.json`; merge; delete remote
      branch manually; `git worktree remove --force`.

**Key inputs:** the worktree + OpenSpec change name; `gh` auth; the two target source
files. **Artifacts produced:** updated `tasks.md`; archived change under
`openspec/changes/archive/2026-06-14-resolve-global-prompt-templates-from-dashboard/`;
merged PR #111; torn-down worktree + branches.

---

_Generated from session `019ec38d-d099-7da8-bf9e-5b479fc035be` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-14. Source extract: deterministic facts sheet._

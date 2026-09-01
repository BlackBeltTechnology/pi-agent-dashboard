---
session: 019f09aa
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-worktree-link-origin, git-root-file-containment]
proposal_excerpt: "Follow-up to `git-root-file-containment` (see its **Out of Scope** note). That change *legalized* worktree sessions reading parent-tree files, but did not fix the underlying **link-origin defect** it exposed:"
---

# How we did it: git-root-file-containment — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single skill invocation:

```
/skill:openspec-apply-change git-root-file-containment
```

The real objective: implement a spec-driven OpenSpec change that **widens the
file-read containment guard** in the dashboard server from a hand-rolled
`resolved.startsWith(cwd + sep)` check to a shared, layered helper. Layer ① keeps the
existing logical `within(cwd)` fast path (no subprocess), and layer ② adds a
`realpath`'d `within(gitRoot)` widening so worktree sessions can legitimately read
parent-tree files — symlink-safe and **fail-closed** to `cwd` on any git error. Then
two follow-up prompts drove it all the way to landed: run CodeRabbit, then commit and
ship the change end-to-end (PR → CI → review → squash-merge). The session ran entirely
inside a `.worktrees/os-git-root-file-containment` checkout on `opus-4` at medium
thinking.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — let the apply skill read the change's
   context files, task list, and design decisions (D-numbers) before writing code.
2. Build the shared helper first (`path-containment.ts`: `within`, `gitRoot`,
   `isAllowed`), then its unit test, and run **only that test** to validate before
   wiring any routes.
3. Wire every production guard site through the helper (`file-routes.ts`,
   `system-routes.ts`), preserving each route's exact error strings.
4. `grep -rn "startsWith(cwd"` to prove no hand-rolled guard remains — and classify
   each remaining hit (session-matching vs. containment) so you don't "fix" the wrong one.
5. Type-check + run the touched package in isolation; separate **pre-existing**
   failures (here: `image-fit-extension` Jimp breakage) from anything your diff caused.
6. `run coderabbit` — triage each finding against the approved design's D-numbers;
   fix the ones that are real (missing git timeout, bare-repo over-widening), skip the
   ones the threat model already covers (TOCTOU on localhost), and say *why*.
7. `commit and use ship-change skill` — archive+sync specs, open PR against `develop`,
   watch CI, drain CodeRabbit threads, squash-merge, remove the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Apply (discovery + implement).** The apply skill loaded the change's status
(`ready, 0/13`), read all context files, and examined the current guard sites. The AI
built the helper, wrote its unit test, and ran *just that test* first — catching a
wrong test assumption (a symlink *inside* cwd correctly passes layer ① by design D3; the
layer-② symlink guard only fires when a path misses cwd but appears under the git root).
It fixed the test, not the helper. Then it wired the two route files and grepped for
leftover `startsWith(cwd` guards, correctly classifying `pi-gateway.ts` /
`session-meta-handler.ts` as session-matching (not containment) and leaving them alone.

**Phase 2 — Debug the exec wrapper.** The `no-direct-child-process` lint test flagged the
helper's `node:child_process` import. Switching to the platform `execFileAsync` wrapper
*regressed* the helper. Root cause (found via a throwaway debug vitest): the wrapper is a
plain `promisify` of a custom `execFile` **lacking the `util.promisify.custom` symbol**,
so it resolves with the bare stdout string, not `{stdout, stderr}` — the typed return is
a lie. Precedent `pi-core-checker.ts` uses node's real `execFile` + a
`// ban:child_process-ok` opt-out marker. The AI followed that precedent, and all 39
helper tests passed.

**Phase 3 — CodeRabbit triage.** `run coderabbit` surfaced 4 findings but the CLI got
rate-limited on the second invocation. The AI **recovered the real findings from the
local review cache** (`~/.coderabbit/reviews/<id>/…/*.json`), disambiguating its review
dir from another worktree's by grepping for `path-containment`. It fixed the valid one
(git probe had no timeout → added `{ timeout: 2_000, windowsHide: true }`) and
explicitly skipped three with design-anchored rationale (D3 layer-① logical check;
TOCTOU outside the localhost/single-user threat model).

**Phase 4 — Ship.** The ship-change skill archived + synced the delta spec into a new
`file-read-containment` capability, opened **PR #176** against `develop`, watched CI
green twice (~7m47s each), and drained CodeRabbit. The PR's *second* review was real (5
actionable) — the AI applied 3 more spec-aligned fixes (bare-repo/submodule
over-widening, relative-probe leak against server cwd, Windows drive-case via
`path.relative`), re-pushed, confirmed 0 actionable threads, and squash-merged.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change git-root-file-containment`.** Effective
  because it hands the AI a spec with numbered design decisions (D1–D7) and a task list;
  the AI cites D-numbers when defending choices later, which is exactly what makes the
  CodeRabbit triage crisp.
- **`run coderabbit`** — a two-word follow-up that unlocked the whole review-and-fix
  loop. High leverage: it forces an external adversarial pass before the PR exists.
- **`commit and use ship-change skill`** — one prompt that carried the change through
  archive → PR → CI → review → merge → worktree cleanup. The skill encodes every step so
  the operator doesn't re-specify them.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementing the code | `run coderabbit` | Make the review gate an explicit task in the apply skill's task list |
| Stop after the review triage | `commit and use ship-change skill` | Chain apply → review → ship as one instruction up front |
| Trust the typed `{stdout,stderr}` return of the platform exec wrapper | (self-corrected via debug test) | Remember: the wrapper lacks `util.promisify.custom`; use node's real `execFile` + `// ban:child_process-ok` |

The steering here was minimal (3 prompts) but each moved the work a full stage. The AI's
own self-corrections (test assumption, exec wrapper, review-cache recovery) did the heavy
lifting — a strong signal that a well-scoped OpenSpec change + skill chain needs little
human redirection.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work rode three existing skills
(`openspec-apply-change`, `coderabbit` via the implement skill's `review-changes.ts`,
`ship-change`) and one subagent spawn (`general-purpose`, to add `docs/file-index-*`
rows for the new server files under the caveman-style doc rule).

**What *should* be captured** as a project memory (recurring, non-obvious):

- **The platform `execFileAsync` lie.** `packages/shared/src/platform/exec.ts` exports a
  typed `{stdout,stderr}` promise, but it's a plain `promisify` of a custom `execFile`
  with **no `util.promisify.custom` symbol**, so it actually resolves with the bare
  stdout string. For any code that needs `{stdout,stderr}`, follow the `pi-core-checker.ts`
  precedent: node's real `execFile` + a `// ban:child_process-ok` marker to pass the
  `no-direct-child-process` lint.
- **CodeRabbit rate-limit recovery.** When `coderabbit review` is rate-limited on a repeat
  run, the real findings are cached under `~/.coderabbit/reviews/<id>/…/*.json`. Grep for
  a symbol from your diff to find *your* review dir (the cache is shared across worktrees).

## 7. Pitfalls & dead ends

- **Worktree has no local `node_modules`.** `npx vitest` pulled a *different* vitest
  missing `jsdom`, causing fork-worker crashes and misleading "334 errors". Fix: run the
  **parent** repo's binary directly (`node_modules/vitest/vitest.mjs`) with the same
  `HOME=$(mktemp -d)` isolation the npm script uses.
- **`doctor-route.test.ts` "timeout in 5000ms".** A pre-existing *load flake* — the test
  spawns binary-detection subprocesses that starve under 374-file concurrent load. Passes
  14/14 in isolation. Don't chase it; confirm in isolation and move on.
- **`image-fit-extension` failures (17).** Pre-existing Jimp-constructor breakage on
  `develop`, unrelated to any server change. Always diff against base before blaming your
  diff.
- **`openspec change new` has no scaffold subcommand.** Change artifacts are authored
  directly (write `proposal.md` by hand).
- **`gh pr merge --delete-branch` collides with the parent worktree.** It tries to
  checkout `develop` locally, which is already checked out in the parent — the remote
  merge succeeds but local cleanup fails. Delete the remote branch, then remove the
  worktree from the **parent** checkout, then `git -C <parent> branch -D <branch>`.
- **Don't run the final cleanup from inside the worktree you're deleting.** The shell's
  cwd vanishes and the harness can't exec bash. Anchor to the parent repo (`git -C`) for
  teardown.

## 8. Reproduce it faster — checklist

- [ ] Have the OpenSpec change ready with numbered design decisions (D1–D7) and a task list.
- [ ] `/skill:openspec-apply-change <change>` — implement helper → its test (run
      isolated) → wire routes → grep for stale guards.
- [ ] Use node's real `execFile` + `// ban:child_process-ok` when you need
      `{stdout,stderr}` (the platform wrapper returns bare stdout).
- [ ] Type-check + run the touched package in isolation; separate pre-existing failures
      from yours.
- [ ] `run coderabbit`; triage each finding against the design's D-numbers; recover from
      `~/.coderabbit/reviews/*` if rate-limited.
- [ ] `commit and use ship-change skill`; watch CI, drain review threads, squash-merge.
- [ ] Do worktree/branch teardown from the **parent** repo (`git -C <parent>`).

**Key inputs:** the OpenSpec change dir, CodeRabbit CLI + quota, a `develop` branch to PR
against.
**Artifacts produced:** `packages/server/src/lib/path-containment.ts` (+ its
`__tests__`), rewired `file-routes.ts` / `system-routes.ts`, new
`openspec/specs/file-read-containment/spec.md` capability, follow-up proposal
`openspec/changes/fix-worktree-link-origin/proposal.md`, and merged **PR #176** (squash
commit `f3f7a24e`).

---

_Generated from session `019f09aa` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/os-git-root-file-containment` · 2026-06-27. Source extract: session facts sheet (git-root-file-containment)._

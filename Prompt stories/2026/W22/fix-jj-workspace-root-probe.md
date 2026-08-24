---
session: 019e6c26
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [fix-jj-workspace-root-probe]
---

# How we did it: Fix a red CI lint on the jj-workspace-root probe test — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was terse: **"Fix tests which error on CI."** No file, no error text, no
branch — just a red pipeline. The *real* objective, once the AI pulled the failing
run, was narrower than "fix tests": CI died at the **lint step** (`tsc --noEmit`),
not at runtime. A single type mismatch (TS2322) in
`packages/extension/src/__tests__/vcs-info-jj-probe.test.ts` was failing the build:
a helper declared `string | undefined` but the tool registry hands back
`string | null`. The full arc: diagnose → one-line type fix → push (force-with-lease
over a rebased branch) → confirm green → archive the OpenSpec change → sync the spec →
commit + push.

## 2. TL;DR playbook

1. **Read the actual failure first.** `gh run list --branch <branch> --limit 5`, then
   `gh run view <id> --log-failed | tail -200`. Don't guess — CI told us it was a lint
   error, not a test failure.
2. **Reproduce the exact CI gate locally**, not just the tests:
   `npx tsc --noEmit` (the failing step) **and** `npx vitest run <testfile>`.
3. **Make the minimal type fix** — coalesce `null → undefined` (`res.path ?? undefined`)
   at both call sites, matching the helper's declared return type.
4. **Re-run both gates locally**; also run tests under a clean `HOME=$(mktemp -d)` to
   catch env-leak (jj/git config) flakiness.
5. **Push.** If the branch was rebased onto develop (same commits, new SHAs), a plain
   push is rejected → `git push --force-with-lease`.
6. **Confirm green without babysitting:** `gh run view <id> --json status,conclusion,url`.
   CI often already finished — check state instead of streaming logs.
7. **Archive the OpenSpec change** via `/skill:openspec-archive-change <name>`; accept
   the incomplete *manual smoke-test* tasks explicitly, sync the delta spec into the
   main spec, `openspec validate --strict`, then commit + push.

## 3. How the collaboration unfolded

**Phase 1 — Diagnose (don't assume).** The AI resisted the temptation to open the test
and start editing. It listed CI runs, pulled the failing job log, and read the real
error: `TS2322` at `vcs-info-jj-probe.test.ts:32`. That reframed "fix tests" into "fix
a type mismatch at the lint gate." *Decision point:* the human's vague ask was
sharpened by evidence, not by asking a clarifying question.

**Phase 2 — Fix & verify the real gate.** The AI ran `npx tsc --noEmit` (the step CI
actually ran) alongside `npx vitest run`, applied a one-line `?? undefined` coalesce in
both the `resolveJjPath` helper and the inline git resolver, and confirmed all 3 tests
pass + lint clean. It even re-ran under `HOME=$(mktemp -d)` to rule out a leaked global
jj/git config.

**Phase 3 — Push over a rebased branch.** `git push` was rejected: the local branch had
been rebased onto newer develop (identical commits, different SHAs). The AI fetched to
confirm, then used `git push --force-with-lease` — the safe force that refuses if the
remote moved unexpectedly. *Decision point:* human said "commit and push"; the AI chose
force-with-lease over `--force` on its own.

**Phase 4 — Confirm green cheaply.** Human asked "Is it possible to test with browser?"
The AI checked run state (`gh run view --json`) and found CI **already succeeded** on
the fix commit — so it offered the browser inspection but noted it was unnecessary.
Avoided a pointless live-log watch.

**Phase 5 — Archive + sync spec.** Via the archive skill, the AI moved the change to
`openspec/changes/archive/<date>-<name>/`, replaced the main `jj-workspace-plugin`
requirement body from the delta spec (an `Explore` subagent handled the sync diff),
validated strict, and committed + pushed. It surfaced (didn't hide) that 2 manual
smoke-test tasks were left unchecked and proceeded per user confirmation.

## 4. Prompts that worked

- **Goal prompt — "Fix tests which error on CI."** Weak on its own (no file, no log),
  but it worked *because the AI treated CI as the source of truth* and fetched the
  failure. A stronger version: *"CI is red on branch X — pull the failed job log,
  identify the failing step, fix it minimally, and confirm the gate goes green."*
- **"commit and push"** (×2) — high-leverage precisely because the AI had already
  staged a correct, minimal change; the terse command was enough to trigger the
  push-with-lease + CI-recheck loop.
- **"Is it possible to test with browser?"** — unlocked a status check that revealed CI
  was already green, saving effort. Reframe next time as *"is CI green yet?"*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat "fix tests" as a runtime-test problem | (self-corrected via `--log-failed`) | State up front: *"CI failed at the lint step"* when you know it |
| Stop after the local fix | "commit and push" | Include *push + confirm CI green* in the goal prompt |
| Consider streaming live CI logs | "Is it possible to test with browser?" → AI checked state instead | Ask *"is CI green?"* — query `gh run view --json`, don't watch logs |
| Leave archive/spec-sync as a separate manual chore | `/skill:openspec-archive-change <name>` | Chain archive into the same session once CI is green |

Quality bar the human implicitly imposed: **don't hand-wave — verify the exact CI gate
locally before pushing**, and **archive + sync the spec, not just fix the code.**

## 6. Skills, tools & memory created — and why they're effective

- **No new skill/memory was created** this session — existing ones carried it:
  - `/skill:openspec-archive-change` — moved the change to `archive/`, synced the delta
    spec into the main spec, validated strict. Reuse whenever a change's implementation
    is done and CI is green. It removes the manual "which files move where, and did I
    sync the spec?" bookkeeping.
  - `Explore` subagent — used to diff and sync the delta spec into the main
    `jj-workspace-plugin` spec without polluting the main context.
- **Worth saving as a memory/convention:** *"On a rebased branch, `git push` rejection
  → use `--force-with-lease` (never bare `--force`)."* and *"To confirm CI, query
  `gh run view <id> --json status,conclusion` — don't stream logs; the run is often
  already done."*

## 7. Pitfalls & dead ends

- **Blind editing without reading the CI log** — would have wasted time on the wrong
  layer (tests passed; *lint* was red). Always `gh run view --log-failed` first.
- **`git push` rejected on a rebased branch** — same commits, different SHAs. Fix:
  `git fetch` to confirm, then `git push --force-with-lease`.
- **Watching live CI logs when the run already finished** — check
  `gh run view --json status,conclusion` instead; you'll often find it's already green.
- **Archiving with unchecked tasks** — 2 manual smoke-test tasks (sidebar grouping +
  plain-git regression) stayed unchecked. Don't silently pass: surface them and get
  explicit confirmation before archiving.

## 8. Reproduce it faster — checklist

- [ ] `gh run list --branch <branch> --limit 5` → find the red run.
- [ ] `gh run view <id> --log-failed | tail -200` → read the **exact failing step**.
- [ ] Reproduce that gate locally: `npx tsc --noEmit` **and** `npx vitest run <testfile>`.
- [ ] Apply the **minimal** fix (here: `res.path ?? undefined` at both call sites).
- [ ] Re-run both gates; run tests under `HOME=$(mktemp -d)` to catch env-leak flakiness.
- [ ] `git commit` → `git push` (rejected on rebase? → `--force-with-lease`).
- [ ] `gh run view <id> --json status,conclusion,url` → confirm **green** (don't stream).
- [ ] `/skill:openspec-archive-change <name>` → sync delta spec, `openspec validate --strict`.
- [ ] `git add -A && git commit && git push` the archive.

**Inputs to have ready:** the red branch name, `gh` authenticated, the OpenSpec change
name. **Artifacts produced:** fixed
`packages/extension/src/__tests__/vcs-info-jj-probe.test.ts`, archived change at
`openspec/changes/archive/2026-05-28-fix-jj-workspace-root-probe/`, synced
`openspec/specs/jj-workspace-plugin/spec.md`.

---

_Generated from session `019e6c26-5ec9-7e32-9695-2bc7ae241e3f` · `pi-agent-dashboard` · 2026-05-28. Source extract: session facts sheet._

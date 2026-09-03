---
session: 019ec54c
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts); large facts sheet (~10564 tok)"
upgrade_status: pending
openspec_changes: [replace-proposal-dialog-with-race-handling]
proposal_excerpt: "When a session has a proposal manually attached and the LLM emits a new *active* OpenSpec change (a write under `openspec/changes/<name>/` or an `openspec` CLI invocation naming a different change), today the server s…"
---

# How we did it: Replace-proposal dialog with race handling — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change replace-proposal-dialog-with-race-handling
```

The real objective: implement a fully-specified OpenSpec change (46 tasks, spec-driven)
that adds a **three-layer race-handling model** to proposal attachment. When a session
already has a proposal manually attached and the LLM emits a *new active* OpenSpec
change, the server must coalesce that divergence into a `pendingReplaceProposal` state
(latest-wins, same-name no-op, rejected-name ignored) and surface a client dialog to
accept or dismiss the swap — rather than silently overwriting the attachment. The four
follow-up prompts drove it end-to-end: implement → archive → PR + CI → fix CodeRabbit →
merge & clean up. It touched 17 files across `shared`, `server`, and `client`, landed as
**PR #115**, and was squash-merged to `develop`.

## 2. TL;DR playbook

1. Fire `/skill:openspec-apply-change <change-name>` and let it read `tasks.md` + all context files. Confirm the change name and task count (46 tasks / spec-driven) before writing.
2. **Work in dependency order**: shared types/protocol → server logic → server tests → client dialog → client tests → docs → verification. State this plan explicitly, then execute.
3. For each layer, `grep` the union types / dispatch switches / render sites first so threading a new prop or message is exhaustive, not guesswork.
4. Run tests **from the package directory** with `export HOME=$(mktemp -d)` to isolate them: `cd packages/server && export HOME=$(mktemp -d) && npx vitest run <file>`.
5. Know the **worktree resolution trap**: the worktree has no local `node_modules`, so `tsc` resolves `shared` to the *main repo* (missing your new fields). Runtime vitest works (types erased); real type-checking must map paths to worktree-local `shared` or rely on CI.
6. Delegate every `docs/` edit to a general-purpose subagent with the caveman-style rule verbatim (per AGENTS.md).
7. Archive with `openspec archive <name> --yes`; commit, push, `gh pr create` against `develop`, then `gh run watch`.
8. When CI catches a real type error the worktree `tsc` couldn't, fix + push + re-watch. Trust CI's full-resolution tsc over local.
9. Fetch CodeRabbit threads, triage each against the actual diff (fix valid, decline invalid with rationale posted to the PR), commit, re-watch.
10. Squash-merge (repo convention), then delete remote branch + worktree + local branch **from the main repo path**, not the worktree you just deleted.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read the spec, map the code).** The AI confirmed the change
(46 tasks, 0 complete, spec-driven), read `tasks.md` and design/context files, then
`grep`ed for every symbol it would touch: the browser-message union, the gateway
dispatch switch, the `attach_proposal` wiring, the OpenSpec poll cache in
`directoryService`, and the two `<SessionOpenSpecActions>` render sites. *Why it worked:*
knowing all render/dispatch sites up front made threading the new prop and messages
exhaustive instead of iterative.

**Phase 2 — Implement in dependency order.** Shared types (`pendingReplaceProposal?: string|null`,
`rejectedReplaceProposals?: string[]`, `accept_replace_proposal`/`dismiss_replace_proposal`
messages) → server coalescing logic in `event-wiring.ts` (the spec's 4 branches, plus an
`openSpecChangeExistsInCache` helper for the deleted-proposal bypass) → accept/dismiss
handlers in `session-meta-handler.ts` wired into the gateway → client `ReplaceProposalDialog`
threaded through `SessionOpenSpecActions` → `useOpenSpecActions` → `SessionCard` →
`SessionList`/`OpenSpecBoardView` → `App`. *Decision point:* the AI simplified the dialog to a
single committed-target state that `[Use latest]` mutates, rather than dual state.

**Phase 3 — Test & verify.** 10 server tests + 8 client tests. A detach-clear change broke
4 existing detach assertions — the AI correctly identified those as *its* change (correct new
behavior) and updated them, while proving the other suite failures (image-fit jimp,
load-sensitive integration timeouts) were pre-existing by running them in isolation.

**Phase 4 — Land it (steering-driven).** Four short human prompts: `archive`, `commit + PR +
monitor CI`, `fix coderabbit issues`, `merge + delete branch + worktree`. CI caught a real type
error (a required prop that the worktree tsc missed); the AI fixed it and re-watched to green.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change replace-proposal-dialog-with-race-handling`.
  Effective because the change was already fully specified: the skill loads `tasks.md` and
  context, so the AI had an unambiguous 46-task contract to execute. A well-formed OpenSpec
  change *is* the prompt.
- **`archive the change, I will test later with other changes`** — high-leverage: it explicitly
  deferred the 3 manual smoke tests (8.3–8.5) so the AI archived with `--yes` instead of blocking.
- **`commit, create PR and monitor CI`** — one line that drove commit → push → PR → `gh run watch`
  and surfaced the real CI-only type error.
- **`fix coderabbit issues`** — triggered the autofix-skill triage loop (fix valid, decline invalid
  with rationale).
- **`merge PR, delete branch and delete worktree`** — clean end-state instruction; the AI picked
  squash (repo convention) automatically.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Consider running the 3 manual smoke tests before archiving | "archive the change, I will test later with other changes" | State up front which tasks are deferred-manual so the AI archives with `--yes` |
| Stop after implementation | "commit, create PR and monitor CI" | Include the land-it sequence (commit→PR→watch CI) in the initial ask |
| Potentially accept all CodeRabbit feedback | "fix coderabbit issues" (→ triage, not blanket-apply) | Reuse the autofix skill: fix valid, **decline invalid with a posted rationale** (declined the critical `replay_complete`-clear because pending must survive reconnect) |
| Trust local worktree `tsc` (false-clean) | CI catching the required-prop error | Rely on CI's full-resolution tsc; make new threaded props **optional** + guard call sites |

## 6. Skills, tools & memory created — and why they're effective

No new persistent skill or memory was created — the session ran on existing skills:

- **`openspec-apply-change`** — turned a 46-task spec into ordered execution. Invoke whenever a
  change has a complete `tasks.md`.
- **autofix / CodeRabbit-triage flow** — the read-threads → assess-against-diff → fix-or-decline →
  post-rationale loop. Invoke on any "fix coderabbit issues" ask; its value is refusing invalid
  suggestions with evidence rather than churning the diff.
- **Docs subagent delegation** — every `docs/` edit went to a general-purpose subagent with the
  caveman rule verbatim (AGENTS.md requirement). Two subagents ran (update file-index rows, escape
  a pipe in a row).

*Worth capturing as a skill:* the **worktree type-check reality** — worktree has no `node_modules`,
so `tsc` resolves `shared` to the main repo and misses new fields; use a temp tsconfig mapping
`shared` to worktree-local `src`, or defer real type-checking to CI.

## 7. Pitfalls & dead ends

- **Invalid test slugs.** First server tests used `"A"/"B"/"C"`; the activity detector rejects them
  (slugs must match `/^[a-z][a-z0-9-]{0,63}$/`). If a race branch "won't fire" in a test, check the
  slug validator before debugging the logic.
- **Worktree resolves `shared` to main repo.** Type-checks looked clean locally but CI failed on a
  required-prop error. If `tsc` is suspiciously green in a worktree, it's resolving the *old* shared.
- **Detach tests broke by design.** The detach-clear change legitimately broke 4 assertions — update
  them, don't revert the code. Confirm unrelated failures (image-fit jimp, integration timeouts) are
  pre-existing by running them in isolation.
- **Archive blocked by a stale delta header.** The target main spec had `## ADDED Requirements`
  (delta) where a main spec needs `## Requirements`; the surgical rename unblocked `openspec archive`.
- **Shell pinned to a deleted worktree.** After removing the worktree, the Bash tool's CWD was gone;
  run cleanup + verification **from the main repo path** (`/Users/robson/Project/pi-agent-dashboard`).
- **`.pi/settings.json` auto-rewritten by the harness** (relative `..` → absolute path) — restore it
  and exclude it from the commit; it's environment noise, not part of the change.

## 8. Reproduce it faster — checklist

- [ ] Confirm the change is fully specified (`openspec status --change <name> --json`); note task count + deferred-manual tasks.
- [ ] Implement strictly in dependency order: shared → server → server tests → client → client tests → docs → verify.
- [ ] `grep` all union types / dispatch switches / render sites before threading a new prop or message; make new props **optional** + guard call sites.
- [ ] Run tests per-package with `export HOME=$(mktemp -d)`; prove unrelated failures pre-exist by isolating them.
- [ ] Delegate `docs/` edits to a subagent with the caveman rule verbatim.
- [ ] `openspec archive <name> --yes`; fix any stale delta header (`## ADDED Requirements` → `## Requirements`) that blocks it.
- [ ] Commit (exclude harness-rewritten `.pi/settings.json`), push, `gh pr create --base develop`, `gh run watch`; trust CI's tsc over local worktree tsc.
- [ ] Triage CodeRabbit: fix valid, decline invalid with rationale posted to the PR; re-watch to green.
- [ ] Squash-merge; delete remote branch + worktree + local branch **from the main repo path**.

**Key inputs to have ready:** a complete OpenSpec `tasks.md`; `gh` authenticated; awareness of the worktree `node_modules`/tsc resolution trap.

**Final artifacts:** PR #115 (squash `5618257c` on `develop`); server logic in `event-wiring.ts` + `session-meta-handler.ts`; `ReplaceProposalDialog` client dialog; 10 server + 9 client tests; archived change `2026-06-14-replace-proposal-dialog-with-race-handling`.

---

_Generated from session `019ec54c-3605-7144-b4fc-555531ed699e` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-14. Source extract: session-to-guideline facts sheet._

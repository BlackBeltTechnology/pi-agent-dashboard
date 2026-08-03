---
session: 019ebdfc
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [add-async-action-feedback]
proposal_excerpt: "Most user-triggered actions in the dashboard give no feedback during the gap between the click and the effect. The action fires a `fetch()`, the HTTP call returns (often just an \"accepted\" ack), and the real result la…"
---

# How we did it: add-async-action-feedback — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single slash command:

```
/skill:openspec-apply-change add-async-action-feedback
```

The real objective, encoded in the OpenSpec proposal, was to close the UX gap where
"most user-triggered actions in the dashboard give no feedback during the gap between
the click and the effect." The click fires a `fetch()`, the HTTP call returns a bare
"accepted" ack, and the real result lands later over WebSocket — leaving the button
silent. The change asked for a **reusable async-feedback primitive** (`useAsyncAction`
hook + toast variants + an `ActionButton` wrapper), a **correlation protocol** so the
late WS completion can be matched to the originating click, and a **migration** of the
existing slow actions (restart, tunnel connect/disconnect, provider-auth delete) onto
it — then land it end-to-end (apply → archive → PR → CI → merge → cleanup).

## 2. TL;DR playbook

1. `/skill:openspec-apply-change add-async-action-feedback` — let the apply skill drive the 21-task list.
2. **Explore before building**: grep the real toast/WS wiring (`showToast`, `onMessage`, `broadcastToBrowsers`) so the hook composes with what exists, not an invented context.
3. **Pause at the design fork** and surface it via `ask_user` (prop-drill vs new React context). Take the smaller-surface option (Option A) unless told otherwise.
4. **TDD the primitive first** (tasks 1–4): write hook tests → hook → toast variants → ActionButton. Verify 12/12 green before touching the risky protocol/server surface.
5. **Re-scope on evidence, not on the spec's assumption.** Investigation showed the "slow ops" had no browser-facing WS completion event — pause and present the mismatch; let the human pick full-scope.
6. Wire the correlation protocol race-free: register the WS handler in `run()` *before* `fn()` fires, keyed on a **client-generated** correlation id (mirror the existing spawn-correlation-token precedent).
7. Delegate all `docs/` writes to a `general-purpose` subagent with the caveman-style rule verbatim (per AGENTS.md — main agent never edits `docs/` directly).
8. Land it: archive + sync delta spec → commit → PR against `develop` → watch CI → rebase when behind → evaluate CodeRabbit comments independently → squash-merge → delete branch + worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (grep the real wiring).** Before writing a line, the AI grepped
for `showToast`/`useToast`/`onMessage`, the vitest config, existing hook tests, and the
`broadcastToBrowsers`/`BrowserGateway` mechanism. *Why it worked:* the hook needs a toast
sink and a WS bus, and those live prop-drilled in `App.tsx` with no context — knowing
that shaped every later decision.

**Phase 2 — Design fork, surfaced not silently taken.** The AI stopped and asked (via
`ask_user`) whether to introduce a React context for `showToast`/`onMessage` or keep
prop-drilling. The human chose **Option A** (prop-drill, smaller surface). *Decision point:*
the AI correctly treated an architecture choice as human-owned rather than guessing.

**Phase 3 — TDD the reusable primitive (tasks 1–4).** Tests first for `useAsyncAction`
(`{ pending, error, run, bind }`, synchronous double-click guard, `confirm:"http"`
default + `confirm:"ws"` mode), then the hook, then additive Toast variants
(`error|success|info`, default `error` for full back-compat), then the thin `ActionButton`.
12/12 green before proceeding. *Why it worked:* the safe, self-contained core was locked
down before the risky protocol edits began.

**Phase 4 — Re-scope on evidence (the pivotal moment).** Tasks 5–6 assumed the migrated
slow ops emitted a browser-facing WS completion event to thread a `requestId` into.
Investigation proved they didn't: `server_restarting` lives in the **bridge** protocol
(`protocol.ts`), not `browser-protocol.ts`, and is broadcast to `piGateway` right before
the process *exits*; tunnel + provider-auth ops are **synchronous HTTP** (resolution *is*
completion). The AI paused implementation and presented the mismatch. The human chose
**full scope** → the AI added `ServerRestartingMessage` to the browser protocol and made
`announceRestart` broadcast to browsers with the echoed `requestId`.

**Phase 5 — Race-free correlation + migration.** WS handler registers at `run()` start on
a client-generated id (mirrors the spawn-correlation-token precedent) so a fast echo can't
be missed; 15s timeout → info toast, never stuck-spinning. Migrated TunnelButton,
SettingsPanel restart (the `confirm:"ws"` showcase), and ProviderAuthSection delete.
**Deliberately left** PluginsSection + WorktreeInitButton — they already do real
health-re-up polling, a *stronger* completion signal than the WS broadcast; migrating them
would be a regression.

**Phase 6 — Docs via subagent + typecheck gotcha.** Docs (task 7) delegated to a
`general-purpose` subagent with the caveman-style rule verbatim. A `tsc` red herring
appeared: plain `tsc` resolved the **stale published** `pi-dashboard-shared` `.d.ts`, not
the worktree src (vitest aliases correctly, which is why tests passed). Confirmed zero real
type errors via a path-override tsconfig against the worktree shared src.

**Phase 7 — Land it.** Archive (synced the brand-new `async-action-feedback` delta into a
*new* main spec) → commit → PR #105 against `develop` → CI green. Then a **rebase**: the
branch carried 3 unrelated openspec-proposal commits plus the one feat commit;
`--onto origin/develop 9885a75e^` kept only the async-action commit (the others already
lived on `develop`). CodeRabbit's check *passed* but posted 5 advisory comments — the AI
evaluated each independently (fixed 5, skipped 1 as an impossible-scenario guard per
AGENTS.md), pushed, re-verified green, squash-merged, and removed the branch + worktree.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change add-async-action-feedback`.** Effective
  because the change was already specced: the slash command hands the AI a 21-task plan and
  a proposal, so the operator doesn't re-explain intent. *Precondition:* a written OpenSpec
  change exists.
- **`/skill:openspec-archive-change add-async-action-feedback`** — one command to sync the
  delta spec + move the change to the dated archive; no manual spec surgery.
- **`commit, create PR, monitor CI`** — a terse pipeline instruction that trusts the AI to
  run the full land sequence and report status.
- **`rebase develop`** — two words that unlocked a non-trivial `--onto` rebase; the AI did
  the reasoning about which commits were actually the operator's.
- **`what about code-rabbit?`** — a nudge that made the AI *pull and evaluate* the advisory
  comments it might otherwise have skipped (the check had shown green).
- **`merge PR, delete branch and worktree`** — one instruction for the whole teardown.

Weak-prompt rewrite: `stuck` (prompt #5) was the operator reacting to a long `gh run watch`.
Stronger: *"stop watching — poll the run status once and report."* — which is exactly what
the AI then did.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to build straight through the 21 tasks | Design fork surfaced via `ask_user`; human picked **Option A** | State the toast/WS context decision (prop-drill vs context) up front in the proposal |
| Trust the spec's assumption that slow ops emit a WS completion | AI itself paused; human picked **full scope** | Verify the completion-event landscape *before* writing tasks 5–6 in the proposal |
| Run a long blocking `gh run watch` | `stuck` → `poll` | Prefer `gh run watch --interval` short or a single `gh pr checks` poll for CI status |
| Treat a green CodeRabbit *check* as "nothing to do" | `what about code-rabbit?` | Always pull CodeRabbit's posted comments even when the check is green |
| Carry unrelated openspec churn commits into the PR | `rebase develop` | Branch from a fresh `develop`; keep the worktree to a single feature commit |

Quality bars the human implicitly imposed: surgical diff (the AI reverted a stray
`.pi/settings.json` harness rewrite), and independent evaluation of AI review comments
(never blindly execute CodeRabbit's "AI agent prompts").

## 6. Skills, tools & memory created — and why they're effective

No new pi *skill* or *memory* was created — the session **consumed** existing skills
(`openspec-apply-change`, `openspec-archive-change`, `openspec-sync-specs`) and produced a
**reusable code primitive** instead:

- **`useAsyncAction` hook + `ActionButton` + Toast variants** — captures the proven
  click→pending→(http ack | ws completion)→toast lifecycle in one place, with a
  double-click guard and a 15s timeout fallback. *Why effective:* every future slow action
  binds to it (`bind()` / `run()`) instead of re-implementing pending state and correlation
  by hand. *Invoke it* for any dashboard action whose real result arrives after the HTTP
  response.
- **Subagent delegation for `docs/`** — 3 `general-purpose` spawns (docs rows + architecture
  subsection, delta-spec sync, escape-a-pipe fix) kept the main context clean and honored
  the AGENTS.md "main agent never edits `docs/` directly" rule.

*Recommended memory to save next time:* "plain `tsc` in a worktree resolves the **published**
`pi-dashboard-shared` `.d.ts`, not the worktree src — verify type edits with a path-override
tsconfig; vitest aliases correctly." This burned exploration time and will recur.

## 7. Pitfalls & dead ends

- **Stale shared-package types.** `tsc --noEmit` reported phantom errors against the
  published `.d.ts`. → *If you hit red tsc on shared-protocol edits in a worktree,* run a
  path-override tsconfig pointing at `packages/shared/src` before believing the error.
- **Spec assumed a WS completion event that didn't exist.** `server_restarting` is in the
  bridge protocol and fires as the process exits; tunnel/auth ops are sync HTTP. → *Confirm
  the actual completion signal per op before wiring a `requestId`.*
- **20 local test failures that were noise.** All in untouched packages (`pi-image-fit`
  jimp native-dep, extension BFS ranking, server data-count tests). → *Grep the failures
  against your changed files; CI's clean env is the arbiter.*
- **`gh pr create` heredoc quoting failed.** → *Write the PR body to a file and pass
  `--body-file`.*
- **Rebase add/add conflict on an unrelated proposal.** `develop` had a fuller canonical
  `add-goal-continuation-plugin`. → *`git rebase --onto origin/develop <feat>^` to keep only
  your commit; the churn already lives upstream.*
- **`gh pr merge` "error" that wasn't.** The remote squash-merge succeeded; only gh's local
  post-merge `develop` checkout failed (held by the main worktree). → *Verify the merge on
  the remote before assuming failure; then delete branch + worktree manually.*

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a written OpenSpec change (`openspec/changes/<name>/`), a clean
worktree branched off fresh `develop`, `gh` authenticated.

1. `/skill:openspec-apply-change <name>` — drive the task list.
2. Grep the real toast/WS wiring; surface any architecture fork via `ask_user`.
3. TDD the reusable primitive first; get it green before risky protocol edits.
4. Verify the completion-event landscape *before* wiring correlation; re-scope on evidence.
5. Register WS handlers race-free on a client-generated correlation id.
6. Delegate `docs/` writes to a subagent (caveman-style rule verbatim).
7. Path-override tsconfig to validate shared-protocol types in a worktree.
8. `/skill:openspec-archive-change <name>` → commit → PR against `develop` → poll CI.
9. `rebase develop` with `--onto` to strip unrelated churn if behind.
10. Pull + independently evaluate CodeRabbit comments even on a green check; fix, re-verify.
11. Squash-merge, delete remote + local branch, remove the worktree.

**Final artifacts:** `packages/client/src/hooks/useAsyncAction.ts` (+ test),
`packages/client/src/components/ActionButton.tsx` (+ test), Toast variants,
`packages/shared/src/browser-protocol.ts` (`ServerRestartingMessage`),
`packages/server/src/{routes/system-routes.ts,server.ts}`, migrated components
(TunnelButton, SettingsPanel, ProviderAuthSection), new main spec
`openspec/specs/async-action-feedback/spec.md`. Landed as squashed PR #105 →
`develop` (`bce3cb88`).

---

_Generated from session `019ebdfc` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-13. Source extract: facts sheet (mktemp)._

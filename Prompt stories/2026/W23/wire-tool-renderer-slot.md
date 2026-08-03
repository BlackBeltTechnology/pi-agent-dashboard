---
session: 019e94f5
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (25 user prompts); large facts sheet (~16843 tok)"
upgrade_status: pending
openspec_changes: [wire-subagents-role-resolver, wire-tool-renderer-slot, add-ctx-tool-renderer]
proposal_excerpt: "pi-dashboard-subagents (>= 0.2.0) resolves an agent definition's model: \"@role\" frontmatter by emitting pi.events.emit(\"role:resolve-model\", probe) and reading back probe.resolved (a literal provider/modelId…"
---

# How we did it: wire the tool-renderer plugin slot — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a single skill invocation:

```
/skill:openspec-apply-change wire-tool-renderer-slot
```

The literal ask was "apply this OpenSpec change" — wire the dashboard's `tool-renderer`
plugin slot into `ToolCallStep.tsx` so a plugin can claim rendering of a tool call
before the built-in registry. But the *real* objective, revealed over 25 steering turns
across ~21 hours, was much larger: **land the slot-wiring feature end to end** —
implement + test, archive the OpenSpec change, fix a blocking subagent-role bug that
surfaced mid-flight, get everything through CI and (a badly-behaved) CodeRabbit, reshape
the shared `develop` history the way the operator wanted, then apply a *second* related
change (`add-ctx-tool-renderer`) and clean up every stale branch and worktree. It was
less "run one skill" and more "drive a whole feature from apply → archive → PR → merge →
cleanup, with a detour to fix the tooling that broke along the way."

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — let the apply skill read the tasks and
   implement them; it wired the slot, added structural types (no client dep in `shared`),
   and wrote +10 tests in one pass.
2. Verify with the **canonical** gates only: `npm run lint` (tsc) + full `npm test`. Treat
   per-package `tsc` noise as pre-existing project-reference quirks, not your regression.
3. `/skill:openspec-archive-change <change>` — sync the delta requirements into the main
   spec, then archive.
4. When a subagent `@role` fails to resolve, **stop and root-cause the tooling** before
   continuing — don't route around it. (Here: an event-name skew, §7.)
5. `commit and push` — but write commit messages via a **heredoc file**, never `-m` with
   backticks (shell substitution mangles the body).
6. `create PR on branch (not develop)` — keep the feature on its branch; open a PR against
   `develop` rather than committing straight to the shared branch.
7. Watch CI + CodeRabbit explicitly (`is CI ok and coderabbit issues?`). A *green*
   CodeRabbit check can mean "review never ran" (credit/rate limit) — confirm it actually
   reviewed before trusting it.
8. For history reshaping on shared `develop`, force the AI to **state the exact commits**
   it will land and verify the tree is byte-identical before any `--force-with-lease`.
9. Clean up in explicit, confirmed batches: delete only branches with a **confirmed merged
   PR**; never remove the worktree the live session is running in.

## 3. How the collaboration unfolded

**Phase A — Apply the slot wiring (discovery → implement → verify).** The apply skill read
all context files, then implemented 26 tasks: expanded `SlotPropsMap["tool-renderer"]` with
optional payload fields (adding `ToolRendererImage`/`ToolRendererContext` *structural* types
so `shared` stays free of a client dependency), forwarded them in `ToolRendererSlot`, and
wired the resolution chain in `ToolCallStep.tsx` (plugin claim → built-in `getToolRenderer`
→ `GenericToolRenderer`, fail-closed on `shouldRender` throw, `ErrorBoundary` with no
fall-through). It added +10 tests and hit a real bug — DOM leaks across renders forced an
explicit `cleanup` after each test. *Why it worked:* the AI drove verification through the
project's canonical gates (`npm run lint`, full suite = 7148 passing) and correctly dismissed
per-package `tsc` composite-config noise as unrelated.

**Phase B — Archive.** `/skill:openspec-archive-change` synced two new `## ADDED`
requirements into `dashboard-shell-slots/spec.md`, validated, and moved the change to
`archive/`.

**Phase C — The subagent-role detour (the big one).** Delegating `docs/` edits to a subagent
failed: *"Cannot resolve role @fast."* The human asked "what does that mean?" then "enable
the roles plugin." The AI dug through `providers.json`, the bridge's `role-manager.ts`, and
the installed `pi-dashboard-subagents` package, and pinned a genuine **event-name skew**:
subagents v0.2.0 emits `role:resolve-model`, but the bridge only listened on `model:resolve`.
It wrote the missing `providers.json` roles map, added a `role:resolve-model` handler to the
bridge (in both the develop checkout and the worktree copy), added 5 tests, and captured the
fix as its own OpenSpec change `wire-subagents-role-resolver`. *Decision point:* the human
chose the concrete model (`my-google/gemma-4-31b-it`) for the `fast` role. *Key learning:*
`npm run reload` reconnects the bridge but does **not** re-import an edited module into a
running process — only a fresh session picks up the new handler.

**Phase D — Ship dance (commit → PR → CI → CodeRabbit → merge → history reshape).** Commit
messages with backticks got mangled by `-m`; fixed via heredoc. PR #77 was created, merged,
then the operator changed their mind on history shape ("oh revert. I would like rebase develop
to this branch"), triggering a careful rebase of the squash back into a linear commit
(verified byte-identical tree), a `--force-with-lease`, and finally a fresh reviewable PR #80.
CodeRabbit's green check was exposed as a *non-review* (org out of credits).

**Phase E — Second change + cleanup.** Applied `add-ctx-tool-renderer` (already implemented,
uncommitted — verified 37 tests + build, committed, archived, PR #81), removed a duplicate
scaffold, then pruned merged worktrees and remote branches — always confirming a merged PR
first and never touching the session's own worktree.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change wire-tool-renderer-slot`.** Effective because
  it hands the AI a fully-specified change (tasks.md + delta spec) and lets the skill own the
  implement→verify loop. A future operator should keep the ask this crisp: name the change,
  let the skill read its own context.
- **High-leverage clarifiers.** `What means Subagent role is unresolvable in this worktree?`
  turned an opaque error into a full root-cause investigation — asking the AI to *explain*
  before *fixing* produced the correct diagnosis. `create PR on branch (not develop)` in five
  words re-scoped the whole ship strategy.
- **Short unlocks.** `yes`, `fix`, `archive and push`, `merge pr#80` each advanced a phase the
  AI had already teed up — cheap because the AI had laid out the options first.
- **Rewrite a weak prompt.** `fix` (prompt 17) was ambiguous — the AI had to ask which of 7
  partially-done changes was meant. Stronger: name the target explicitly, e.g.
  *"fix the stale wire-tool-renderer-slot scaffold on this branch"*.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Route around the `@role` failure (edit docs directly) | "Enable/load the dashboard's roles plugin" | State up front: root-cause tooling failures, don't work around them |
| Commit straight to / merge into `develop` | "create PR on branch (not develop)"; "oh revert. I would like rebase develop to this branch" | Declare the branch/PR/history policy before the first commit |
| Trust a green CodeRabbit check | "is CI ok and coderabbit issues?" | Always confirm the review *ran* (look for the credit/rate-limit `[!WARNING]`) |
| Use `git commit -m` with backticks | AI self-caught after the body mangled | Always use a heredoc file for commit bodies containing backticks/`$()` |
| Assume `npm run reload` loads new handlers | AI discovered live process kept old module | Remember: reload reconnects the bridge, only a new process re-imports |
| Answer "fix" against the wrong target | "the tasks not checked"; scoping questions | Name the exact change/file when saying "fix" |
| Delete branches/worktrees broadly | "clean" / "cleanup" answered in confirmed batches | Only delete on a *confirmed merged PR*; never the live session's worktree |

## 6. Skills, tools & memory created — and why they're effective

No reusable skill or memory was saved this session (0 `skill`/`memory` calls). Four `Explore`
subagents were spawned — all to verify `@fast` role resolution after the bridge fix — but
they couldn't run until the role handler existed, which is itself the lesson.

**Skills that *should* be created from this session:**

- **`diagnose-subagent-role-resolution`** — captures the event-name-skew root cause
  (`role:resolve-model` emitted by subagents vs `model:resolve` handled by the bridge), the
  `providers.json#roles` map requirement, and the "reload ≠ re-import, restart the session"
  fact. This would collapse a ~2-hour investigation into a checklist. *(A repo skill
  `diagnose-spawn-register-timeout` already exists for a sibling failure; this belongs
  alongside it.)*
- **`reshape-develop-history-safely`** — the verified recipe for un-squashing a merge back
  into a linear commit on shared `develop`: reset to pre-merge tip, cherry-pick the original,
  assert the tree is byte-identical (`git diff` empty), then `--force-with-lease`.

## 7. Pitfalls & dead ends

- **`@role` won't resolve in a worktree.** Symptom: *"Cannot resolve role @fast."* Root cause
  here was an **event-name skew** (subagents emits `role:resolve-model`; bridge only handled
  `model:resolve`) *plus* a missing `~/.pi/agent/providers.json`. Fix both: write the roles
  map **and** add the `role:resolve-model` handler.
- **`npm run reload` doesn't reload new handlers.** It reconnects the bridge WebSocket but does
  not re-import an edited module into the already-running parent process. New handlers only
  register in a **freshly started** session — don't chase a "still failing" spawn as if the
  edit didn't land.
- **Edit the checkout the runtime actually loads.** pi `settings.json` may load the bridge from
  the *main* checkout, not your worktree. A durable bridge fix means editing the main checkout
  (and reloading), not the worktree copy.
- **`git commit -m` with backticks mangles the body.** Backticks/`$()` in `-m` trigger shell
  command substitution. Use a heredoc file (`git commit -F msg.txt`).
- **A green CodeRabbit check can mean "no review ran."** Rate/credit exhaustion posts a
  `[!WARNING]` and still shows the check green. Verify a real review happened before relying on
  it.
- **"fix" against a busy repo is ambiguous.** 7 changes were partially done; most remaining
  tasks were manual smoke tests needing a running dashboard. Name the target.
- **Per-package `tsc --noEmit` errors ≠ your regression.** They're pre-existing
  project-reference/composite-config quirks. The canonical gate is `npm run lint`.

## 8. Reproduce it faster — checklist

**Inputs to have ready**
- A well-formed OpenSpec change (tasks.md + delta spec) for the feature.
- `~/.pi/agent/providers.json` with a `roles` map if you'll spawn `@role` subagents
  (e.g. `{"roles":{"fast":"my-google/gemma-4-31b-it"}}`), and its API key in env.
- The main checkout path (bridge loads from there, not the worktree).

**Steps**
1. `/skill:openspec-apply-change <change>` → implement + tests in one pass.
2. Verify with `npm run lint` + full `npm test` only; ignore per-package `tsc` composite noise.
3. `/skill:openspec-archive-change <change>` → sync delta into main spec, archive.
4. If a subagent `@role` fails: check `providers.json#roles` **and** that the bridge handles
   `role:resolve-model`; after any bridge edit, **restart the session** (reload ≠ re-import).
5. Commit via heredoc file; open a PR against `develop` (not a direct commit).
6. Confirm CI green **and** that CodeRabbit actually reviewed (no credit/rate `[!WARNING]`).
7. For history reshaping: state the exact commits, verify byte-identical tree, then
   `--force-with-lease`.
8. Cleanup: delete only branches with a confirmed merged PR; never the live session's worktree.

**Artifacts produced**
- `packages/client/.../ToolCallStep.tsx` (slot dispatch) + `ToolCallStep.test.tsx` (+10 tests)
- `packages/shared/.../slot-props.ts`, `packages/dashboard-plugin-runtime/.../slot-consumers.tsx`
- `packages/extension/src/role-manager.ts` (+ test) — `role:resolve-model` handler
- `~/.pi/agent/providers.json` — roles map
- OpenSpec: archived `wire-tool-renderer-slot` + `add-ctx-tool-renderer`; new `wire-subagents-role-resolver`
- PRs #80 (slot wiring) and #81 (`ctx_*` renderer)

---

_Generated from session `019e94f5-a349-70ff-9392-ae79a00eb0e5` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-05. Source extract: `/tmp/session_facts_17445_1784848141.md`._

---
session: 019f742e
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "yes — large facts sheet (~11564 tok)"
upgrade_status: pending
openspec_changes: [resolve-subagent-inspector-by-session-id, emit-agent-session-id, inherit-parent-model-registry]
proposal_excerpt: "A foreground subagent run carries **two unrelated ids**, minted by different code and stored in different places:"
---

# How we did it: Resolve the subagent inspector by session id — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened by invoking the **`ship-it`** skill on an OpenSpec change:
*"Orchestrates the implementation phase of an OpenSpec change inside its git
worktree… Runnable headless."* The concrete objective: take the planned change
`resolve-subagent-inspector-by-session-id` from zero implementation to landed on
`develop`, running the full apply → merge → docker/test → ship-change pipeline.

The *real* objective, once the work surfaced its blockers, was narrower and sharper:
make the dashboard's subagent inspector resolve a run by **either** of the two
unrelated ids a foreground subagent carries — the v4 `agentId` **and** the v7 runner
`agentSessionId` — while honestly gating on a cross-repo producer dependency that had
to ship first.

## 2. TL;DR playbook

1. **Orient before touching code.** `openspec status --change <name> --json`, read the
   test-plan manifest + `tasks.md`, confirm a clean tree (fresh run vs. resumed).
2. **kb-first, then read source.** Per the docs-first gate, `kb_search` the symbols,
   then open only the files you'll edit (types → reducer → frame-buffer → bridge → UI).
3. **Implement the smallest coherent core.** Dual-index `SubagentState` under both ids
   (same object ref), keep `state.id` canonical v4, add a derived values-scan resync.
4. **Write the L1 tests to match existing patterns**, run them scoped with an ephemeral
   `HOME=$(mktemp -d) npx vitest run <files>`.
5. **When a tier can't pass headlessly, STOP and surface the decision** — write
   `SHIP_IT_BLOCKED.md` instead of faking a green.
6. **If the blocker is a sibling repo, author its OpenSpec proposal there** (proposal +
   design + delta spec + tasks), `openspec validate`, and reference it from the blocked file.
7. **After the producer ships, re-triage:** convert the un-automatable L3 e2e into
   deterministic **L2 component render tests** against the real route component.
8. **Merge `origin/develop`, run the quality gate**, distinguish *your* new warnings/tsc
   errors from **pre-existing** debt in untouched packages.
9. **Self-run `review-code` on the diff** — catch the dual-index side effects
   (`.values()` double-counting) before CI does.
10. **Drive `ship-change` inline** to the irreversible squash-merge, triaging CodeRabbit
    findings (fix the valid one, skip false positives *with a reason*), then remove the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Orient (fresh-run detection).** The AI ran `openspec status`, read the
planning artifacts and test-plan, checked `git status` (clean tree, all tasks
unchecked) and concluded a *genuine fresh run*. It resolved the apply skill from the
**parent** repo (worktree convention) and, per the docs-first gate, went `kb_search`
before reading source. *Why it worked:* establishing "fresh vs. resumed" up front
prevents re-applying a checked task.

**Phase 2 — Implement the in-repo core.** Edits landed across `types.ts` (optional
`agentSessionId`), `event-reducer.ts` (a `setSubagentState` dual-index helper applied
to all four live-frame arms + the `tool_execution_end` backfill), `subagent-frame-buffer.ts`
(derived-scan resync + split stats), and `bridge.ts` (id-agnostic resync + logging).
11 new L1 scenarios were written to match existing test patterns and passed (314/314
in the affected suite). *Why it worked:* one shaping point (the dual-index helper) kept
the change coherent and testable.

**Phase 3 — Hit the wall, block honestly.** The L3 e2e tier (F1/F2/F3) could **not**
be automated: F1/F2 need the run's frames to carry `agentSessionId`, which only exists
once the **sibling producer** ships it (task 1.1, out of this repo's scope, unpublished),
and the faux e2e spawns a *real* subagent. Plus the test-plan's expected placeholder
string was the *inline* component's message, not the deep-link **route**'s. **Decision
point (human):** rather than fudge, the AI wrote `SHIP_IT_BLOCKED.md` and — on the
user's steer — authored a full producer proposal (`emit-agent-session-id`) in
`/Users/robson/Project/pi-dashboard-subagents`, validated with that repo's openspec CLI.

**Phase 4 — Producer ships, re-triage.** The user returned with *"Shipped —
emit-agent-session-id … @blackbelt-technology/pi-dashboard-subagents@0.2.3 (live)."*
Blocker 1 cleared (floor already pinned `>= 0.2.3`). For Blocker 2, the AI found the
deterministic seam — existing `SubagentPopoutPage.test.tsx` render tests — and converted
F1/F2/F3 from producer-dependent **L3 e2e** to **L2 component render tests** with the
*correct* route string. All 14 automated scenarios (11 L1 + 3 L2) then passed.

**Phase 5 — Gate, review, ship.** Merge `origin/develop` (clean), run `quality:changed`
(auto-fixed 2 files; the 198 warnings + tsc errors were **pre-existing** debt in
untouched files). A worktree-specific tsc false negative (plugin type edit invisible
because node resolution walked up to the *main* repo) was fixed by adding the CI-equivalent
symlink. Self-run `review-code` caught a real dual-index hazard — `App.tsx:883` iterated
`subagents.values()` and now double-sent a resync — fixed by de-duping on `state.id`.
`ship-change` ran inline to PR **#360**, two green CI rounds, CodeRabbit triage (1 valid
fix, 5 false positives skipped with reasons), squash-merge `2a112c1c`, worktree removed.

## 4. Prompts that worked

- **The goal prompt (skill invocation).** Launching `ship-it` gave the AI a full
  procedure with explicit boundaries (apply → merge 2.5 → test → ship-change) and a
  *reverse escape hatch* (`SHIP_IT_BLOCKED.md`). A good kickoff = hand the agent a
  skill whose contract already encodes "where to stop."

- **High-leverage follow-up #1:** *"I would like to create proposal on
  pi-dashboard-subagents project which required to release to complete this proposal."*
  One sentence redirected the blocked ship into producing the unblocking artifact in
  the sibling repo. **Stronger version:** *"Block this ship, then scaffold the producer
  change `emit-agent-session-id` in ../pi-dashboard-subagents with proposal+design+delta
  spec+tasks and validate it."*

- **High-leverage follow-up #2 (the shipped-status paste).** Handing the AI the exact
  published version, commit SHAs, and gate results let it re-triage precisely: *floor
  already pinned, Blocker 1 cleared, only Blocker 2 remains.* **Lesson:** paste concrete
  downstream facts (version, SHA, "114/114 tests") — the agent converts them straight
  into a plan delta.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the whole change as shippable in one pass | Accept the block, then ask for the sibling-repo proposal | State cross-repo prerequisites in the proposal's coordination note up front |
| Leave the ship blocked and idle | Paste "Shipped — 0.2.3 live" with SHAs + gate results | Have the producer-release confirmation ready as a resumption trigger |
| Want to keep F1/F2/F3 as L3 e2e | (AI self-corrected) convert to L2 component tests | Prefer deterministic component-render tests over faux-harness e2e when a producer is in the loop |
| Count pre-existing warnings/tsc errors as "mine" | Insist on surgical scope — only new symbols matter | Baseline the touched-file warnings before editing; CI clean-install is authoritative |

Additional quality bars the human/skill imposed: **don't fake a green** (block instead),
**honest task annotations** (mark 1.1 "producer now shipped", 8.1 gate caveats), and
**skip CodeRabbit false positives *with a written reason***, not silently.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created in this session — the work was driven end-to-end by
existing skills (`ship-it` → `openspec-apply-change` → `ship-change`, plus `review-code`
and `code-quality`). Their composition *was* the value.

**Recommended skill to capture (worktree tsc false negative).** The single most
non-obvious lesson — *a worktree has no workspace symlinks, so node resolution walks up
to the main repo and `tsc` reads a stale plugin `.d.ts`, making your worktree type edit
invisible* — deserves a small project skill: **"worktree-plugin-symlink"**. Procedure:
detect a tsc error on a symbol you *know* you edited → confirm the plugin isn't in the
worktree's `node_modules` → `ln -sf ../../packages/<plugin> node_modules/@scope/<plugin>`
to replicate CI's `npm ci` resolution → re-run tsc. Invoke whenever a worktree tsc
disagrees with a passing vitest run on the same edit.

## 7. Pitfalls & dead ends

- **Faux e2e can't prove producer-dependent behavior.** The `subagent-spawn` faux
  scenario spawns a *real* subagent, so `agentSessionId` only flows when the producer
  is ≥ 0.2.3. → Don't try to fake the field; block, ship the producer, or move the
  assertion to an L2 component test with a controlled `subagents` Map.

- **Expected string belonged to the wrong component.** The test-plan asserted the
  *inline* `SubagentDetailView` message, but the deep-link route mounts
  `SubagentPopoutPage` with a different string. → Assert against the component the route
  actually renders.

- **`quality:changed` fails on pre-existing debt.** `--changed` scans the *whole* touched
  file, surfacing 198 pre-existing `noExplicitAny` warnings in `event-reducer.ts`. → Confirm
  *zero* warnings point at your new symbols; CI treats these Tier B/C warnings as non-gating.

- **Worktree tsc false negative.** `tsc` resolved the plugin from the **main** repo
  (no worktree symlink), so the type edit was invisible while vitest passed. → Add the
  `node_modules/@scope/<plugin>` symlink to match CI, then re-check.

- **Dual-index doubles map iteration.** After dual-indexing, `subagents.values()` at
  `App.tsx:883` yielded each agent twice → duplicate `subagent_resync_request`. → De-dup
  by `state.id` anywhere you enumerate `.values()/.entries()` or read `.size`.

- **`--delete-branch` collides with the worktree branch.** The squash-merge succeeded but
  the local branch-delete step errored (worktree still checked it out). → The merge is
  done; clean up the remote branch + `git worktree remove` separately, then force-delete
  the local branch.

- **cwd vanished after `git worktree remove`.** The shell's session cwd was the removed
  worktree, so Bash couldn't launch. → Run final verification from the sandbox (its own cwd)
  or `cd` to the parent repo first.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name + its planning artifacts, `gh` auth,
the sibling repo path (`/Users/robson/Project/pi-dashboard-subagents`), and — for the
unblock — the producer's published version + release SHAs.

1. `openspec status --change <name> --json` + read test-plan/tasks; confirm clean tree.
2. `kb_search` symbols → read only the files you'll edit.
3. Implement the smallest coherent core (one dual-index shaping point; canonical `state.id`).
4. Add L1 tests matching existing patterns; `HOME=$(mktemp -d) npx vitest run <files>`.
5. Un-automatable tier? Write `SHIP_IT_BLOCKED.md`; author the sibling proposal + `openspec validate`.
6. After producer ships: re-triage L3→L2 component tests with the *route's* real string.
7. `git merge origin/develop`; run `quality:changed`; separate your issues from pre-existing debt.
8. Fix the worktree plugin symlink if tsc disagrees with vitest.
9. Self-run `review-code`; fix dual-index `.values()` double-count.
10. `ship-change` inline → PR, CI, CodeRabbit triage (fix valid, skip false positives with reason),
    squash-merge, `git worktree remove`.

**Final artifacts:** PR [#360](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/360)
squash-merged (`2a112c1c`) to `develop`; producer `@blackbelt-technology/pi-dashboard-subagents@0.2.3`
live; sibling proposal `emit-agent-session-id` (proposal+design+delta spec+tasks) authored & validated.

---

_Generated from session `019f742e-2354-713f-88ee-4fa72b23a2fd` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-18. Source extract: session facts sheet (deterministic extract)._

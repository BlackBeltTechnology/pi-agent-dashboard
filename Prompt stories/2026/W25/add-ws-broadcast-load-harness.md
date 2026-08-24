---
session: 019ed29b
week: 2026/W25
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [add-ws-broadcast-load-harness]
proposal_excerpt: "A user reports periodic WebSocket lag and suspects `openspec_update` frames for non-focused sessions clog the single browser socket. Investigation confirms the mechanism is plausible but unmeasured:"
---

# How we did it: WS broadcast load harness — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single slash command:

```
/skill:openspec-apply-change add-ws-broadcast-load-harness
```

The real objective, once the proposal context loaded: a user reported periodic
WebSocket lag and suspected that `openspec_update` frames broadcast for
*non-focused* sessions were clogging the single browser socket (head-of-line
blocking). The mechanism was plausible but **unmeasured**. This change builds a
**test-only, deterministic load harness** — a virtual-clock draining fake socket
plus a scenario matrix that drives the *real* browser gateway — to measure whether
cross-cwd broadcast frames actually delay a focused session's frames. Zero
production source changes; the deliverable is evidence.

The rest of the session (5 steering prompts) was pure lifecycle: archive the
change → open a PR → fix CodeRabbit feedback → watch CI → merge and clean up.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change add-ws-broadcast-load-harness` — load the change (spec-driven, 30 tasks).
2. **Read the gateway's real API first** (`broadcastToAll`, `broadcastOpenSpecUpdate`, `MAX_WS_BUFFER`, subscription flow) before writing any fake — the harness must drive the real code, not a mock.
3. Run the **baseline** `npm test`, capture the pre-existing failure set, and confirm your additive change touches none of it.
4. Build the one genuinely new primitive: a **draining fake socket** with a caller-owned virtual clock — `send()` snapshots `bytesAtEnqueue`, `advance(ms)` drains FIFO, `timeToFlush = bytesAtEnqueue / rate` (pure head-of-line metric).
5. Add fixtures (`seedSessions`, `makeOpenSpecPayload`, subscribe helpers) then a **scenario matrix A–E** driving `createBrowserGateway` for real.
6. Verify **determinism**: run the new tests 3× (`HOME=$(mktemp -d) npx vitest run ...`), confirm identical pass counts, then `openspec validate`.
7. **Delegate all `docs/` writes to a subagent** with the caveman-style rule verbatim (AGENTS.md Documentation Update Protocol).
8. `/skill:openspec-archive-change` (syncs the delta spec into `openspec/specs/`), then commit → push → `gh pr create --base develop`.
9. Fetch CodeRabbit review **body** (not just inline threads), apply the minimal safe fix, re-run harness tests, push.
10. `gh run watch` until green → `gh pr merge --squash --delete-branch` → remove worktree + local + remote branch **from the main repo**, not from inside the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & preconditions.** The AI located the openspec skill,
selected the change, and read the gateway's public surface plus the session
manager and `OpenSpecData` type. It then ran the full baseline suite and found
20 pre-existing failures across 5 files (image-fit native deps, browse/doctor/
session-kill e2e timing). *Why it worked:* establishing the baseline failure set
up front meant every later "still 20 failures" check was a clean signal that the
additive change introduced zero regressions.

**Phase 2 — The primitive.** The core insight: model a FIFO drain as
`timeToFlush(record) = record.bytesAtEnqueue / drainRateBytesPerMs`, where
`bytesAtEnqueue` snapshots queue depth *including the frame itself*. 14 unit tests
pinned byte accounting, clamp-at-0, head-of-line ordering, and metadata parsing.

**Phase 3 — Fixtures & scenario matrix.** Helpers (`seedSessions`,
`makeOpenSpecPayload(sizeBytes)`, `attachClients`, `subscribeWs`, `DRAIN_FAST/SLOW`
presets marked illustrative-not-calibrated), then scenarios A–E driving the *real*
`createBrowserGateway`. A decision point surfaced: the latency predicate initially
matched the *first* event record instead of the one queued behind the burst; the
fix was to isolate the baseline in its own gateway/socket so each socket sees
exactly one focused event.

**Phase 4 — Verify.** New tests run 3× → 22/22 deterministic; `openspec validate`
green; scenario E produced a readable periodic-vs-flat verdict. Full suite:
identical pre-existing 20, +22 new passing, zero new failures.

**Phase 5 — Docs (delegated).** Per AGENTS.md, all `docs/` writes went to a
general-purpose subagent with the caveman-style rule passed verbatim.

**Phase 6 — Lifecycle.** Archive (delta spec synced to a new capability
`ws-broadcast-load-harness`, 5 requirements) → commit → push → PR #139 → CodeRabbit
1 nitpick fixed → CI green (7m40s) → squash-merge → cleanup.

## 4. Prompts that worked

- **Goal prompt** `/skill:openspec-apply-change add-ws-broadcast-load-harness` —
  effective because the change already had a spec-driven proposal with 30 tasks;
  the slash command let the AI self-orchestrate the whole phase plan. *Stronger
  version for a future user:* same command, but add "this is test-only — read the
  real gateway API before writing any fake, and confirm the baseline failure set
  first" to front-load the two habits that mattered most.
- **High-leverage follow-ups** — each was a single short verb that unlocked a full
  lifecycle stage: `create PR`, `fix coderabbit issues`, `monitor ci`,
  `merge, delete branch and worktree`. Their power comes from the underlying skills
  (openspec-archive, PR autofix) doing the heavy lifting; the human only had to name
  the next stage.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementation | "`/skill:openspec-archive-change`" | Chain apply→archive in one run when the change is complete + validated |
| Wait to be told the next lifecycle step | "create PR", "monitor ci", "merge…" | State up front: "apply, archive, PR against develop, fix review, merge, clean up" |
| Only check CodeRabbit *inline threads* | (self-corrected) look at the review **body** | Always read the review body — CodeRabbit puts nitpicks there, not as threads |
| Run cleanup from inside the worktree | (self-corrected) re-run from main repo | Never `git worktree remove` / branch-delete while `cwd` is the worktree being removed |

## 6. Skills, tools & memory created — and why they're effective

No new skill was created, but the workflow leaned on existing ones effectively:
`openspec-apply-change`, `openspec-archive-change`, `openspec-sync-specs`, and the
PR-autofix skill. The **draining fake socket** (`createDrainingWs`) is itself a
reusable test primitive — a drop-in for the static `makeFakeWs` whenever a test
needs timing-aware buffer semantics under a virtual clock.

*Recommended skill to create:* a "measure-a-broadcast-hypothesis" harness template —
read the real emitter API, build a virtual-clock draining socket, drive the real
gateway with a scenario matrix, assert determinism 3×. This session is the template.

## 7. Pitfalls & dead ends

- **Direct `tsc -p` failed** with a project-reference config artifact. *Fix:* the
  repo's typecheck bar is vitest/esbuild (server runs via jiti, no separate tsc
  step) — don't invoke tsc directly.
- **Direct `npx vitest` needs an ephemeral HOME.** *Fix:* prefix `HOME=$(mktemp -d)`
  to avoid picking up the real `~/.pi` state.
- **`openspec` binary not on PATH** from the worktree — fall back to
  `node_modules/.bin/openspec` or resolve it explicitly.
- **Latency predicate matched the wrong record** (first event, not the one behind
  the burst). *Fix:* isolate the baseline in its own gateway/socket.
- **Cleanup from inside the deleted worktree** — the Bash tool stayed pinned to the
  now-deleted directory and the remote-branch delete failed. *Fix:* run cleanup with
  absolute paths from the main repo, or use a fresh sandbox shell.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the openspec change name, `gh` authenticated, base branch
(`develop`), and knowledge that `docs/` writes must be delegated to a subagent.

1. `/skill:openspec-apply-change <change>`
2. Read the real emitter API before any fake; capture the baseline test-failure set.
3. Build the virtual-clock draining socket + unit tests.
4. Add fixtures + scenario matrix driving the real gateway.
5. Verify: 3× deterministic run (`HOME=$(mktemp -d) npx vitest run …`) + `openspec validate`.
6. Delegate `docs/` writes to a subagent (caveman-style rule verbatim).
7. `/skill:openspec-archive-change` → commit → push → `gh pr create --base develop`.
8. Fix CodeRabbit (read the review **body**) → push → `gh run watch` → `gh pr merge --squash --delete-branch`.
9. Remove worktree + branches **from the main repo**.

**Final artifacts produced:**
- `packages/server/src/__tests__/helpers/draining-ws.ts`
- `packages/server/src/__tests__/draining-ws.test.ts`
- `packages/server/src/__tests__/helpers/load-fixtures.ts`
- `packages/server/src/__tests__/browser-gateway-load.test.ts`
- `docs/perf-ws-broadcast-load.md`
- `openspec/specs/ws-broadcast-load-harness/spec.md` (new capability, 5 requirements)
- Merged as PR #139 into `develop`.

---

_Generated from session `019ed29b-dd71-77dd-a87b-fa731421c5ff` · `pi-agent-dashboard` · 2026-06-20. Source extract: session facts sheet._

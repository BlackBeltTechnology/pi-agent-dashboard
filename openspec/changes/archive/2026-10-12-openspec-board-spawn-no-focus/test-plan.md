# Test Plan — openspec-board-spawn-no-focus

Stage: design   Generated: 2026-10-12

No clarifications needed — every Triple fills from the spec deltas + design D1–D5.

Exemplars:
- L1 correlation: `packages/client/src/hooks/__tests__/useMessageHandler.placeholder-cwd.test.tsx`, `useMessageHandler.tier25-fallback.test.tsx`, `useMessageHandler.hidden-nav.test.tsx`
- L1 spawn API: `packages/client/src/hooks/__tests__/useSessionActions.placeholder-cwd.test.tsx`
- L1 board component: `packages/client/src/components/__tests__/OpenSpecBoardView.test.tsx` (existing "create & spawn fires onSpawnSession" case, ~line 154)
- L3: `tests/e2e/session-spawn.spec.ts` (spawn + wait for bridge register, `ensureGitSession` helper) + `tests/e2e/openspec-board-drop.spec.ts` (board route setup)

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | spawn-correlation auto-select (no-focus, Tier 1); placeholder-spawn-card | decision-table | L1 | automated | `pendingSpawns` = {`rq_50`: `{cwd:"/p", kind:"spawn", focus:false}`}, `spawningCwds` ∋ `/p` | `session_added {session{id:"s1",cwd:"/p"}, spawnRequestId:"rq_50"}` | `navigate` not called; `rq_50` removed; `clearSpawningCwd("/p")` called |
| E2 | spawn-correlation "Auto-select after spawn" (regression) | decision-table | L1 | automated | `pendingSpawns` = {`rq_42`: `{cwd:"/p", kind:"spawn"}`} (no focus key) | `session_added {session{id:"s2",cwd:"/p"}, spawnRequestId:"rq_42"}` | `navigate("/session/s2")` called once; `rq_42` removed |
| E3 | spawn-correlation "No-focus worktree spawn matched by cwd fallback" (Tier 2.5) | decision-table | L1 | automated | `pendingSpawns` = {`rq_w`: `{cwd:"/p/.worktrees/x", placeholderCwd:"/p", kind:"spawn", focus:false}`}; `spawningCwds` ∋ `/p` | `session_added {session{id:"s3",cwd:"/p/.worktrees/x"}}` (no `spawnRequestId`) | `navigate` not called; `rq_w` removed; `clearSpawningCwd("/p")` called |
| E4 | spawn-correlation fallback, Tier 2 legacy (design D3) | decision-table | L1 | automated | `pendingSpawns` = {`rq_p`: `{cwd:"/p", kind:"spawn", focus:false}`}; `spawningCwds` ∋ `/p` | `session_added {session{id:"s4",cwd:"/p"}}` (no `spawnRequestId`) | `navigate` not called; `rq_p` removed; `clearSpawningCwd("/p")` called |
| E5 | spawn-correlation "Mixed fallback match still focuses" | decision-table | L1 | automated | `pendingSpawns` = {`rq_a`: `{cwd:"/p", kind:"spawn", focus:false}`, `rq_b`: `{cwd:"/p", kind:"spawn"}`}; `spawningCwds` ∋ `/p` | `session_added {session{id:"s5",cwd:"/p"}}` (no `spawnRequestId`) | `navigate("/session/s5")` called once; exactly one of `rq_a`/`rq_b` removed |
| E6 | spawn-correlation fallback, zero matches (design D3) | BVA (0 matches) | L1 | automated | `pendingSpawns` = {} ; `spawningCwds` ∋ `/p` | `session_added {session{id:"s6",cwd:"/p"}}` (no `spawnRequestId`) | `navigate("/session/s6")` called (pre-change behavior); `clearSpawningCwd("/p")` called |
| E7 | spawn-correlation "No-focus intent does not leak to other spawns" | decision-table | L1 | automated | `pendingSpawns` = {`rq_60`: `{cwd:"/p", kind:"spawn", focus:false}`, `rq_61`: `{cwd:"/q", kind:"spawn"}`} | `session_added {session{id:"s7",cwd:"/q"}, spawnRequestId:"rq_61"}` | `navigate("/session/s7")` called; `rq_60` still present in `pendingSpawns` |
| E8 | design D3 key rule (match on `entry.cwd`, not `placeholderCwd`) | EP (worktree vs plain) | L1 | automated | `pendingSpawns` = {`rq_w`: `{cwd:"/p/.worktrees/x", placeholderCwd:"/p", kind:"spawn", focus:false}`}; `spawningCwds` ∋ `/p` | `session_added {session{id:"s8",cwd:"/p"}}` (no `spawnRequestId`) | `rq_w` still present in `pendingSpawns` (not consumed by the parent-cwd session); `navigate("/session/s8")` called as today (zero `entry.cwd` matches) |
| E9 | spawn-correlation reconciled add unchanged | state-transition | L1 | automated | `pendingSpawns` = {`rq_50`: `{cwd:"/p", kind:"spawn", focus:false}`} | `session_added {session{id:"s9",cwd:"/p"}, spawnRequestId:"rq_50", reconciled:true}` | `navigate` not called; `rq_50` removed; `clearSpawningCwd("/p")` called |
| E10 | spawn-correlation hidden gate unchanged | state-transition | L1 | automated | `pendingSpawns` = {`rq_50`: `{cwd:"/p", kind:"spawn", focus:false}`} | `session_added {session{id:"s10",cwd:"/p",hidden:true}, spawnRequestId:"rq_50"}` | `navigate` not called; `rq_50` still present; `clearSpawningCwd` not called |
| E11 | design D1 entry recording | EP (focus false / true / absent) | L1 | automated | `handleSpawnSession` called 3×: `("/p", undefined, {focus:false})`, `("/p", undefined, {focus:true})`, `("/p")` | spawn dispatch | pending entries: 1st has `focus:false`; 2nd and 3rd have no `focus` key; every sent `spawn_session` message has no `focus` field |
| E12 | openspec-board "Card + Session stays on the board" (dispatch) | EP | L1 | automated | board rendered with change `add-thing` on cwd `/p` | click card `+ Session` | `onSpawnSession` called with `("/p", "add-thing", {focus:false})` |
| E13 | openspec-board "New-proposal create-and-spawn stays on the board" (dispatch) | decision-table (worktree on/off) | L1 | automated | New-proposal dialog, name `add-thing`, worktree option off / on | submit | off → `onSpawnSession("/p","add-thing",{focus:false})`; on → `onSpawnAttachedWorktree("/p","add-thing")` and `onSpawnSession` not called |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | spawn-correlation "No-focus intent is honored after the user leaves the originating view" | state-transition | L1 | automated | `pendingSpawns` = {`rq_50`: `{cwd:"/p", kind:"spawn", focus:false}`}; current location changed to `/settings` before arrival | `session_added {session{id:"s11",cwd:"/p"}, spawnRequestId:"rq_50"}` | `navigate` not called; `rq_50` removed |
| F2 | openspec-board "Card + Session stays on the board" (end-to-end) | async convergence | L3 | automated | docker harness; folder `/fixtures/sample-git` with an active OpenSpec change; page at `/folder/<enc>/openspec` | click card `+ Session`, wait ≤60 s for bridge register | URL still matches `/folder/<enc>/openspec`; the new session appears in that change card's session list; URL never matched `/session/` during the wait |
| F3 | openspec-board "Card New worktree stays on the board" (end-to-end, covers App `WorktreeSpawnDialog.onSpawn` wiring, design D5) | async convergence | L3 | automated | same harness/board as F2; worktree enabled | click card `New worktree`, confirm dialog, wait ≤60 s for register | URL still matches `/folder/<enc>/openspec`; parent-folder spawn placeholder cleared; URL never matched `/session/` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | spawn-correlation failure path with no-focus entry (unchanged cleanup) | fault-injection (abort) | L1 | automated | `spawn_result {success:false, requestId:"rq_50", cwd:"/p"}` for a no-focus entry | message handled | `rq_50` removed; `clearSpawningCwd("/p")` called; `navigate` not called |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | openspec-board "Board spawns do not take focus" (UX discoverability, no toast) | visual/subjective | — | manual-only | board with several changes | fan out 3 spawns (plain + worktree + New-proposal) | [judgment: each new session is noticeable on its card without a toast; sidebar `+` still focuses] |

---

## Coverage summary

- Requirements covered: 4/4 (spawn-correlation auto-select MODIFIED, placeholder-spawn-card MODIFIED, openspec-board ADDED, design D1/D3/D5 invariants)
- Scenarios by class: edge 13 · perf 0 · frontend 3 · error 1 · manual 1
- Scenarios by level: L1 15 · L2 0 · L3 2
- Scenarios by disposition: automated 17 · manual-only 1

## New infra needed

- none (L3 F2/F3 need an OpenSpec change present in the harness fixture folder — reuse the setup in `openspec-board-drop.spec.ts`; if that fixture lacks one, seed it in the spec's `beforeAll`).

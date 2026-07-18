## 1. Producer prerequisite (sibling repo — tracking only)

- [x] 1.1 Tracked in `@blackbelt-technology/pi-dashboard-subagents` (sibling repo `github.com/BlackBeltTechnology/pi-dashboard-subagents`): add optional `agentSessionId?: string` to the `AgentDetails` interface in `extensions/events.ts` and populate it (`= createResult.session.id`) in `snapshotDetails()` in `extensions/agent.ts`, so it rides BOTH the `subagents:*` frame `details` AND the Agent tool's `tool_execution_end` details; publish `v0.2.3`. Out of this repo's edit scope — recorded here for traceability; no code change in this repo. (Frame-only would miss the backfill path — doubt-review F3.) **SHIPPED:** `@blackbelt-technology/pi-dashboard-subagents@0.2.3` published (live, latest) via sibling-repo change `emit-agent-session-id`; prerequisite satisfied.

## 2. Shared types — optional `agentSessionId` (D1)

- [x] 2.1 Add optional `agentSessionId?: string` to `SubagentState` and the client-mirrored `AgentDetails` in `packages/subagents-plugin/src/client` (their home; workspace-symlinked into `packages/client` via `packages/*`, so no publish). Absent field = today's behaviour.

## 3. Reducer dual-index (D2)

- [x] 3.1 In `packages/client/src/lib/event-reducer.ts`, when a subagent frame's `details.agentSessionId` is present, set `session.subagents` under BOTH the `agentId` and the `agentSessionId` keys to the SAME `SubagentState` reference, and persist `agentSessionId` on the state. Keep `state.id` canonical (= `agentId`) even when retrieved via the v7 key (invariant N2).
- [x] 3.2 Apply the same dual-index in the `tool_execution_end` (`toolName === "Agent"`) backfill arm, reading `endDetails.agentSessionId`, so re-hydrated completed subagents (the after-refresh/`/resume` case) are resolvable by either id.
- [x] 3.3 When `agentSessionId` is absent, set only the `agentId` key (no alias) — verify no regression to single-key sessions.
- [x] 3.4 Do NOT add any `.values()/.entries()` enumeration of `session.subagents`; if a future render needs one, it must de-dup by `state.id` (invariant N1). Comment this at the dual-`set` site.

## 4. Bridge resync resolves either id — DERIVED from `snapshots` (D3)

- [x] 4.1 In `packages/extension/src/subagent-frame-buffer.ts`, make `resync(id)` first try `snapshots.get(id)` (id is an `agentId`), else fall back to a scan `[...snapshots.values()].find(s => s.details.agentSessionId === id)` (id is an `agentSessionId`), else silent no-op. NO separate alias map and NO `finished` set — the mapping is a pure function of the already-bounded (≤64) `snapshots` map, so it cannot leak/diverge (dissolves cycle-2/3 F2/F4/F6/A/D). Do NOT touch `track()`/`evictToBound`/`reset()` for aliasing.
- [x] 4.2 In `packages/extension/src/bridge.ts` (`subagent_resync_request` handler), pass the incoming id (which may be a v7) to `resync` unchanged — no new message type. Log BOTH the incoming id and the resolved `agentId` (doubt-review N3).
- [x] 4.3 Extend `SubagentFrameBuffer.stats` so resync-by-agentId vs resync-by-agentSessionId (scan-hit) and no-ops are observable (reuse the existing counters pattern).

## 5. Inspector client resolves either id (D2, D4)

- [x] 5.1 Verify `packages/subagents-plugin/src/client/` (`SubagentDetailView`, `SubagentPopoutClaim`, `SubagentPopoutPage`) resolve a v7 `:agentId` for free once the reducer dual-indexes — no `.get()` call-site change expected; add a guard/comment only if a lookup bypasses the map.
- [x] 5.2 In `packages/client/src/components/tool-renderers/AgentToolRenderer.tsx`, confirm `requestResyncIfStale` tolerates a v7 in the `agentId` slot (it sends whichever id it holds; the bridge resolves).

## 6. Dependency floor (D5)

- [x] 6.1 Bump the recommended/installed `@blackbelt-technology/pi-dashboard-subagents` floor to `>= 0.2.3` (recommended-extensions manifest / install list) so fresh installs get the emit side; document the graceful-degrade contract in the nearest `AGENTS.md` row.

## 7. Tests

_(folded from `test-plan.md`; 14 automated rows, 0 manual-only. Each row → one task.)_

- [x] 7.1 L1 reducer dual-index: frame `details` with `agentId=A`+`agentSessionId=S` → `subagents.get(A)` and `subagents.get(S)` return the SAME ref, `state.agentSessionId===S`, `state.id===A`. See `packages/client/src/lib/__tests__/event-reducer.test.ts`. (test-plan #E1)
- [x] 7.2 L1 reducer single-key: frame `details` without `agentSessionId` → only the `A` key set, no `S` alias key. See `event-reducer.test.ts`. (test-plan #E2)
- [x] 7.3 L1 reducer backfill dual-index: `tool_execution_end` `toolName="Agent"` with `endDetails.agentId=A`+`agentSessionId=S` (no prior frames) → backfilled state retrievable under both `A` and `S`. See `event-reducer.test.ts`. (test-plan #E3)
- [x] 7.4 L1 reducer backfill single-key: same end event without `agentSessionId` → only `A` key set. See `event-reducer.test.ts`. (test-plan #E4)
- [x] 7.5 L1 bound: track 65 distinct running subagents (each with its own `S`) then complete all → resync for the 1st (evicted) `A` and its `S` both no-op; retained running-snapshot count ≤ 64; no separate index retains completed runs. See `packages/extension/src/__tests__/subagent-frame-buffer.test.ts`. (test-plan #E5)
- [x] 7.6 L1 unknown id: `subagents.get(<neither a tracked agentId nor agentSessionId>)` → `undefined` (SubagentDetailView would render the placeholder). See `event-reducer.test.ts` / `SubagentDetailView.test.tsx`. (test-plan #E6)
- [x] 7.7 L2 route running-resolve: session `subagents` dual-indexes a RUNNING run (non-empty `entries`) under both `A` and `S`; render `SubagentPopoutPage` with `agentId=S` → live timeline body renders, not-found placeholder NOT shown. See `packages/subagents-plugin/src/client/__tests__/SubagentPopoutPage.test.tsx`. (test-plan #F1)
- [x] 7.8 L2 route backfill-resolve (PRIMARY): session `subagents` dual-indexes a COMPLETED (backfilled) run under both `A` and `S`; render `SubagentPopoutPage` with `agentId=S` → rehydrated body renders (not placeholder). See `SubagentPopoutPage.test.tsx`. (test-plan #F2)
- [x] 7.9 L2 route unknown-id regression: render `SubagentPopoutPage` with an id present in NEITHER the `A` nor `S` slot → the ACTUAL route placeholder "Subagent not found — it may have been cleared from the parent session's history." IS shown (no false resolve). See `SubagentPopoutPage.test.tsx`. (test-plan #F3)
- [x] 7.10 L1 graceful degrade: frames + end details never carrying `agentSessionId` (producer < 0.2.3) → reducer creates no `S` key AND frame-buffer `resync(S)` no-ops; no throw; identical to today. See `event-reducer.test.ts` + `subagent-frame-buffer.test.ts`. (test-plan #X1)
- [x] 7.11 L1 resync derived match: retained running snapshot for `A` with `details.agentSessionId=S` → `resync(S)` returns it via the values-scan (and fast-path `resync(A)` returns it). See `subagent-frame-buffer.test.ts`. (test-plan #X2)
- [x] 7.12 L1 terminated resolves to nothing: after the terminal frame removes `A`'s snapshot → `resync(A)` and `resync(S)` both no-op (no stale "running" served). See `subagent-frame-buffer.test.ts`. (test-plan #X3)
- [x] 7.13 L1 populated-timeline regression: running subagent with non-empty `entries[]` → opening inline expand or popout sends NO `subagent_resync_request` (variant-A guard preserved). See `packages/client/src/components/__tests__/AgentToolRenderer.test.tsx`. (test-plan #X4)
- [x] 7.14 L1 perf micro: `snapshots` at the 64 cap, `resync(<non-matching agentSessionId>)` (worst-case full-scan miss) → single call < 1 ms. See `subagent-frame-buffer.test.ts`. (test-plan #P1)

## 8. Gates

- [x] 8.1 `npm run quality:changed`: my touched files are `tsc`-clean and all 14 change scenarios pass (11 L1 + 3 L2). Residual gate noise is pre-existing + local-env only — 198 Tier B/C biome warnings in the whole `event-reducer.ts` (surfaced by `--changed`, not introduced here), and untouched-package failures (image-fit `Jimp`, server `chardet`/CP1250, bus-client `spawnSync`) from local dependency/env gaps. CI (clean `npm ci`) is authoritative for those.
- [x] 8.2 `openspec validate resolve-subagent-inspector-by-session-id` passes; advisory `review-code` gate run on the diff before commit.

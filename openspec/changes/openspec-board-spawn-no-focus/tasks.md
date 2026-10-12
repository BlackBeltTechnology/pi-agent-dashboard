## 1. Pending-spawn entry + spawn API (design D1, D4)

- [x] 1.1 Extract one exported `PendingSpawnEntry` type `{ cwd: string; kind: "spawn" | "resume"; placeholderCwd?: string; focus?: boolean }` and reference it from `packages/client/src/App.tsx:746`, `hooks/useSessionActions.ts:41`, `hooks/useMessageHandler.ts:249`; verify `npx tsc --noEmit -p packages/client` passes.
- [x] 1.2 Write failing L1 test in a new `packages/client/src/hooks/__tests__/useSessionActions.no-focus.test.tsx` (copy harness from `useSessionActions.placeholder-cwd.test.tsx`): input `handleSpawnSession` called with `{focus:false}`, `{focus:true}`, and no opts · trigger spawn dispatch · observable 1st pending entry has `focus:false`, 2nd/3rd have no `focus` key, no sent `spawn_session` carries `focus` (test-plan #E11).
- [x] 1.3 Extend `handleSpawnSession` opts with `focus?: boolean`, store `focus: false` on the entry only when `opts.focus === false`, keep the `spawn_session` payload unchanged; verify 1.2 passes.

## 2. Correlation tiers honor the no-focus intent (design D2, D3)

All tests in a new `packages/client/src/hooks/__tests__/useMessageHandler.no-focus-spawn.test.tsx`; copy harness from `useMessageHandler.placeholder-cwd.test.tsx` / `useMessageHandler.tier25-fallback.test.tsx` / `useMessageHandler.hidden-nav.test.tsx`. Write 2.1–2.13 first and confirm the no-focus ones fail.

- [x] 2.1 L1 test: input pending `rq_50 {cwd:"/p",kind:"spawn",focus:false}` · trigger `session_added {s1,/p, spawnRequestId:"rq_50"}` · observable no `navigate`, `rq_50` removed, `clearSpawningCwd("/p")` (test-plan #E1).
- [x] 2.2 L1 regression test: input pending `rq_42 {cwd:"/p",kind:"spawn"}` · trigger `session_added {s2,/p, spawnRequestId:"rq_42"}` · observable `navigate("/session/s2")` once, `rq_42` removed (test-plan #E2).
- [x] 2.3 L1 test: input pending `rq_w {cwd:"/p/.worktrees/x",placeholderCwd:"/p",focus:false}`, `spawningCwds ∋ /p` · trigger `session_added {s3,/p/.worktrees/x}` without `spawnRequestId` · observable no `navigate`, `rq_w` removed, `clearSpawningCwd("/p")` (test-plan #E3).
- [x] 2.4 L1 test: input pending `rq_p {cwd:"/p",focus:false}`, `spawningCwds ∋ /p` · trigger `session_added {s4,/p}` without `spawnRequestId` (Tier 2) · observable no `navigate`, `rq_p` removed, `clearSpawningCwd("/p")` (test-plan #E4).
- [x] 2.5 L1 test: input pending `rq_a {cwd:"/p",focus:false}` + `rq_b {cwd:"/p"}`, `spawningCwds ∋ /p` · trigger `session_added {s5,/p}` without `spawnRequestId` · observable `navigate("/session/s5")` once, exactly one of `rq_a`/`rq_b` removed (test-plan #E5).
- [x] 2.6 L1 test: input no pending entries, `spawningCwds ∋ /p` · trigger `session_added {s6,/p}` without `spawnRequestId` · observable `navigate("/session/s6")`, `clearSpawningCwd("/p")` (test-plan #E6).
- [x] 2.7 L1 test: input pending `rq_60 {cwd:"/p",focus:false}` + `rq_61 {cwd:"/q"}` · trigger `session_added {s7,/q, spawnRequestId:"rq_61"}` · observable `navigate("/session/s7")`, `rq_60` still pending (test-plan #E7).
- [x] 2.8 L1 test: input pending `rq_w {cwd:"/p/.worktrees/x",placeholderCwd:"/p",focus:false}`, `spawningCwds ∋ /p` · trigger `session_added {s8,/p}` without `spawnRequestId` · observable `rq_w` still pending, `navigate("/session/s8")` as today (test-plan #E8).
- [x] 2.9 L1 test: input pending `rq_50 {cwd:"/p",focus:false}` · trigger `session_added {s9,/p, spawnRequestId:"rq_50", reconciled:true}` · observable no `navigate`, `rq_50` removed, `clearSpawningCwd("/p")` (test-plan #E9).
- [x] 2.10 L1 test: input pending `rq_50 {cwd:"/p",focus:false}` · trigger `session_added {s10,/p,hidden:true, spawnRequestId:"rq_50"}` · observable no `navigate`, `rq_50` still pending, `clearSpawningCwd` not called (test-plan #E10).
- [x] 2.11 L1 test: input pending `rq_50 {cwd:"/p",focus:false}`, location moved to `/settings` before arrival · trigger `session_added {s11,/p, spawnRequestId:"rq_50"}` · observable no `navigate`, `rq_50` removed (test-plan #F1).
- [x] 2.12 L1 test: input pending `rq_50 {cwd:"/p",focus:false}` · trigger `spawn_result {success:false, requestId:"rq_50", cwd:"/p"}` · observable `rq_50` removed, `clearSpawningCwd("/p")`, no `navigate` (test-plan #X1).
- [x] 2.13 Implement in `useMessageHandler.ts` `session_added`: Tier 1 (`:564-575`) gates `navigate` on `entry.focus !== false`; Tier 2 (`:576-582`, gate `spawningCwdsRef.has(session.cwd)` unchanged) and Tier 2.5 (`:583-602`) collect `kind:"spawn"` entries with `pathKey(entry.cwd) === pathKey(session.cwd)`, consume first match (cleanup via `placeholderCwd ?? cwd`), withhold `navigate` only when ≥1 match and all have `focus === false`; reconciled and hidden branches untouched. Verify 2.1–2.12 pass and all existing `hooks/__tests__/useMessageHandler.*` tests still pass.

## 3. Board wiring (design D5)

- [x] 3.1 L1 test in `packages/client/src/components/__tests__/OpenSpecBoardView.test.tsx` (extend the existing "create & spawn fires onSpawnSession" case ~line 154): input board on `/p` with change `add-thing` · trigger click card `+ Session` · observable `onSpawnSession` called with `("/p","add-thing",{focus:false})` (test-plan #E12).
- [x] 3.2 L1 test in the same file: input New-proposal dialog name `add-thing`, worktree off then on · trigger submit · observable off → `onSpawnSession("/p","add-thing",{focus:false})`; on → `onSpawnAttachedWorktree("/p","add-thing")`, `onSpawnSession` not called (test-plan #E13).
- [x] 3.3 Implement: widen `onSpawnSession` prop opts at `OpenSpecBoardView.tsx:112` and `:1049` with `focus?: boolean`; pass `{ focus: false }` at `:640` and `:1111`; in `App.tsx:3384` call `handleSpawnSession(path, opts?.attachProposal, { ...opts, placeholderCwd, focus: false })` with `focus: false` last. Verify 3.1–3.2 pass and `tsc` passes.

## 4. End-to-end (L3, docker harness)

- [x] 4.1 L3 Playwright spec `tests/e2e/openspec-board-spawn-no-focus.spec.ts` (harness glue from `tests/e2e/session-spawn.spec.ts` + board setup from `tests/e2e/openspec-board-drop.spec.ts`): input `/fixtures/sample-git` with an OpenSpec change, page at `/folder/<enc>/openspec` · trigger click card `+ Session`, wait ≤60 s for register · observable URL stays on the board, URL never matched `/session/`, new session listed on that change card (test-plan #F2).
- [x] 4.2 L3 test in the same spec: input same board, worktree enabled · trigger card `New worktree` → confirm dialog, wait ≤60 s · observable URL stays on the board, never matched `/session/`, parent-folder spawn placeholder cleared (test-plan #F3).

## 5. Verification & docs

- [x] 5.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and confirm no failures via `grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`.
- [x] 5.2 Manual QA after `npm run build && curl -X POST http://localhost:8000/api/restart`: fan out 3 board spawns (card `+ Session`, card `New worktree`, New-proposal create) — each new session is noticeable on its card without a toast; sidebar `+` still focuses (test-plan: manual-only, #M1).
- [x] 5.3 Update DOX rows for touched files with `See change: openspec-board-spawn-no-focus`: `packages/client/src/hooks/AGENTS.md` (useSessionActions, useMessageHandler + new test files), `packages/client/src/components/openspec/OpenSpecBoardView.tsx.AGENTS.md`, the directory owning `App.tsx`, and `tests/e2e/` sidecar for the new spec; verify each row exists via `kb_search --doc-type agents`.

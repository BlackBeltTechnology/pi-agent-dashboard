## 1. Plugin API + shared types

- [x] 1.1 Add `close?: { idle?: { afterMs: number }; mode?: "sleep" | "archive" }` to `PluginSessionLifecycle` in `packages/dashboard-plugin-runtime/src/server/server-context.ts`
- [x] 1.2 Add `registerSessionCloser(fn)` (fn receives `{ sessionId, cwd, reason, idleMs }`) and `requestSessionClose({ sessionId, reason, when })` to `ServerPluginContext` (types + context builder passthrough)
- [x] 1.3 Add optional `closePolicy?: { owner: string; idleAfterMs?: number; mode: "sleep" | "archive" }` to `DashboardSession` (`packages/shared/src/types.ts`) and `SessionMeta` (`packages/shared/src/session-meta.ts`)

## 2. Declaration capture + persistence

- [x] 2.1 Accept and validate `close` in `packages/server/src/pending/pending-plugin-ref-registry.ts` (invalid block dropped with a warning naming plugin id + spawn token; untrusted plugin's block ignored); add `"closePolicy"` to `CORE_RESERVED_REF_KEYS`
- [x] 2.2 Apply `closePolicy` (with the declaring `ownerId`) at first register in `packages/server/src/event-wiring.ts`, persisting via `mergeSessionMeta` like `archiveOnEnd`
- [x] 2.3 Persist / restore `closePolicy` in `packages/server/src/session/session-to-meta.ts`, `session/session-scanner.ts`, and the `session/memory-session-manager.ts` register carry-over

## 3. Reaper

- [x] 3.1 In `packages/server/src/embed-lifecycle/idle-reaper.ts`, keep the early return only when `!enabled` and no session is governed or close-requested; otherwise filter per session `(enabled && isEphemeral) || governed || closeRequested` before any probe
- [x] 3.2 Extend `LifecycleSignals` with `governed`, `idleTimeoutMs?`, `closeRequested`; `decideReap` (`quiescence.ts`) scopes `governed || isEphemeral || closeRequested`, uses the per-session threshold, and treats `closeRequested` as idle-expired while keeping every other veto
- [x] 3.3 Add a closer registry (one closer per trusted plugin id); consult it in `reapOne` for governed, non-close-requested sessions only, with the minimal view, 1 s per-call bound, 5 s per-sweep budget (overflow deferred), throw / timeout / unknown value treated as keep
- [x] 3.4 Apply close mode after a close: `archive` sets `archiveOnEnd` (+ persist), still subject to `sessionList.archiveServiceSessionsOnEnd`
- [x] 3.5 Extend `lifecycle-metrics.ts` with `closerKeeps`, `closerFailures`, `pluginCloseRequests`; mark governed reaps `declared: true` + owner id; log every verdict
- [x] 3.6 Exclude declared sessions from caps reclaim in `caps.ts`

## 4. Server wiring

- [x] 4.1 Wire the closer registry and `requestSessionClose` into the plugin ctx in `packages/server/src/server.ts` behind the `priority <= 100` trusted gate; owner check `closePolicy.owner === plugin.manifest.id`
- [x] 4.2 Remove a plugin's closer when the plugin is disabled

## 5. Team plugin migration

- [x] 5.1 Declare `close: { idle: { afterMs: idleMinutes*60_000 }, mode: "sleep" }` on team spawns when `idleMinutes > 0` (`packages/team-plugin/src/server/conversations.ts`)
- [x] 5.2 Remove `sweepIdle`, its interval and `sweepEveryMs`
- [x] 5.3 Register a team closer during activation: `records.locate(sessionId)` to conversation key, return `keep` while that key is in `inFlight`, else `close`

## 6. Docs

- [x] 6.1 Update `packages/server/src/embed-lifecycle/AGENTS.md`, `packages/team-plugin/src/server/AGENTS.md`, and the dashboard-plugin-runtime AGENTS row for the new ctx members
- [x] 6.2 DocScribe: document the plugin close hook in the plugin-author docs (`docs/`)

## 7. Tests (folded from test-plan.md; write each before its implementation task)

- [x] 7.1 Declaration validation BVA — see `packages/server/src/pending/__tests__/pending-plugin-ref-registry.test.ts`. Input: `close.idle.afterMs` 999 / 1000 / 1800000 / 1000.5 / Infinity / NaN / "30"; trigger: file the declaration; observable: 1000 and 1800000 accepted, the rest dropped with one warning each naming plugin id + spawn token (test-plan #E1)
- [x] 7.2 Close mode partitions — see `packages/server/src/pending/__tests__/pending-plugin-ref-registry.test.ts`. Input: `mode` sleep / archive / absent / "detach"; trigger: file the declaration; observable: sleep and archive kept, absent becomes sleep, "detach" drops the block with a warning (test-plan #E2)
- [x] 7.3 pluginRef cannot forge closePolicy — see `packages/server/src/pending/__tests__/pending-plugin-ref-registry.test.ts`. Input: ref body with a `closePolicy` key and no declaration; trigger: register; observable: session has no closePolicy, key rejected as core-reserved (test-plan #E3)
- [x] 7.4 closePolicy persists across restart — see `packages/server/src/embed-lifecycle/__tests__/lifecycle-marker-persistence.test.ts`. Input: session with closePolicy {owner, idleAfterMs 1800000, sleep}; trigger: sessionToMeta then scanner rehydrate; observable: restored closePolicy deep-equals the original (test-plan #E4)
- [x] 7.5 Undeclared behavior unchanged decision table — see `packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts`. Input: enabled × lifecyclePolicy × closePolicy grid, all quiescent and idle 2 h; trigger: sweepOnce; observable: reaped iff (enabled and ephemeral) or governed; enabled:false with nothing governed calls the probe 0 times (test-plan #E5)
- [x] 7.6 Governed threshold boundary with feature disabled — see `packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts`. Input: governed idleAfterMs 1800000, enabled:false, quiescent; trigger: sweeps at idle age 1799999 and 1800001 ms; observable: no kill, then exactly one killBySessionId (test-plan #E6)
- [x] 7.7 Every quiescence veto applies to governed sessions — see `packages/server/src/embed-lifecycle/__tests__/quiescence.test.ts`. Input: governed session past threshold with one veto at a time (subscriber, grace, currentTool, pending ask, followUp, steering, terminal in cwd, live child); trigger: decideReap; observable: skip with that veto reason each time, reap("idle") with none (test-plan #E7)
- [x] 7.8 Governed gears 2 and 3 — see `packages/server/src/embed-lifecycle/__tests__/quiescence.test.ts`. Input: governed streaming session idle past threshold with empty queues, and one streaming past hard ceiling at ~0 CPU; trigger: decideReap; observable: stop-after-turn and phantom respectively (test-plan #E8)
- [x] 7.9 Closer verdicts — see `packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts`. Input: governed reap candidate with closer close / keep / none; trigger: reapOne; observable: close kills once; keep does not kill, closerKeeps+1, closer asked again next sweep; none kills once (test-plan #E9)
- [x] 7.10 Closer isolation — see `packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts`. Input: plugin X closer; candidates declared by Y and ephemeral-only; trigger: sweepOnce with enabled:true; observable: X closer called 0 times, both killed (test-plan #E10)
- [x] 7.11 Closer receives the minimal view — see `packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts`. Input: governed session with two plugins' pluginRefs and principalOwner; trigger: closer invoked; observable: argument keys exactly sessionId, cwd, reason, idleMs (test-plan #E11)
- [x] 7.12 Closer not on other close paths — see `packages/server/src/__tests__/plugin-ctx-session-mutations.test.ts` and `packages/server/src/embed-lifecycle/__tests__/caps.test.ts`. Input: governed session whose closer returns keep; trigger: user shutdownSession, abortSpawnedRun, caps candidate selection; observable: shutdown and abort kill without asking the closer; caps never selects a declared session (test-plan #E12)
- [x] 7.13 requestSessionClose now — see `packages/server/src/__tests__/plugin-ctx-session-mutations.test.ts`. Input: declared session owned by caller; trigger: when:"now"; observable: returns true, shutdown hint + one killBySessionId, closer not called, pluginCloseRequests+1 (test-plan #E13)
- [x] 7.14 requestSessionClose idle waits for a pending question — see `packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts`. Input: mode-only declared session with a pending ask, no watcher; trigger: request when:"idle", sweep, answer, settle, sweep; observable: no kill first, killed after answer + settle, closer never called (test-plan #E14)
- [x] 7.15 Idle request survives new activity — see `packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts`. Input: closeRequested session then agent_start; trigger: sweep mid-run, then agent_settled, sweep; observable: no kill and no stop-after-turn mid-run, killed after settle (test-plan #E15)
- [x] 7.16 requestSessionClose refusals — see `packages/server/src/__tests__/plugin-ctx-session-mutations.test.ts`. Input: other plugin's / undeclared / unknown / ended session, and when:"later"; trigger: requestSessionClose; observable: false, no kill, exactly one warning per call (test-plan #E16)
- [x] 7.17 Archive mode — see `packages/server/src/session/__tests__/archive-sweeper.test.ts`. Input: governed mode:"archive" quiescent past threshold plus a mode:"sleep" sibling; trigger: sweep; observable: archive session killed with archiveOnEnd true and persisted; sleep sibling killed with archiveOnEnd unset (test-plan #E17)
- [x] 7.18 Reap diagnostics mark declared sessions — see `packages/server/src/embed-lifecycle/__tests__/lifecycle-metrics.test.ts`. Input: governed idle reap and ephemeral idle reap; trigger: sweep; observable: governed record has reason idle, declared true and owner id; ephemeral record has no declared flag (test-plan #E18)
- [x] 7.19 Trust gate on the new ctx members — see `packages/server/src/__tests__/plugin-ctx-session-mutations.test.ts`. Input: plugin manifest priority 500; trigger: registerSessionCloser, requestSessionClose; observable: closer never registered, request returns false (test-plan #E19)
- [x] 7.20 Closer routing only to the declaring plugin — see `packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts`. Input: A declares with no closer, B registers a closer; trigger: governed reap of A's session; observable: B's closer not called, session closed (test-plan #E20)
- [x] 7.21 Team spawn declaration — see `packages/team-plugin/src/server/__tests__/conversations.test.ts` (harness `harness.ts`). Input: idleMinutes 30 and 0; trigger: conversation ensure spawns; observable: 30 carries close {idle {afterMs 1800000}, mode sleep}; 0 carries no close (test-plan #E21)
- [x] 7.22 Team has no own idle timer — see `packages/team-plugin/src/server/__tests__/conversations.test.ts`. Input: team service started; trigger: inspect API and timers; observable: no sweepIdle method, no 5-minute interval (test-plan #E22)
- [x] 7.23 Team closer keeps during ensure — see `packages/team-plugin/src/server/__tests__/conversations.test.ts`. Input: idle-reapable team session with an ensure pending for its conversation; trigger: invoke team closer before and after the ensure resolves; observable: keep, then close (test-plan #E23)
- [x] 7.24 Team restart stays immediate — see `packages/team-plugin/src/server/__tests__/conversations.test.ts`. Input: live team session; trigger: restartConversation; observable: abortSpawnedRun graceful called at once, closer not consulted (test-plan #E24)
- [x] 7.25 Per-sweep closer budget — see `packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts` (fake timers). Input: 10 governed candidates with a closer that never resolves; trigger: one sweep; observable: sweep returns within 5 s fake time, unasked candidates deferred (not killed), each timeout counted in closerFailures (test-plan #P1)
- [x] 7.26 Throwing closer — see `packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts`. Input: closer throws; trigger: governed reap; observable: no kill, warning logged, closerFailures+1 (test-plan #X1)
- [x] 7.27 Slow closer — see `packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts` (fake timers). Input: closer resolves after 1500 ms; trigger: governed reap; observable: treated as keep at 1000 ms, no kill, closerFailures+1 (test-plan #X2)
- [x] 7.28 Unknown closer value — see `packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts`. Input: closer returns "maybe"; trigger: governed reap; observable: no kill, closerFailures+1 (test-plan #X3)
- [x] 7.29 Plugin disabled removes its closer — see `packages/server/src/__tests__/plugin-ctx-session-mutations.test.ts`. Input: closer registered, then plugin disabled; trigger: governed reap; observable: closer not called, session killed (test-plan #X4)
- [x] 7.30 Restart drops an idle request — see `packages/server/src/embed-lifecycle/__tests__/lifecycle-marker-persistence.test.ts`. Input: closeRequested set, then rehydrate; trigger: sweep before the governed threshold; observable: no kill (test-plan #X5)

## 1. Provenance discriminator (prerequisite — unblocks everything)

- [x] 1.1 Add `"embed"` to `SessionSource` and `lifecyclePolicy?: "ephemeral" | "durable"` to `DashboardSession` in `packages/shared/src/types.ts` (absent ⇒ durable). → verify: `npm test` typechecks.
- [x] 1.2 Persist `lifecyclePolicy` to `.meta.json` and restore it in `session-scanner` cold-start rehydration; add an `isEphemeral(session)` accessor used by every downstream gate. → verify: round-trips through meta; restart does not reclassify.
- [x] 1.3 Wire existing producers: the dashboard embed acquire path and automation/flow-triggered spawns set `lifecyclePolicy:"ephemeral"`; interactive UI/TUI spawns stay `durable`. → verify: each spawn call-site sets the intended policy.

## 2. Idempotent server-side acquire

- [x] 2.1 Add a `visitor-session-registry` with a `identityKey → Promise<Session>` coalescing map (canonical cwd = realpath + case-normalized); resolve only on `session_register`, with a bounded register timeout that rejects + clears the entry. → verify: typechecks; wired into the spawn/resume path.
- [x] 2.2 Implement `acquire(identityKey)`: reuse-live → resume-ended (policy-permitting) → validate cwd against a server-side allowlist → spawn-one; re-point the key across resume's fresh-sessionId renumber. → verify: all branches reachable.

## 3. Quiescence predicate aggregator + liveness probe

- [x] 3.1 Add a pure `isQuiescent(session, deps)` over the union (captured `agent_settled` latest, `currentTool` null, no pending ask, empty `followUp`/`steering`, no live pid-child, no terminal in cwd, no subscriber, past grace window, `lastActivityAt` > timeout). → verify: pure/injectable, no server instance needed.
- [x] 3.2 Add a `lastSettledAt` capture in `event-wiring.ts` (from the normalized `agent_settled`); seed it from session-file mtime on cold start. → verify: capture + seed observable.
- [x] 3.3 Add a bounded pid-child-tree + CPU liveness probe (extends `process-classifier`) serving BOTH the gear-1 child check and gear-3 phantom detection. → verify: returns child-list + CPU for a session's pi tree.

## 4. Idle reaper loop (three gears)

- [x] 4.1 Periodic sweep reaps `isEphemeral && isQuiescent` via `killBySessionId`, marks ended, preserves history. → verify: wired to a config cadence.
- [x] 4.2 Gear 2: streaming + unwatched + empty queues + past timeout ⇒ `stop_after_turn` (never when queues non-empty). → verify: branch selects stop_after_turn only under the guard.
- [x] 4.3 Gear 3 (phantom): force-reap via the graceful `killBySessionId` ladder when wedged AND no pending ask AND empty queues. → verify: distinct `"phantom"` reason recorded.

## 5. Active-session caps

- [x] 5.1 Enforce `maxActiveEmbedSessionsPerVisitor` + `maxActiveEmbedSessionsGlobal` at acquire (count only `ephemeral`); reclaim oldest quiescent first, else structured capacity error; coordinate with the reaper via a being-reclaimed set. → verify: global cap is the hard bound.

## 6. Observability

- [x] 6.1 Track counters (active/idle, reaped-by-reason, capacity rejections, acquire reuse hit/miss, per-session last-activity) and expose via `/api/health` and/or a JWT-gated diagnostics endpoint. → verify: endpoint returns the shape.

## 7. Config + off-by-default wiring

- [x] 7.1 Add config keys (enable flag, idle timeout, hard ceiling, grace window, register timeout, both caps) under `~/.pi/dashboard/config.json`, all default-inert. → verify: defaults leave reaper/caps/acquire dormant.

## 8. Tests — L1 vitest (folded from test-plan.md)

- [x] 8.1 E1 — provenance decision-table. Triple: (durable/absent/ephemeral session, feature on, idle>timeout · reaper sweep · durable+absent untouched, ephemeral reaped). see packages/server/src/__tests__/last-activity-broadcast.test.ts (test-plan #E1)
- [x] 8.2 E2 — absent policy ⇒ durable. Triple: (session without `lifecyclePolicy` · load · treated as durable). see packages/server/src/__tests__/active-sessions-in-cwd.test.ts (test-plan #E2)
- [x] 8.3 E3 — marker survives restart. Triple: (ephemeral persisted to `.meta.json` · restart + session-scanner rehydrate · restored ephemeral, reap-eligible). see packages/server/src/session/__tests__/session-diff-cache.test.ts (test-plan #E3)
- [x] 8.4 E4 — producers set ephemeral. Triple: (spawn via embed acquire / automation trigger · spawn · session is ephemeral). see packages/server/src/__tests__/automation-session-close.test.ts (test-plan #E4)
- [x] 8.5 E5 — interactive stays durable. Triple: (human UI/TUI spawn · spawn · durable, ungoverned). see packages/server/src/__tests__/automation-session-close.test.ts (test-plan #E5)
- [x] 8.6 E6 — reopen/refresh reuse. Triple: (live session exists for visitor/cwd · reopen/refresh acquire · returns existing, no new pi). see packages/server/src/__tests__/active-sessions-in-cwd.test.ts (test-plan #E6)
- [x] 8.7 E7 — localStorage loss reuse. Triple: (no local hint, live server session · acquire · reuses server session, no spawn). see packages/server/src/__tests__/active-sessions-in-cwd.test.ts (test-plan #E7)
- [x] 8.8 E8 — concurrent acquires converge. Triple: (no live session · two concurrent acquires same key · exactly one spawn, both resolve to it). see packages/server/src/pending/__tests__ or last-activity-broadcast.test.ts (test-plan #E8)
- [x] 8.9 E9 — spawn→register window. Triple: (first acquire spawning, pre-register · second acquire same key · joins in-flight, no second pi). see packages/server/src/__tests__/last-activity-broadcast.test.ts (test-plan #E9)
- [x] 8.10 E10 — resume renumber re-points key. Triple: (key's session reaped · acquire · resumes fresh sessionId, key re-points). see packages/server/src/__tests__/faux-session.integration.test.ts (test-plan #E10)
- [x] 8.11 E11 — canonical cwd collapses. Triple: (same dir via symlink/worktree/case-variant · two acquires same visitor · one identityKey, one session). see packages/server/src/__tests__/active-sessions-in-cwd.test.ts (test-plan #E11)
- [x] 8.12 E12 — eligible idle reaped. Triple: (quiescent ephemeral, age=timeout+1 · sweep · reaped via graceful path). see packages/server/src/__tests__/headless-pid-registry-kill-escalation.test.ts (test-plan #E12)
- [x] 8.13 E13 — reaping preserves resumable history. Triple: (quiescent reaped then acquired · resume · full conversation reconstructed from session file). see packages/server/src/__tests__/faux-session.integration.test.ts (test-plan #E13)
- [x] 8.14 E14 — cold-start settle seed. Triple: (rehydrated quiescent ephemeral, no captured lastSettledAt · sweep after restart · seeded from mtime, evaluable, reaped). see packages/server/src/__tests__/last-activity-broadcast.test.ts (test-plan #E14)
- [x] 8.15 E15 — phantom force-reap. Triple: (streaming, no settle past ceiling, no child, ~0 CPU, no watcher, no ask, empty queues · sweep · force-reaped reason "phantom", distinct from idle). see packages/server/src/__tests__/event-wiring-process-classify.test.ts (test-plan #E15)
- [x] 8.16 E16 — phantom uses graceful ladder. Triple: (phantom-eligible · phantom reap · SIGTERM→grace→SIGKILL ladder, resumable after). see packages/server/src/__tests__/headless-pid-registry-kill-escalation.test.ts (test-plan #E16)
- [x] 8.17 E17 — caps reclaim oldest. Triple: (at cap, ≥1 quiescent · acquire · oldest quiescent reaped, acquire succeeds). see packages/server/src/__tests__/force-kill-handler.test.ts (test-plan #E17)
- [x] 8.18 E18 — caps count only ephemeral. Triple: (mix ephemeral+durable at cap · acquire · only ephemeral counted/reclaimed). see packages/server/src/__tests__/active-sessions-in-cwd.test.ts (test-plan #E18)
- [x] 8.19 E19 — global cap bounds spoof. Triple: (one actor mints N visitorIds · N acquires · total bounded by global cap). see packages/server/src/__tests__/active-sessions-in-cwd.test.ts (test-plan #E19)
- [x] 8.20 E20 — observability counters. Triple: (reuse vs spawn; reap by each reason; capacity reject · each path fires · matching counter increments). see packages/server/src/__tests__/last-activity-broadcast.test.ts (test-plan #E20)
- [x] 8.21 E21 — diagnostics endpoint. Triple: (active+idle+reaped-by-reason state · GET /api/health or diagnostics · reports counts + reaped-by-reason). see packages/server/src/__tests__/ (server route test) (test-plan #E21)
- [x] 8.22 E22 — off by default. Triple: (feature disabled, no ephemeral spawns · run · no reap/cap/reuse, spawn unchanged). see packages/server/src/__tests__/last-activity-broadcast.test.ts (test-plan #E22)
- [x] 8.23 E23 — version-agnostic settle. Triple: (floor-pi synth settle vs native agent_settled · gate eval · both satisfy gate identically). see packages/extension/src/__tests__ agent-settled tests (test-plan #E23)
- [x] 8.24 F1 — graceful stop after turn. Triple: (ephemeral streaming, empty queues, no watcher, past timeout · sweep · stop_after_turn, ends after turn_end, resumable). see packages/server/src/__tests__/last-activity-broadcast.test.ts (test-plan #F1)
- [x] 8.25 F2 — stop skipped with queued work. Triple: (ephemeral streaming, non-empty followUp, no watcher, past timeout · sweep · NOT stopped, drains first). see packages/server/src/__tests__/last-activity-broadcast.test.ts (test-plan #F2)
- [x] 8.26 F3 — disconnect ≠ reclaim busy. Triple: (sole subscriber on busy session · disconnect · stays alive; reap-eligible only after quiescence+timeout). see packages/server/src/__tests__/active-sessions-in-cwd.test.ts (test-plan #F3)
- [x] 8.27 X1 — out-of-allowlist cwd rejected. Triple: (cwd outside allowlist · acquire · rejected, no spawn). see packages/server/src/__tests__/force-kill-handler.test.ts (test-plan #X1)
- [x] 8.28 X2 — register timeout no hang. Triple: (spawn never emits session_register · acquire + timeout · result rejects, entry cleared, no hang). see packages/server/src/__tests__/last-activity-broadcast.test.ts (test-plan #X2)
- [x] 8.29 X3 — caps exhausted error. Triple: (at cap, all ephemeral busy · acquire · structured capacity error, nothing terminated). see packages/server/src/__tests__/force-kill-handler.test.ts (test-plan #X3)
- [x] 8.30 X4 — every busy signal vetoes reaping. Triple: (flip ONE of generation/currentTool/ask/followUp/terminal-in-cwd/live-child/watcher/grace-window · sweep · NOT reaped, per case). see packages/server/src/__tests__/last-activity-broadcast.test.ts (test-plan #X4)
- [x] 8.31 X5 — phantom ask-guard. Triple: (streaming past ceiling, ~0 CPU, no child, no watcher, BUT unanswered ask / non-empty queue · sweep · NOT force-reaped). see packages/server/src/__tests__/event-wiring-process-classify.test.ts (test-plan #X5)

## 9. Tests — L2 qa smoke (folded from test-plan.md)

- [x] 9.1 P1 — reclamation soak. Triple: (spawn N ephemeral sessions, leave all quiescent past idle timeout · one sweep interval + grace · aggregate pi process count → 0 and aggregate RSS drops below floor). L2; needs a small pid-count + RSS-sum helper; see qa/tests/02-server-start.sh for harness (test-plan #P1)

## 10. QA & docs

- [x] 10.1 Full-suite green + Biome clean on changed files. → verify: `npm test`; `npm run quality:changed`.
- [x] 10.2 Document the lifecycle config keys + provenance marker in `docs/` (delegate `docs/` prose to DocScribe, caveman style) and add the directory `AGENTS.md` rows for new files. → verify: `kb dox lint` clean.

## 1. Resolve open questions (design.md)

- [x] 1.1 Decide persist-reduced-messages vs persist-raw-events; measure payload size + load-time re-reduce cost; record in design.md
- [x] 1.2 Decide whether to persist the `pi-asset:<hash>` registry or accept placeholder-until-resubscribe; record in design.md
- [x] 1.3 Confirm `entryId` availability on `tool_execution_end` (bridge live path + state-replay.ts); decide B sequencing (ship with A vs defer)
- [x] 1.4 Pick the Strategy B stub threshold (e.g. ≥ 4 KB, aligned to truncation cap) + preview length

## 2. Replay-cache store (session-replay-persistence)

- [x] 2.1 Write failing tests: `replay-cache.ts` get/put/evict round-trip, schemaVersion mismatch → miss, LRU eviction by last-access (fake IndexedDB)
- [x] 2.2 Implement `packages/client/src/lib/replay-cache.ts` (IndexedDB, `{ schemaVersion, maxSeq, payload, lastAccess }` per session, size cap + LRU)
- [x] 2.3 Make 2.1 pass

## 3. Rehydrate + delta subscribe on load (session-replay-persistence)

- [x] 3.1 Write failing test: on mount with a cached session, `subscribe` is sent with `lastSeq = persistedMaxSeq` (not 0); state pre-seeded from cache
- [x] 3.2 In `App.tsx`, rehydrate `sessionStates` + `maxSeqMapRef` from `replay-cache` before first subscribe; persist on reducer commit (debounced)
- [x] 3.3 Render rehydrated state as provisional; reconcile against first `event_replay` batch (`firstSeq <= maxSeq` rule)
- [x] 3.4 Make 3.1 pass

## 4. Invalidation (session-replay-persistence)

- [x] 4.1 Write failing test: `session_state_reset` purges the session's cache entry and falls back to full replay
- [x] 4.2 In `useMessageHandler.ts`, handle `session_state_reset` → `replay-cache.delete(sessionId)`; ensure a contradicting delta also purges
- [x] 4.3 Make 4.1 pass

## 5. Stub emission in replay (lazy-expand-full-fidelity)

- [x] 5.1 Write failing test: replayed `tool_execution_end` above threshold carries `{ stub:true, byteSize, preview, entryId }`; below threshold unchanged
- [x] 5.2 Record pre-truncation `byteSize` in `memory-event-store.ts` (no change to truncation behavior)
- [x] 5.3 Emit the stub shape during replay in `subscription-handler.ts` (additive; live streaming path unchanged)
- [x] 5.4 Make 5.1 pass

## 6. Full-fidelity fetch route (lazy-expand-full-fidelity)

- [x] 6.1 Write failing test: JSONL-backed route returns the untruncated tool body by `entryId`; 404 on unknown id
- [x] 6.2 Add the route in `session-routes.ts` (reads JSONL, NOT the truncated memory store)
- [x] 6.3 Make 6.1 pass

## 7. Lazy render on expand (lazy-expand-full-fidelity)

- [x] 7.1 Write failing test: collapsed stub renders header + preview; expand fetches full body + renders; offline expand shows preview + error affordance
- [x] 7.2 Wire stub render + on-expand fetch in the tool renderer(s), mirroring `AgentToolRenderer` lazy-expand precedent; show "Show full output (N KB)"
- [x] 7.3 Make 7.1 pass

## 8. Verify

- [x] 8.1 `npm test` green — all 28 new deterministic tests pass; remaining suite failures are pre-existing baseline (image-fit jimp import) + flaky-under-parallel-load server tests that pass in isolation (verified: session-api, shutdown, dedup, doctor, auto-attach, model-proxy, worktree). No regression traced to this change.
- [x] 8.2 `openspec validate reduce-session-replay-traffic` passes
- [x] 8.3 Strategy A AUTOMATED via Playwright E2E (`tests/e2e/replay-delta-on-reload.spec.ts`): reload of a seen session resubscribes with `lastSeq > 0` (WS-frame assertion), chat repaints from IndexedDB. PASSES against Docker harness using system Chrome (`PW_E2E_CHANNEL=chrome`). Harness gained env-gated system-browser mode (playwright.config.ts + global-setup.ts).
- [x] 8.4 Strategy B RECONCILED onto develop's `adopt-pi-071-072-073-features` (which shipped the same user-facing "Show full output" feature while this change was in flight). Original stub/byteSize/entryId/JSONL-route mechanism DROPPED; replaced by a minimal server-side replay optimization: `replay-truncate.ts` `truncateToolResultForReplay` pre-truncates heavy (>200-line) tool results to develop's display form (`«N earlier lines hidden»` + last 200 lines) during replay, trimming replay bytes. Store keeps the full body for develop's `toolCallId` route. Added 1-line idempotency guard to `truncateOutputForDisplay`. Tests: `replay-truncate.test.ts` (6), `truncate-output-idempotent.test.ts` (2), E2E `replay-truncate.spec.ts` (wire-level, `PW_CHANNEL=chrome`). Faux `tool-bash-large` = `seq 1 500`.

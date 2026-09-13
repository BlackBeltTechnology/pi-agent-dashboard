## 1. Shared protocol types

- [ ] 1.1 Add `OpenSpecGetMessage`, `OpenSpecGetResultMessage`, `SessionsPageMessage`, `SessionsPageResultMessage` to `packages/shared/src/types.ts`; add `endedTotals: Record<string, number>` to `SessionsSnapshotMessage`; wire them into `BrowserToServerMessage` / `ServerToBrowserMessage`.
- [ ] 1.2 Test E28 (test-plan: automated, L1) — see `packages/shared/src/__tests__/browser-protocol-types.test.ts`. Input: the four new messages and a snapshot with `endedTotals` · trigger: `tsc` over a narrowing file · observable: compiles; `@ts-expect-error` on a missing `requestId` / `offset` fails to compile as expected.

## 2. Gateway delivery policy (`packages/server/src/pairing/browser-gateway.ts`)

- [ ] 2.1 Add `frameClassOf(msg)` (D1): state types → `{cls:"state", key}` with type-qualified keys (`type` or `type:entityKey`; terminal lifecycle frames share `terminal:<id>`); `ctx.critical` → `blocking`; else `transcript`.
- [ ] 2.2 Add per-socket `pendingState` side-table + `sendState(ws, key, serialized)` (D2): OPEN guard, `MAX_WS_BUFFER===0` plain send, defer when over threshold, latest-wins per key with `coalescedState++`, `Buffer.byteLength` accounting, byte ceiling → `ws.terminate()` + `stalledSocketsTerminated++`, insertion-order `flush` on send-callback and a 250 ms interval while non-empty, cleanup on `close`/`error`.
- [ ] 2.3 Route every state-class send through `sendState`: `sendTo` dispatches on `frameClassOf`; `broadcast`/`fanout` per-socket; `broadcastOpenSpecUpdateImpl` passes its pre-serialized string. Transcript path attempts `flush` first when the map is non-empty (D2).
- [ ] 2.4 Move the `sessions_snapshot` bootstrap block to the end of the connect handler (D3), after `terminal_added` and `gateway.onConnect`.
- [ ] 2.5 Expose `coalescedState` and `stalledSocketsTerminated` from the gateway stats; surface under `droppedFrames` in `packages/server/src/routes/system-routes.ts` (D8).
- [ ] 2.6 Test E1 (test-plan: automated, L1) — see `packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts`. Input: one message per D1 type plus `session_updated`, `sessions_reordered`, an event · trigger: `frameClassOf` · observable: state types keyed `type`/`type:entityKey`; `terminal_*` for `t1` → same key; `openspec_update` and `git_head_update` for `/a` → different keys; session frames → transcript.
- [ ] 2.7 Test E2 (test-plan: automated, L1) — see `browser-gateway-dropped-frames.test.ts`. Input: fake ws, `MAX_WS_BUFFER=1000`, `bufferedAmount` ∈ {999,1000,1001} · trigger: `sendTo(openspec_update)` · observable: 999/1000 sent; 1001 deferred, pending size 1, transcript counter unchanged.
- [ ] 2.8 Test E3 (test-plan: automated, L1) — see `browser-gateway-critical-frames.test.ts`. Input: saturated; `openspec_update /a` v1, v2, then `git_head_update /a` · trigger: drain + callback · observable: exactly [`openspec_update` v2, `git_head_update`] flushed; `coalescedState===1`.
- [ ] 2.9 Test E4 (test-plan: automated, L1) — same file. Input: defer K1, K2, K1 · trigger: flush · observable: wire order [K1 newest, K2].
- [ ] 2.10 Test E5 (test-plan: automated, L1) — same file. Input: ceiling 1000, pending 990, next frame 10 then 11 bytes · trigger: `sendTo` · observable: 10 deferred; 11 → one `terminate()`, `stalledSocketsTerminated===1`, map deleted.
- [ ] 2.11 Test E6 (test-plan: automated, L1) — same file. Input: ceiling 100, pending 90, frame `.length` 8 / `byteLength` 12 · trigger: `sendTo` · observable: terminated (bytes, not code units).
- [ ] 2.12 Test E7 (test-plan: automated, L1) — same file. Input: saturated, 100× `git_head_update /a` · trigger: inspect · observable: map size 1, `coalescedState===99`.
- [ ] 2.13 Test E8 (test-plan: automated, L1) — same file. Input: `maxWsBufferBytes:0`, `bufferedAmount` 10 MB · trigger: `sendTo(state)` · observable: sent immediately, no deferral, no timer.
- [ ] 2.14 Test E9 (test-plan: automated, L1) — same file. Input: ws CLOSING with pending entries · trigger: timer tick then `close` · observable: no send, no throw; timer cleared, map deleted.
- [ ] 2.15 Test E10 (test-plan: automated, L1) — see `browser-gateway-snapshot-on-connect.test.ts`. Input: 3 known cwds, 2 terminals, pinned dirs · trigger: new connection · observable: all `openspec_update`, `git_head_update`, prefs/pinned/reachability, `terminal_added` precede the single `sessions_snapshot`; no registry send before it; nothing after it in the same turn.
- [ ] 2.16 Test E11 (test-plan: automated, L1) — see `browser-gateway-critical-frames.test.ts`. Input: pending non-empty, `bufferedAmount` just 0, no callback yet · trigger: `sendTo(transcript)` · observable: pending state sent first, then the transcript frame.
- [ ] 2.17 Test P2 (test-plan: automated, L1) — same file, fake timers. Workload: 50 deferred, socket drains with no further send · metric: all flushed ≤ 250 ms after crossing below threshold.
- [ ] 2.18 Test P3 (test-plan: automated, L1) — same file. Workload: 1,000 state sends unsaturated · observable: zero timers, no pending map allocated for that ws.
- [ ] 2.19 Test P4 (test-plan: automated, L1) — see `browser-gateway-load.test.ts`. Workload: never-draining socket, 10,000 frames / 50 keys / 1 KB, `MAX_WS_BUFFER=20 KB` · observable: retained pending bytes ≤ 20 KB throughout, terminated exactly once, RSS delta < 5 MB.
- [ ] 2.20 Test X3 (test-plan: automated, L1) — see `browser-gateway-handler-errors.test.ts`. Fault: `send` invokes `cb(new Error)` · trigger: flush · observable: one rate-limited log, entry not re-sent, no throw.
- [ ] 2.21 Test X4 (test-plan: automated, L1) — same file. Fault: `terminate()` by ceiling while flush timer pending · trigger: timer · observable: readyState guard, no send, timer cleared.

## 3. Snapshot window + orders (`memory-session-manager.ts`, `session-order-manager.ts`, gateway `broadcast`)

- [ ] 3.1 Add `endedSequence(groupKey)`, `snapshotVisibleIds(pinned)`, `buildSnapshot(pinned)` → `{ sessions, orders, endedTotals }` with `SNAPSHOT_ENDED_GLOBAL=120`, `SNAPSHOT_ENDED_PER_GROUP=3`, group key via `resolveOrderKey`, rows via `stripNotifyLog` (D4). Sort fallback `endedAt ?? lastActivityAt ?? startedAt`, id tiebreak; "non-ended" = `active|idle|streaming`.
- [ ] 3.2 Connect handler uses `buildSnapshot`; `sessions_snapshot` carries `endedTotals`.
- [ ] 3.3 In gateway `broadcast(msg)` (pre-serialization) project `sessions_reordered.sessionIds` through injected `projectOrder(groupKey, ids)` = filter by a fresh `snapshotVisibleIds()` (D4).
- [ ] 3.4 Capture `packages/server/src/__fixtures__/measured-session.json` (one live row with populated `notifyLog`, one ended row) from a real session, PII-scrubbed — new infra per test-plan.
- [ ] 3.5 Test E12 (test-plan: automated, L1) — see `packages/server/src/__tests__/memory-session-manager.test.ts`. Input: group with 1 live + e1..e10 in sequence, 200 newer ended elsewhere · trigger: `buildSnapshot` · observable: live+e1..e3 present, e4..e10 absent; global-120 newest by `endedAt`; `orders[g] ⊆ sessions`; `endedTotals[g]===10`.
- [ ] 3.6 Test E13 (test-plan: automated, L1) — same file. Input: 121 ended distinct `endedAt`, none live/pinned · observable: exactly 120; oldest absent; `endedTotals` sum 121.
- [ ] 3.7 Test E14 (test-plan: automated, L1) — same file. Input: ended worktree session (`mainPath=/p`), `/p` has a live session · observable: counts toward `/p` first-3 and `endedTotals["/p"]`; no raw worktree key.
- [ ] 3.8 Test E15 (test-plan: automated, L1) — same file. Input: pinned `/q`, 0 live, 5 old ended · observable: first-3 present when pinned; absent when unpinned.
- [ ] 3.9 Test E16 (test-plan: automated, L1) — same file. Input: group whose only non-ended is `idle` · observable: group receives its first-3.
- [ ] 3.10 Test E17 (test-plan: automated, L1) — same file. Input: live with 50-entry `notifyLog`, ended with 3 · trigger: `buildSnapshot`, `sessions_page` · observable: no row has `notifyLog`; registry object still does.
- [ ] 3.11 Test E18 + P1 (test-plan: automated, L1) — same file, using 3.4 fixture. Input: 25 live + 4,000 ended cloned rows, 400 groups, 20 pinned · trigger: `JSON.stringify(buildSnapshot())` · observable: `.length ≤ 409,600`; live-only part ≤ 100 KB.
- [ ] 3.12 Test E19 (test-plan: automated, L1) — see `browser-gateway-broadcast-serialize-once.test.ts`. Input: order [live1,e1,e2,e3,e4(out),t-term]; broadcast from `session-meta-handler`, `event-wiring` moveToFront path, `reattach-placement` · observable: every subscriber gets `sessionIds=[live1,e1,e2,e3]` from all three sites.
- [ ] 3.13 Test E20 (test-plan: automated, L1) — same file. Input: session s ends after snapshot, outside window · trigger: `broadcast(sessions_reordered)` · observable: s absent.
- [ ] 3.14 Test X7 (test-plan: automated, L1) — see `memory-session-manager.test.ts`. Fault: status flips between `snapshotVisibleIds` and row projection (getter) · trigger: `buildSnapshot` · observable: every id in `orders` exists in `sessions`.
- [ ] 3.15 Test F5 (test-plan: automated, L1) — see `packages/client/src/components/__tests__/SessionCard.test.tsx`. Input: `SessionCard` from a live row with vs without `notifyLog` · observable: identical DOM.

## 4. `sessions_page` handler (`packages/server/src/browser-handlers/session-meta-handler.ts`)

- [ ] 4.1 Implement `sessions_page { cwd: groupKey, offset }` → `pageable(g) = endedSequence(g).filter(∉ snapshotVisibleIds())`, `PAGE_SIZE=50`, reply `sessions_page_result` via `sendTo` (state, key `sessions_page_result:<g>`) (D5).
- [ ] 4.2 Test E30 (test-plan: automated, L1) — see `packages/server/src/browser-handlers/__tests__/session-meta-handler.test.ts`. Input: pageable 101 ids · trigger: offset ∈ {0,50,100,101,5000} · observable: 50/true, 50/true, 1/false, 0/false, 0/false no throw.
- [ ] 4.3 Test E31 (test-plan: automated, L1) — same file. Input: window [e1,e2,e3], sequence e1..e8 · trigger: offset 0 · observable: [e4..e8].
- [ ] 4.4 Test E32 (test-plan: automated, L1) — same file. Input: worktree ended sessions under `/p` · trigger: `cwd:"/p"` vs raw worktree cwd · observable: `/p` returns them; raw cwd → 0, `hasMore:false`.

## 5. `openspec_get` (`directory-service.ts`, `directory-handler.ts`)

- [ ] 5.1 Extract the tick's per-cwd body into `pollAndBroadcastIfChanged(cwd)` (prevJson → `pollDirectoryGated` → compare → `pendingWasEmitted` → `onChangeCallback`); the tick calls it (D6, behaviour-preserving).
- [ ] 5.2 Add `getOrPollOpenSpec(cwd)` with gates (`enabled` → `GLOBAL_OFF`; opt-out → `OPTED_OUT`; untracked → `ABSENT`; `!hasOpenSpecRoot` → `ABSENT` `hasOpenspecDir:false`), cache hit, cold-miss placeholder (`PENDING`, readiness fold) + per-cwd shared in-flight promise deleted on settle (D6).
- [ ] 5.3 `handleOpenSpecGet` in `directory-handler.ts`: unicast `openspec_get_result{final:!poll}`; on resolve unicast `final:true`; on reject unicast `final:true` `BROKEN · cli-failed`; never broadcasts. Register in the browser message dispatch.
- [ ] 5.4 Test E21 (test-plan: automated, L1) — see `packages/server/src/__tests__/directory-service-readiness.test.ts`. Input: enabled × optedOut × tracked × hasRoot, 16 combos · trigger: `getOrPollOpenSpec` · observable: readiness per branch; spawn spy only for tracked+root+enabled+not-opted-out.
- [ ] 5.5 Test E22 (test-plan: automated, L1) — same file. Input: tracked cwd, `openspec/` without `changes/` · observable: `PENDING` `hasOpenspecDir:true`, then `final:true` `BROKEN · missing-changes-dir`.
- [ ] 5.6 Test E23 (test-plan: automated, L1) — see `packages/server/src/browser-handlers/__tests__/directory-handler.test.ts`. Input: 2 browsers, cached `/a` · trigger: browser 1 `openspec_get` · observable: browser 1 one `final:true`; browser 2 nothing; no poll.
- [ ] 5.7 Test E24 (test-plan: automated, L1) — same file. Input: tracked cold `/b`, poll stub resolves D · trigger: `openspec_get{requestId:"r7"}` · observable: requester [`final:false` PENDING, `final:true` D] both `requestId:"r7"`; others get transitional pending + one `openspec_update` D.
- [ ] 5.8 Test E25 (test-plan: automated, L1) — same file. Input: second get for `/b` after E24 · observable: cache hit; others receive nothing.
- [ ] 5.9 Test E26 (test-plan: automated, L1) — same file. Input: 3 browsers get cold `/c` same tick · observable: poll stub once; each gets own placeholder+final with own `requestId`.
- [ ] 5.10 Test E27 (test-plan: automated, L1) — see `directory-service-pending-emit.test.ts`. Input: warm mtime record, cold data · trigger: `openspec_get` · observable: `pollDirectoryGated` path; CLI spy not called when gate unchanged.
- [ ] 5.11 Test X1 (test-plan: automated, L1) — see `directory-handler.test.ts`. Fault: poll rejects · observable: `final:true` `BROKEN cli-failed`; in-flight entry deleted; next get starts a fresh poll.
- [ ] 5.12 Test X2 (test-plan: automated, L1) — same file. Fault: poll never resolves; requester socket closes · observable: no unhandled rejection; no send on closed socket; later request from another browser shares the promise.
- [ ] 5.13 Test X8 (test-plan: automated, L1) — same file. Fault: `openspec_get` cwd ∈ {`/etc`, `../../`, `""`} from a paired remote socket · observable: single `final:true` `ABSENT`; spawn spy never called; no fs access outside `hasOpenSpecRoot` of tracked cwds.

## 6. Client message handling (`packages/client/src/hooks/useMessageHandler.ts`)

- [ ] 6.1 Handle `sessions_page_result` (merge sessions, `dedupe([...current, ...order])`, `pagedCount[cwd] +=`), `openspec_get_result` (apply as `openspec_update`; resolve in-flight when `final`), `sessions_snapshot.endedTotals` → `endedTotalsMap` (reset `pagedCount`, bump `snapshotGeneration`), live `endedTotals` on `session_updated`→ended / `session_removed`, `sessions_reordered` = `dedupe([...incoming, ...heldNotInIncoming])` filtered to held ids (D9).
- [ ] 6.2 Test E29 (test-plan: automated, L1) — see `packages/client/src/hooks/__tests__/useMessageHandler.event-coalescing.test.tsx`. Input: holds `/g` [a,b]; page {[c,d,b], order [c,d,b], hasMore false} · observable: sessions {a,b,c,d}; order [a,b,c,d]; `pagedCount["/g"]===3`.
- [ ] 6.3 Test E33 (test-plan: automated, L1) — same file. Input: [a,b,p1,p2] with p1,p2 paged · trigger: `sessions_reordered [b,a]` · observable: [b,a,p1,p2].
- [ ] 6.4 Test E34 (test-plan: automated, L1) — same file. Input: `sessions_reordered [a,ghost,b]` · observable: [a,b], no error.
- [ ] 6.5 Test E35 (test-plan: automated, L1) — same file. Input: `endedTotals["/g"]=2`; `session_updated`→ended; `session_removed` of an ended · observable: 3 then 2.
- [ ] 6.6 Test E41 (test-plan: automated, L1) — same file. Input: `openspec_get_result{cwd:"/w", data:D, final:true}` · observable: map entry deep-equals D; in-flight released only on `final:true`.
- [ ] 6.7 Test F4 (test-plan: automated, L1) — same file. Input: pre-change reducer fixture receives state-first frames, windowed snapshot with `endedTotals`, `openspec_get_result`, `sessions_page_result` · observable: no throw; sessions = windowed set; unknown types ignored.

## 7. Client reconciliation + paging UI (`hooks/useOpenSpecReconcile.ts`, `SessionList.tsx`, `App.tsx`)

- [ ] 7.1 Add `useOpenSpecReconcile({ renderedCwds, openspecMap, ws, status, snapshotGeneration })` (D7): `renderedCwds − settled(openspecMap) − inflight`, `pending:true` not settled, one in-flight per cwd, 15 s timeout, clear on socket open. `renderedCwds` = non-ended rendered cards ∪ pinned folder cards ∪ selected session cwd, memoised in `SessionList`/`App`.
- [ ] 7.2 `SessionList`: stub groups from `endedTotalsMap` through `groupSessionsByDirectoryWithWorkspaces`; expander label from `endedTotals`; "more" while `heldEnded < endedTotal`; click → `sessions_page{cwd:g, offset:pagedCount[g]??0}` with per-group in-flight (15 s timeout, clear on open) (D9).
- [ ] 7.3 Test E36 (test-plan: automated, L1) — see `packages/client/src/components/__tests__/SessionList.folder-menu.test.tsx`. Input: `endedTotals["/old"]=3`, no held session, `/old` in workspace W · observable: header for `/old` inside W, expander labelled 3, no cards, no OPENSPEC/KB/GIT sections; sorts last in recency mode.
- [ ] 7.4 Test E37 (test-plan: automated, L1) — new `packages/client/src/hooks/__tests__/useOpenSpecReconcile.test.tsx`, harness glue from `useOpenSpecReader.test.ts`. Input: live cards `/a`,`/b`; ended-only `/c`; stub `/d`; selected ended in `/e`; map settled `/a`, pending `/b` · observable: `openspec_get` for `/b` and `/e` only.
- [ ] 7.5 Test E38 (test-plan: automated, L1) — same file. Input: 5 live cards `/a`, no entry; effect re-runs 3× · observable: exactly one request.
- [ ] 7.6 Test E39 (test-plan: automated, L1) — same file, fake timers. Input: request t=0, no reply · trigger: 14.999 s vs 15 s · observable: nothing, then a new request with a new `requestId`.
- [ ] 7.7 Test E40 (test-plan: automated, L1) — same file. Input: in-flight `/a`; connected→disconnected→connected + snapshot · observable: in-flight cleared; new request if unsettled.
- [ ] 7.8 Test X5 (test-plan: automated, L1) — same file. Fault: placeholder `final:false` then final dropped · trigger: 15 s · observable: re-request; second reply settles.
- [ ] 7.9 Test X6 (test-plan: automated, L1) — see `SessionList.folder-menu.test.tsx`. Fault: `sessions_page` reply lost · trigger: 15 s then "more" · observable: new `sessions_page` with the same `offset`.

## 8. E2E (docker harness; port from `.pi-test-harness.json#dashboardPort`)

- [ ] 8.1 Harness: document/seed `memoryLimits.maxWsBufferBytes=65536` for the F1 spec run and a `PI_E2E_SEED` fixture with > 120 ended sessions + one dir whose only session is outside the window (new infra per test-plan).
- [ ] 8.2 Test F1 (test-plan: automated, L3) — new `tests/e2e/openspec-connect-coverage.spec.ts`, harness glue from `tests/e2e/openspec-init-affordances-folder.spec.ts`. Input: ≥ 2 pinned openspec dirs + 1 live session, 64 KB buffer cap · trigger: load dashboard · observable: within 5 s every folder card and the session card show the OPENSPEC subcard; `/api/health` `droppedFrames.coalescedState ≥ 0`, transcript `total` unchanged by the connect.
- [ ] 8.3 Test F2 (test-plan: automated, L3) — same spec, glue from `tests/e2e/keeper-restart-survival.spec.ts`. Input: loaded dashboard; `POST /api/restart` · observable: after reconnect every live card's OPENSPEC subcard present within 10 s; no duplicates.
- [ ] 8.4 Test F3 (test-plan: automated, L3) — new `tests/e2e/sessions-page-stub-group.spec.ts`, glue from `tests/e2e/folder-actions-menu.spec.ts`. Input: seeded dir outside the window · trigger: click expander · observable: ended list grows by ≤ 50; "more" hidden once held count equals label.

## 9. Docs + closeout

- [ ] 9.1 `docs/architecture.md`: add "Frame delivery policy" (classes, deferral, bounds, bootstrap order) and update "OpenSpec Polling" with `openspec_get`; update the sessions-snapshot paragraph (window, `endedTotals`, paging) — via DocScribe, caveman style.
- [ ] 9.2 Directory `AGENTS.md` rows for every touched/new file (`browser-gateway.ts`, `directory-service.ts`, `directory-handler.ts`, `session-meta-handler.ts`, `memory-session-manager.ts`, `system-routes.ts`, `types.ts`, `useMessageHandler.ts`, `useOpenSpecReconcile.ts`, `SessionList.tsx`, fixtures, new tests, new e2e specs) with `See change: fix-connect-snapshot-frame-loss`.
- [ ] 9.3 Manual F6 (test-plan: manual-only) — visual check of stub group header + "more" affordance against existing folder header styling.
- [ ] 9.4 Follow-up issue: existing `openspec_refresh` handler has no cwd check (flagged in proposal, not fixed here).
- [ ] 9.5 Follow-up issue: reclassify session-registry broadcasts (`session_updated`, `sessions_reordered`) as state-class frames.

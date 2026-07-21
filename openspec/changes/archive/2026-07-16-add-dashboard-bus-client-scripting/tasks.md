# Tasks — add-dashboard-bus-client-scripting

## 1. Package scaffold + bus client core

- [x] Scaffold `packages/bus-client` (`@pi-dashboard/bus-client`); depend on `@pi-dashboard/shared` for protocol types
- [x] Implement `connect()`: port discovery, mint ticket via `POST /api/ws-ticket`, open WS within 15 s TTL, subscribe, resolve on first `sessions_snapshot`
- [x] Implement `send<T extends BrowserToServerMessage>(m)` typed passthrough
- [x] Implement loopback-only auth path + explicit off-box error (no hang)

## 2. Verb codegen + denylist

- [x] Codegen typed verb helpers by enumerating `BrowserToServerMessage` (ts-morph / compiler API)
- [x] Maintain the client-intercepted denylist (start: `plugin_config_write`); exclude denylisted members from generated helpers
- [x] Wire a completeness check: every generated verb resolves to a server receiver

## 3. Correlation + reads

- [x] `spawn()`/`resume()` exact correlation via `spawnRequestId` / `resume_result.requestId`
- [x] `until(sessionId, status, {timeout})` structural wait keyed by session id, off the subscription stream
- [x] `read.sessions()`/`read.session(id)` from snapshot + deltas (registry metadata + status only)

## 4. Plugin passthrough (goal today)

- [x] `plugin(pluginId, action, payload)` emits `plugin_action`; explicit "no handler for pluginId" error for unhandled ids (flows/kb/automation blocked on `fix-plugin-action-fanout-and-handlers`)

## 5. Tier 1 — migrate the pi-dashboard skill curl layer onto the bus client

- [x] Rewrite `packages/extension/.pi/skills/pi-dashboard/scripts/dashboard-api.sh` to wrap the bus client
- [x] Rewrite the `commands/*.md` slash commands to invoke the bus-client wrapper
- [x] Update `SKILL.md` + `references/{recipes,api-reference}.md` to teach typed `.ts` authoring
- [x] Update `.pi/skills/debug-dashboard/scripts/{list-sessions,health-probe}.ts` to read from the subscription snapshot

## 6. Tier 2 — bounded REST-twin consolidation (WS-verb-backed only)

- [x] Route the session/flow command wrappers with real WS verbs (abort, send_prompt, spawn_session, resume_session, flow_control, set_model, set_thinking_level, rename_session, hide/unhide, attach/detach_proposal) through the WS the client already holds
- [x] Leave no-WS-twin wrappers as REST (plugin_config_write, canvas-types, openspec/tasks/toggle, read-only wrappers) — no invented verbs

## Tests

- [x] L1 `packages/bus-client/src/__tests__/connect.test.ts` — connect subscribes (see `packages/server/src/__tests__/browser-gateway-snapshot-on-connect.test.ts`). Triple: valid minted ticket · connect() opens WS · client subscribed, receives sessions_snapshot (test-plan #C1)
- [x] L1 `packages/bus-client/src/__tests__/ticket-expiry.test.ts` — expired ticket rejected (see `packages/server/src/__tests__/draining-ws.test.ts`). Triple: ticket minted then 15001 ms elapse (TTL 15000) · connect presents expired ticket · `ticket-expired` error, not generic close (test-plan #C2)
- [x] L1 `packages/bus-client/src/__tests__/ticket-reuse.test.ts` — consumed ticket reuse rejected (see `browser-gateway-snapshot-on-connect.test.ts`). Triple: already-consumed single-use ticket · second connect reuse · `ticket-consumed` error (test-plan #C3)
- [x] L2 `qa/tests/04-ws-ticket-auth.sh` — off-box mint denied (see `qa/tests/03-websocket.sh`). Triple: non-loopback origin · POST /api/ws-ticket via connect · networkGuard denies, explicit off-box error, no hang (test-plan #C4)
- [x] L1 `packages/bus-client/src/__tests__/send-types.test.ts` — bogus send is a compile error (tsc negative fixture; see any `*.test-d` / tsc pattern in repo). Triple: send() with bad type/missing field · tsc --noEmit · compile error (test-plan #S1)
- [x] L1 `packages/bus-client/src/__tests__/verb-completeness.test.ts` — every generated verb has a receiver (see `packages/server/src/__tests__/browser-gateway-register-handler.test.ts`). Triple: generated verb set · enumerate helpers · each resolves to a server receiver, fail if none (test-plan #S2)
- [x] L1 `packages/bus-client/src/__tests__/codegen-denylist.test.ts` — denylisted verb excluded. Triple: plugin_config_write union member · run codegen · no WS helper emitted for it (test-plan #S3)
- [x] L1 `packages/bus-client/src/__tests__/spawn-correlation.test.ts` — exact spawn correlation (see `packages/shared/src/__tests__/spawn-session-attach-proposal.test.ts`). Triple: spawn mints requestId=X, server echoes spawnRequestId=X + a decoy · spawn resolves on X only, ignores decoy (test-plan #A1)
- [x] L1 `packages/bus-client/src/__tests__/until-convergence.test.ts` — session-keyed wait (see `packages/client/src/__tests__/use-message-handler-pending-prompt.test.ts`). Triple: s1,s2 mid-turn · until(s1,idle) while s2 transitions · resolves on s1→idle only (test-plan #A2)
- [x] L1 `packages/bus-client/src/__tests__/until-timeout.test.ts` — timeout boundary. Triple: until(sid,idle,{timeout:100}), transition never arrives · 100 ms elapse · rejects naming (sid,status) (test-plan #A3)
- [x] L1 `packages/bus-client/src/__tests__/uncorrelated-request.test.ts` — no fake exact-await for request_models. Triple: request_models (no requestId) · attempt exact await · client offers structural match / REST fallback only (test-plan #A4)
- [x] L3 `tests/e2e/bus-client-goal-plugin-action.spec.ts` — goal plugin_action reaches handler (see `tests/e2e/anthropic-bridge-activation.spec.ts`; harness port from `.pi-test-harness.json`). Triple: plugin("goal", action, payload) vs harness · sent · goal handler receives it, no silent drop (test-plan #P1)
- [x] L1 `packages/bus-client/src/__tests__/plugin-unknown-id.test.ts` — unknown pluginId errors. Triple: plugin("flows",…) with no handler · send · explicit "no handler for pluginId: flows" error (test-plan #P2)
- [x] L1 `packages/bus-client/src/__tests__/read-live-consistent.test.ts` — read reflects stream (see `browser-gateway-snapshot-on-connect.test.ts`). Triple: subscribed, session active→idle on stream · read.sessions() after delta · row shows idle, no REST fetch (test-plan #R1)
- [x] L1 `packages/bus-client/src/__tests__/read-metadata-only.test.ts` — reads are metadata-only. Triple: session with chat history · read.session(id) · returns metadata+status, no messages/lastResponse field (test-plan #R2)

## Validate

- [x] `npm test` green for `packages/bus-client`; `npm run quality:changed` clean
- [x] End-to-end smoke: author a `.ts` script (spawn → prompt → until idle → read) against a loopback dashboard; it drives a real session
- [x] Confirm the migrated `pi-dashboard` slash commands still produce equivalent output via the bus client (no REST regression)

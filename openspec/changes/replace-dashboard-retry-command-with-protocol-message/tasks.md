# Tasks — replace-dashboard-retry-command-with-protocol-message

## 1. Protocol + shared types
- [ ] 1.1 Add `RetrySessionBrowserMessage { type: "retry_session"; sessionId }` to `BrowserToServerMessage` in `packages/shared/src/browser-protocol.ts`.
- [ ] 1.2 Add `RetrySessionExtensionMessage { type: "retry_session"; sessionId }` to `ServerToExtensionMessage` in `packages/shared/src/protocol.ts`.
- [ ] 1.3 Add `RetrySessionErrorMessage { type: "retry_session_error"; sessionId; error }` to `ServerToBrowserMessage` in `packages/shared/src/browser-protocol.ts` (mirror `plugin_action_error`).

## 2. Server routing
- [ ] 2.1 Add a `retry_session` case in the browser gateway switch (`packages/server/src/pairing/browser-gateway.ts`) that forwards to the owning session bridge; do NOT let it fall through to the unknown-type `handlePiGatewayForward` default.
- [ ] 2.2 On unknown/disconnected session, emit `retry_session_error` to the sender (follow the `plugin_action_error` "never a silent drop" convention).

## 3. Client dispatch + UI
- [ ] 3.1 Change `handleRetrySession` (`packages/client/src/hooks/useSessionActions.ts`) to send `{ type: "retry_session", sessionId }`; keep the stale-click guard unchanged.
- [ ] 3.2 Handle `retry_session_error` in the client: re-enable the one-shot Retry in `SessionBanner` and surface a toast.

## 4. Bridge handler
- [ ] 4.1 Handle `retry_session` in the bridge/command-handler, calling `pi.sendMessage({ customType: "pi-dashboard:retry", display: false }, { triggerTurn: true })`.
- [ ] 4.2 Wrap the `pi.sendMessage(...)` call in BOTH a synchronous `try/catch` AND `.catch()` (it is async) so a sync throw OR an async rejection emits `auto_retry_end { success:false, attempt:0, finalError }`. (Spike caveat 1.)
- [ ] 4.3 Add a disarm guard so a still-armed `RetryTracker` chain does not convert the manual retry's `agent_start` into a synthetic `auto_retry_start`.
- [ ] 4.4 KEEP the `text === "/__dashboard_retry"` branch as a deprecated alias routing to the same handler; do NOT delete it this change. Mark it for removal in a follow-up.

## 5. Tests (folded from test-plan.md — one per automated scenario)
- [ ] 5.1 Client dispatches `retry_session`, never the sentinel. input: settled+idle state · trigger: `handleRetrySession` · observable: one `retry_session` send, no `/__dashboard_retry`. see `packages/client/src/hooks/__tests__/useSessionActions.optimistic-prompt.test.tsx` (test-plan #1).
- [ ] 5.2 Stale-click guard blocks all 4 ineligible states. input: `lastError`-absent / `retryState`-set / `retryCancelled`-true / `isStreaming`-true · trigger: `handleRetrySession` each · observable: zero sends in all four. see useSessionActions test (test-plan #2).
- [ ] 5.3 Server forwards `retry_session` to the owning bridge. input: browser `retry_session` for a live bridged session · trigger: gateway handler · observable: forwarded to bridge, not the unknown-type default. see `packages/server/src/browser-handlers/__tests__/session-action-handler.test.ts` (test-plan #3).
- [ ] 5.4 Bridge sync dispatch failure emits `auto_retry_end`. input: `pi.sendMessage` throws sync · trigger: bridge handles · observable: `auto_retry_end{success:false,attempt:0,finalError}` once, no `agent_start`. see `packages/extension/src/__tests__/command-handler.test.ts` (test-plan #4).
- [ ] 5.5 Bridge async rejection ALSO emits `auto_retry_end`. input: `pi.sendMessage` returns rejected promise · trigger: bridge handles + microtask drain · observable: `auto_retry_end{success:false}` forwarded (the `.catch()` path). see command-handler test (test-plan #5).
- [ ] 5.6 Armed tracker chain yields no counter for a manual retry. input: armed `RetryTracker` chain · trigger: manual retry `agent_start` · observable: no synthetic `auto_retry_start`, no `retry-banner-attempt`. see `packages/extension/src/__tests__/retry-tracker.test.ts` (test-plan #6).
- [ ] 5.7 Legacy `/__dashboard_retry` still triggers retry. input: `send_prompt{text:"/__dashboard_retry"}` · trigger: parse · observable: same retry dispatch, no user-message replay. see command-handler test (test-plan #7).
- [ ] 5.8 Banner clears on the recovered turn's first clean completion. input: settled-error banner · trigger: Retry → re-drive → first non-error `message_end` · observable: error → no-counter → hidden; no `retry-banner-attempt`. see nearest `tests/e2e/` banner/retry spec, docker harness derived port (test-plan #8).
- [ ] 5.9 Negative-ack re-enables the one-shot Retry. input: `SessionBanner` post-press (disabled) · trigger: `retry_session_error` arrives · observable: Retry enabled + toast. see `packages/client/src/components/session/__tests__/SessionBanner.test.tsx` (test-plan #9).
- [ ] 5.10 `retry_session` while streaming degrades to a queued no-op. input: `isStreaming` true (guard bypassed) · trigger: bridge receives `retry_session` · observable: pi queues (steer/followUp), no corruption, no duplicate `agent_start`. see command-handler test with mock `isStreaming` (test-plan #10).
- [ ] 5.11 Happy-path: click Retry re-drives and completes. input: settled overloaded_error banner · trigger: click Retry · observable: new turn streams, banner hides on success, no injected user message. see nearest `tests/e2e/` retry/banner spec (test-plan #11).

## 6. Manual verification (deferred post-merge)
- [ ] 6.1 Old-server version skew: new client + pre-`retry_session` server → Retry drops, button stays disabled; confirm the co-versioned deploy (`/api/restart` + `npm run reload`) closes it. (test-plan: manual-only #12).

## 7. Validate
- [ ] 7.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green for the touched packages (shared, server, client, extension).
- [ ] 7.2 Rebuild matrix: `npm run reload` (extension), `curl -X POST .../api/restart` (server/shared), `npm run build && restart` (client).
- [ ] 7.3 `openspec status --change replace-dashboard-retry-command-with-protocol-message --json` task counts match the plain checkboxes.

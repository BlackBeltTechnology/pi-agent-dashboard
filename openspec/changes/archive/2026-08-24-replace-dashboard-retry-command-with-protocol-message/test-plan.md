# Test Plan — replace-dashboard-retry-command-with-protocol-message

Scenario catalog (ISTQB-derived, falsification stance). Each row: id · class ·
technique · level · disposition · Triple (input · trigger · observable).
Levels: L1 = vitest unit (`packages/*/src/**/__tests__/*.test.ts`); L3 = Playwright
e2e (`tests/e2e/*.spec.ts`, docker harness, derived port). No spec gaps — all
Triples fill from the resolved decisions.

| # | class | technique | level | disposition |
|---|---|---|---|---|
| 1 | edge-case | dispatch assertion | L1 | automated |
| 2 | edge-case | decision table | L1 | automated |
| 3 | error-handling | server routing | L1 | automated |
| 4 | error-handling | fault injection | L1 | automated |
| 5 | error-handling | fault injection (async) | L1 | automated |
| 6 | state-transition | tracker disarm | L1 | automated |
| 7 | edge-case | back-compat alias | L1 | automated |
| 8 | frontend-quirk | state convergence | L3 | automated |
| 9 | frontend-quirk | negative-ack re-enable | L1 | automated |
| 10 | error-handling | streaming degradation | L1 | automated |
| 11 | frontend-quirk | happy-path re-drive | L3 | automated |
| 12 | error-handling | old-server skew | — | manual-only |

## Scenarios

### 1 — Client dispatches retry_session (not the sentinel) · L1 · automated
- **input**: `SessionState` with `lastError` set, `retryState`/`retryCancelled`
  undefined, `isStreaming` false.
- **trigger**: `handleRetrySession(sessionId)` invoked.
- **observable**: `send` called once with `{ type: "retry_session", sessionId }`;
  never with `send_prompt` text `/__dashboard_retry`.
- exemplar: `packages/client/src/hooks/__tests__/useSessionActions.optimistic-prompt.test.tsx`

### 2 — Stale-click guard blocks every ineligible state · L1 · automated
- **input**: four states — (a) `lastError` absent; (b) `retryState` set;
  (c) `retryCancelled` true; (d) `isStreaming` true.
- **trigger**: `handleRetrySession` invoked in each.
- **observable**: zero `retry_session` sends in all four; one send only in the
  eligible baseline. (Decision table over the 4 guard flags.)
- exemplar: same file as #1.

### 3 — Server forwards retry_session to the owning bridge · L1 · automated
- **input**: browser `retry_session { sessionId }` for a live bridged session.
- **trigger**: gateway message handler processes it.
- **observable**: a `retry_session` is forwarded to that session's bridge socket;
  not routed through the unknown-type `handlePiGatewayForward` default.
- exemplar: `packages/server/src/browser-handlers/__tests__/session-action-handler.test.ts`

### 4 — Bridge dispatch failure (sync throw) emits auto_retry_end · L1 · automated
- **input**: bridge `retry_session`; `pi.sendMessage` stubbed to throw synchronously.
- **trigger**: bridge handles the message.
- **observable**: `auto_retry_end { success:false, attempt:0, finalError }`
  forwarded once; no `agent_start`; error logged.
- exemplar: `packages/extension/src/__tests__/command-handler.test.ts` (retry case).

### 5 — Bridge dispatch failure (async rejection) also emits auto_retry_end · L1 · automated
- **input**: `pi.sendMessage` stubbed to return a rejected promise (async).
- **trigger**: bridge handles the message; microtask drains.
- **observable**: `auto_retry_end { success:false }` still forwarded (the
  `.catch()` path, not only the sync `try/catch`). *Falsifies the spike caveat:
  without `.catch()` this test fails with an unhandled rejection.*
- exemplar: same file as #4.

### 6 — Armed tracker chain does not counter a manual retry · L1 · automated
- **input**: `RetryTracker` with an armed chain for the session.
- **trigger**: the manual retry's `agent_start` is observed.
- **observable**: `observeAgentStart` yields no synthetic `auto_retry_start` for
  the manual origin; reducer renders no `retry-banner-attempt`.
- exemplar: `packages/extension/src/__tests__/retry-tracker.test.ts`.

### 7 — Legacy /__dashboard_retry still triggers retry (deprecated alias) · L1 · automated
- **input**: `send_prompt { text: "/__dashboard_retry" }`.
- **trigger**: `parseCommand` / bridge handling.
- **observable**: resolves to the same retry dispatch (`pi.sendMessage`
  triggerTurn:true); NOT appended/replayed as a user message.
- exemplar: `packages/extension/src/__tests__/command-handler.test.ts`.

### 8 — Banner clears on the recovered turn's first clean completion · L3 · automated
- **input**: a session showing the settled-error banner (`lastError` set).
- **trigger**: Retry → bridge re-drives → first non-error assistant `message_end`.
- **observable**: banner transitions error → (no counter) → hidden; DOM has no
  `retry-banner-attempt` at any point. (Convergence, not visibility-timing.)
- exemplar: `tests/e2e/` nearest banner/retry spec (docker harness derived port).

### 9 — Negative-ack re-enables the one-shot Retry · L1 · automated
- **input**: `SessionBanner` after Retry pressed (`retryRequested` true → disabled).
- **trigger**: a `retry_session_error { sessionId, error }` arrives.
- **observable**: Retry becomes enabled again; a toast is surfaced.
- exemplar: `packages/client/src/components/session/__tests__/SessionBanner.test.tsx`.

### 10 — retry_session while streaming degrades to a queued no-op · L1 · automated
- **input**: session `isStreaming` true (guard bypassed via a crafted/stale send).
- **trigger**: bridge receives `retry_session`.
- **observable**: pi's `sendCustomMessage` queues (steer/followUp) rather than
  starting a turn; no state corruption, no duplicate `agent_start`. (Validates
  the D3=trust-client safety.)
- exemplar: `packages/extension/src/__tests__/command-handler.test.ts` (mock pi
  `isStreaming`).

### 11 — Happy-path: click Retry re-drives and completes · L3 · automated
- **input**: settled overloaded_error banner with Retry visible.
- **trigger**: user clicks Retry.
- **observable**: a new turn streams; on success the banner hides; transcript
  shows no injected user message for the retry.
- exemplar: `tests/e2e/` nearest retry/banner spec.

### 12 — Old-server version skew drops a new-client retry · — · manual-only
- **input**: new browser client + an older server that predates `retry_session`.
- **trigger**: click Retry.
- **observable**: message hits the old server's unknown-type default and is not
  forwarded; button stays disabled. Un-automatable without standing up a
  mismatched-version pair; closed operationally by the co-versioned
  `/api/restart` + `npm run reload` deploy. Deferred to post-merge manual note.

## New infra needed

None. All automated rows extend existing vitest / Playwright suites.

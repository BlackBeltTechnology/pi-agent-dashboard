# Replace the /__dashboard_retry command with a first-class protocol message

## Why

The dashboard's settled-error **Retry** button re-drives a failed turn by
smuggling a magic string through the user-prompt channel: the client sends
`{ type: "send_prompt", sessionId, text: "/__dashboard_retry" }`, and the bridge
recovers the intent only via an exact string match in `command-handler.ts`
(`text === "/__dashboard_retry"` → `{ type: "retry" }`). This is fragile and
dishonest at the wire level:

- **Channel abuse.** A control signal (re-drive this turn) rides the same field
  as a real user prompt. The transport cannot distinguish intent from content.
- **Stringly-typed coupling.** Retry depends on the slash-command parser. Any
  refactor of `parseCommand` / `parseSendPrompt`, or a user literally typing
  `/__dashboard_retry`, reaches the same branch.
- **No typed contract.** `send_prompt` carries no signal that this is a
  non-user, no-replay re-drive; reviewers must trace the string to understand it.

The **pi call the bridge ultimately makes is already correct** and is what
pi-core recommends: `pi.sendMessage({ customType: "pi-dashboard:retry",
content: …, display: false }, { triggerTurn: true })` — the sole public
primitive for "append a non-user entry and start a new turn without replaying
the user's message" (`AgentSession.sendCustomMessage`, verified against the
installed `@earendil-works/pi-coding-agent`). Only the **client→bridge
transport** is wrong. This change fixes the transport, not the pi call.

> **Revised after cross-model doubt-review (luna + terra, 2 clean probes).**
> Both reviewers independently caught a false lifecycle claim, a missing
> server hop, and an unsafe deletion. Corrections folded below; superseded
> claims struck.

- Add a dedicated `retry_session` message `{ type: "retry_session";
  sessionId: string }` across **all three hops** it must traverse:
  1. `packages/shared/src/browser-protocol.ts` — browser→server union.
  2. `packages/shared/src/protocol.ts` — `ServerToExtensionMessage`
     (server→bridge) union.
  3. **Server routing** — a `retry_session` case in the browser gateway
     switch (`packages/server/src/pairing/browser-gateway.ts`) that forwards
     to the owning bridge. The default forwarder drops unknown types
     (`directory-handler.ts`), so adding the unions alone is NOT enough — the
     server would silently swallow the message.
- Update the client's `handleRetrySession` (`useSessionActions.ts`) to send
  `{ type: "retry_session", sessionId }`. The existing stale-click guard
  (re-read `lastError` / `retryState` / `retryCancelled` / `isStreaming` from
  `sessionStatesRef`) is preserved.
- Handle `retry_session` in the bridge directly, calling the same
  `pi.sendMessage({ customType: "pi-dashboard:retry", display: false },
  { triggerTurn: true })` it calls today.
- **Do NOT delete the `/__dashboard_retry` branch this release.** An older
  browser client (version skew) still sends `send_prompt("/__dashboard_retry")`;
  deleting the bridge parse branch would route it as an ordinary slash/user
  prompt and replay it into history — violating the no-replay contract. Keep
  the branch as a **deprecated alias** that maps to the same `retry_session`
  handler, marked for removal one release after clients are known upgraded.
- On button press the bridge emits **no synthetic retry-start**, and the
  bridge SHALL guard against a still-armed `RetryTracker` chain converting the
  manual retry's `agent_start` into a synthetic `auto_retry_start`
  (`bridge.ts` routes every `agent_start` through
  `RetryTracker.observeAgentStart`). ~~the resulting native `agent_start`
  clears `retryState`/`lastError`~~ — **FALSE** (reducer preserves both across
  `agent_start`; the *first non-error assistant completion* clears them). ~~the
  optimistic `prompt_received { fresh:true }` ack drives sending state~~ —
  **FALSE** (`prompt_received` is a no-op without a `pendingPrompt`, and a
  retry creates none). The banner therefore clears on the recovered turn's
  first clean assistant completion, exactly as the auto-retry path already
  does — no new UI signal is introduced.

## Resolved decisions (doubt-review + design spike)

1. **Dispatch-failure channel — KEEP `auto_retry_end{attempt:0}` (decision: a).**
   The failure folds into `lastError` and clears `retryState`, so it surfaces as
   a plain error and NEVER renders the attempt counter — the auto-retry counter
   surface is untouched. **Spike addendum:** `sendCustomMessage` is async and the
   bridge's current synchronous `try/catch` only traps a sync throw. Wrap the
   `pi.sendMessage(...)` call in `.catch()` as well so an async rejection ALSO
   emits `auto_retry_end{success:false, finalError}` — otherwise an async
   dispatch failure escapes as an unhandled rejection and strands the surface.
2. **Delivery ack — structured negative-ack, per repo convention (decision:
   follow `plugin_action_error`).** The codebase rule is "unknown → structured
   error to the sender, never a silent drop" (`browser-gateway.ts:996`). Add a
   `retry_session_error` (mirroring `plugin_action_error` / `spawn_error`) that
   the server or bridge emits when it cannot deliver (unknown/disconnected
   session, or bridge lacks the handler); the client re-enables the one-shot
   Retry + toasts on it. In the DELIVERED case the retry turn's own
   `agent_start` / `lastError` change already self-heals the button, so the
   negative-ack is only the not-delivered path. The pure old-server skew window
   (an old server that doesn't know the type → `default` → `handlePiGatewayForward`)
   is identical for every new message type and is closed by the co-versioned
   deploy flow (`/api/restart` + `npm run reload`) — **accepted + documented**,
   no client timeout added.
3. **Eligibility — trust the client ref check (decision: b).** Consistent with
   `send_prompt`, which is also only client-guarded today. **Spike validates
   this is safe:** if `retry_session` lands while the session is streaming,
   `sendCustomMessage` branch 1081 QUEUES it as steer/followUp — it does not
   collide or corrupt state. A mis-timed retry degrades to a queued no-op, so no
   server/bridge idle-guard is required.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-status-banner`: the settled-error Retry action is dispatched via a
  typed `retry_session` message; no behavioural change to what the banner shows.

## Discipline Skills

- `review-code`: review the extension/client/shared transport diff after the
  focused protocol tests pass.
- `systematic-debugging`: only if a regression surfaces — the failure mode is a
  transport-routing change, not a lifecycle change; verify with synthetic
  message sequences, not transcript inspection.

(`security-hardening`, `performance-optimization`,
`observability-instrumentation` do not apply: no new external input surface, no
latency-budgeted path, no new runtime state — the change swaps one already-
authenticated WS message shape for another.)

## Impact

- Protocol unions: `packages/shared/src/browser-protocol.ts`,
  `packages/shared/src/protocol.ts` (+ the shared protocol tests).
- Server routing: `packages/server/src/pairing/browser-gateway.ts` (new
  `retry_session` switch case + forward-to-bridge).
- Client dispatch: `packages/client/src/hooks/useSessionActions.ts`.
- Bridge routing: `packages/extension/src/bridge.ts` /
  `packages/extension/src/command-handler.ts` (add `retry_session` handler;
  KEEP `/__dashboard_retry` as a deprecated alias, do NOT delete; add the
  armed-chain disarm guard around the manual `agent_start`).
- Negative-ack: `retry_session_error` type in `browser-protocol.ts`
  (server→browser), emitted by the gateway/bridge on undeliverable retry;
  client handler re-enables the one-shot Retry + toast.
- Test updates (existing tests encode the deprecated wire contract and must be
  re-pointed, not just added to):
  `packages/client/src/hooks/__tests__/useSessionActions.optimistic-prompt.test.tsx`,
  `packages/server/src/browser-handlers/__tests__/session-action-handler.test.ts`,
  plus the extension command-handler / protocol test files.
- No new dependency, no persistence change, no live-dashboard test, no provider
  regex, no transcript parsing.

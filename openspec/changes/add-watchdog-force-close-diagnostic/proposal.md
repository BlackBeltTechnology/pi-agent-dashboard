## Why

A bridge reconnect storm cannot be attributed from `server.log`. Over one 10.5h period session `01a09cef` (judo-ng) re-registered **350 times** with **328 closes**, while the gateway recorded **0** `connection dead (ping timeout)` lines and only **24** `heartbeat timeout` lines — so the server never reaped it. **321 of the 328 closes are followed by a re-register on the very next log line**, which is the signature of a deliberate client-side teardown, not a network drop. The second-heaviest session churned 262 times; every other session on the same server stayed under 33. The cost is not cosmetic: events emitted inside a reconnect window are lost server-side, and that is how a live `Agent` tool call ran 45 minutes with `session.currentTool === null` and no tool card in the chat view — the dashboard showed a bare `Thinking…` while the subagent was demonstrably writing files.

The bridge's liveness watchdog (`connection.ts`) is the only code that force-closes a healthy socket, so it is the prime suspect — but today it fires **silently**. `[gateway] connection closed: <id>` is emitted identically for a watchdog hang-up, a TCP drop, and a server reap, so the three are indistinguishable after the fact.

The obvious-looking explanation is wrong, which is why guessing is expensive here. `DEFAULT_WATCHDOG_TIMEOUT` (60 000 ms) equals the gateway's `WS_PING_INTERVAL` (60 000 ms), which reads like a zero-margin race — but the bridge also sends `session_heartbeat` every `HEARTBEAT_INTERVAL` (15 000 ms), the gateway acks it inline (`pi-gateway.ts:827`), and `lastMessageAt` is stamped at the top of `onmessage` before parsing (`connection.ts:857`). The real margin is **4 missed beats**, not 1.

Two hypotheses survive that correction:

1. **Late timer** — the watchdog callback runs ahead of already-queued socket reads under a blocked event loop, reading a stale `lastMessageAt`.
2. **Genuine ≥60 s starvation** — which the bridge's own metrics do not corroborate (`eventLoopMaxMs` peaked at 5 335 ms, `droppedBufferedFrames: 0`, `refusedInboundFrames: 0`).

A third hypothesis — "the bridge stopped sending heartbeats via the `!isActive()` early return" — was **falsified by reading the code, not by instrumenting it**: `initBridge` sweeps `prev.timers` with `clearInterval` (`bridge.ts:226-231`) *before* bumping `generation` (`bridge.ts:234-235`), and the heartbeat timer is registered in that array, so a heartbeat timer is always cleared before its incarnation can go stale. The guard is vestigial and its arm is unreachable. This is recorded because an earlier draft of this change shipped a `heartbeatsSkipped` counter to measure it; that counter could only ever have reported `0`, and a guaranteed-zero reading would have actively misdirected the investigation toward "server stopped answering".

Crucially, `silentForMs` alone does **not** discriminate them: a blocked loop and a silent peer produce the same number. The watchdog therefore measures the lateness of **its own check tick** against its 15 s schedule — the one signal a starved process can produce about its own starvation, since every other reading here is downstream of the same blocked loop.

## What Changes

- **`ConnectionManager` reports its own force-closes.** New optional `onWatchdogFire(info: WatchdogFireInfo)` callback, invoked immediately *before* `handleDisconnect()` (which nulls `this.ws`, so `readyState` is observable only at that instant). `WatchdogFireInfo` carries `silentForMs`, `watchdogTimeout`, `readyState`, `inboundQueueDepth`, `refusedInbound`, `maxTickDriftMs`.
  - **`maxTickDriftMs` is the discriminator**, measured directly rather than inferred: near-zero drift with silence at the threshold attributes the silence to the peer (hypothesis 2); large drift attributes it to local starvation (hypothesis 1), and implies acks may have been sitting unread.
  - **`readyState: 1` (OPEN) at fire time is the core fact**: it proves the bridge hung up on a socket the transport still considered healthy, which is what separates this from a real drop.
  - `inboundQueueDepth` is reported but is **not** a probe for a blocked loop: that queue holds *parsed* frames awaiting serialized handler dispatch, and a blocked loop never parses, so depth stays `0` while `silentForMs` overshoots. Depth `> 0` indicates slow handler dispatch — a distinct cause worth seeing, not evidence for hypothesis 1.
- **Both connection sites report.** The `/dashboard-connect` move path builds a second `ConnectionManager` and rebinds the module's `connection` to it (`bridge.ts:1894`); it receives the same callback via a shared `formatWatchdogFire` helper. Without this, every post-move force-close — on exactly the connection an operator is watching during a move — would stay silent.
- **Durable reporting path.** New `BridgeDiagnosticEvent` member `"watchdog_force_close"`, recorded through the existing `transportDiagnostics`. `console.log` alone is insufficient: pi's stdout goes to `/dev/null` under the default `keeperLog.capturePiOutput: false`, so `server.log` (via `event-wiring.ts`'s existing `bridge_diagnostic` arm, which logs any event value) is the only durable record. Because the callback runs *before* teardown, the normal path is a synchronous flush through the still-OPEN socket; the buffer is the fallback when the socket is already down.

Out of scope, deliberately: changing `DEFAULT_WATCHDOG_TIMEOUT`, `WS_PING_INTERVAL`, `HEARTBEAT_INTERVAL`, or any reconnect/backoff behaviour. No timing constant moves. Also out of scope: the server→browser transcript shedding (84 568 dropped frames observed). Per `ws-frame-delivery-policy`, `transcript` frames are shed **by design** and documented as "recoverable via history backfill or replay"; the observed card loss traced to the bridge hop, not that shed. When load fell from 35.70 to 7.61 the drop counter went flat (+51 in 15 min) with no policy change, consistent with shedding being a symptom of the churn. Revisit only with evidence gathered *after* the churn is understood.

Non-goal: this change does not fix the churn. It makes the churn self-explaining so the fix can be chosen on evidence rather than on a coincidence between two constants.

## Capabilities

### Modified Capabilities
- `bridge-heartbeat-watchdog`: the watchdog gains an attribution contract. A force-close SHALL report the state that caused it before tearing the socket down; the liveness decision itself (15 s check interval, 60 s silence threshold, force-close-and-reconnect action) is unchanged, and the report SHALL NOT alter it.

## Impact

- `packages/extension/src/connection.ts` — `WatchdogFireInfo` export, `onWatchdogFire` option, report call in `startWatchdog`.
- `packages/extension/src/bridge.ts` — `formatWatchdogFire` helper, `onWatchdogFire` wired at both `ConnectionManager` construction sites.
- `packages/shared/src/protocol.ts` — `BridgeDiagnosticEvent` union gains `"watchdog_force_close"`.
- `packages/extension/src/__tests__/watchdog.test.ts` — reports-on-fire, silent-when-healthy, throwing-reporter, readyState-before-teardown.
- No server change: `event-wiring.ts` already logs any `bridge_diagnostic` regardless of event value.
- No protocol break: `BridgeDiagnosticEvent` is a widening; `detail` stays a preformatted human string, never matched on.
- No behaviour change on the connection path — purely additive observation.

## Discipline Skills

- `observability-instrumentation` — this change *is* an instrumentation change; the discriminating power of the reported fields is the deliverable.
- `systematic-debugging` — the two surviving hypotheses and the falsification of the third are the artifact this change exists to serve; a fix must not be proposed before the instrument reports.
- `review-code` — before commit.

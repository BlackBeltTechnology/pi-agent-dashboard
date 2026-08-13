# fix-duplicate-bridge-registration

## Why

Two live bridges can register the **same** `sessionId`. The gateway's connection
map is last-writer-wins, so the newcomer silently displaces the incumbent and
every server→extension message — prompts included — is delivered to the loser of
that race. The session looks perfectly healthy from every observable the
dashboard offers, and prompts vanish.

Observed on the live instance, `~/.pi/dashboard/server.log`:

```
30241:[gateway] session registered: 019fec91-4858-72f0-80b3-a309d593f8e0 cwd=/Users/robson/Project/pi-agent-dashboard
30242:[event-wiring] cwd-FIFO fallback for session 019fec91-… — token=          pid=37660
30243:[gateway] session registered: 019fec91-4858-72f0-80b3-a309d593f8e0 cwd=/Users/robson/Project/pi-agent-dashboard
30244:[event-wiring] cwd-FIFO fallback for session 019fec91-… — token=e160f5f8-… pid=17579
```

| keeper transport | keeper pid | pi pid | state |
|---|---|---|---|
| `cd2f75f1` | 37613 | 37660 | **real** session — actively writing its transcript |
| `1e133c22` | 17578 | 17579 | **duplicate** resumed 14 min later — idle from boot |

The duplicate registered second, so it owned the slot. Every
`POST /api/session/019fec91-…/prompt` returned `{"success":true}` and was
written into the idle duplicate; the real session's transcript never grew
(239 lines, unchanged across three prompts and two server restarts).

### Why every diagnostic said "healthy"

- `/api/health` reported `activeBridgeCount: 6` and fresh `processMetrics`
  (RSS/CPU) for the session — telemetry is **outbound**, and the displaced
  socket keeps sending it.
- `/api/sessions` showed `status: "active"` with a live `lastEntryCount`.
- `lsof`/`ps` showed keeper + pi + an ESTABLISHED socket.
- `POST …/prompt` returned `{"success":true}`.

Only transcript mtime disproved it. The single distinguishing signal —
two `session registered` lines for one id — is emitted, but is
indistinguishable from a legitimate re-register after `/reload` or reconnect.

### Root cause

`packages/server/src/pi/pi-gateway.ts:262` — the *first-message identity block*,
which runs before the `session_register` dispatch at `:279` and is the real
claim point (`session_register` is itself the first message carrying a
`sessionId`):

```js
if (!currentSessionId && "sessionId" in msg && msg.sessionId) {
  currentSessionId = sid;
  connections.set(sid, ws);          // ← unconditional overwrite, the real claim
}
…
connections.set(msg.sessionId, ws);  // :300 — re-assert, already ours
```

`connections` is a `Map<sessionId, WebSocket>`. The incumbent socket for that id
is neither inspected, closed, nor logged; it is simply dropped from the map. Three
consequences follow mechanically:

1. **`sendToSession` lies.** It returns `true` because the *newest* socket is
   `OPEN` (`pi-gateway.ts:437`) — never that the intended pi received anything.
   That boolean is what `/api/session/:id/prompt` reports as `success:true`.
2. **A displaced socket outlives `stop()`.** Teardown terminates only
   `connections.values()`; a socket no longer in the map is never terminated, so
   it survives a `POST /api/restart` and re-registers on the far side — which is
   why two restarts did not clear the fault.
3. **The close handler deletes by id, not by socket.** The automation branch runs
   `connections.delete(currentSessionId)` (`pi-gateway.ts:398`) without checking
   the map still holds *that* `ws`, so a displaced socket closing can evict the
   live winner's entry.

The duplicate arose from a resume: `1e133c22` was spawned with
`--session <the same .jsonl>` already owned by the running `cd2f75f1`. Nothing
in the resume path checks whether a live bridge already holds that session id.

### Related, and deliberately not merged

`fix-spawn-correlation-ttl-coupling` covers the correlation **token TTL** and
watchdog identity. It is adjacent — note that above, the token-carrying
duplicate is what won the slot — but distinct: that change makes a *late*
register correlate correctly, this one decides what happens when *two* registers
claim one id. Keeping them separate keeps each falsifiable.

## What Changes

- **Registration is contention-aware.** A `session_register` for an id already
  held by a *different, live* socket SHALL be resolved by an explicit rule
  rather than silent overwrite, and the displaced socket SHALL be closed rather
  than leaked. The rule SHALL be enforced at the claim point (`:262`), and no
  register side effect — watchdog clear, placeholder cleanup, `onEvent` — SHALL
  run before the contention decision.
- **Contention is resolved by demonstrated liveness.** The incumbent keeps the
  id only if it answers a bounded probe; an incumbent whose peer is gone SHALL
  NOT be able to hold a session id hostage. Neither existing reaper clears a
  half-open socket (the ping reaper keeps on `socketAlive`, the heartbeat
  reschedules while `readyState === OPEN`), so the register path cannot delegate
  this.
- **Refusal is terminal.** The refused bridge SHALL be told it lost, so it stops
  reconnecting for that id instead of looping forever while its pi keeps writing
  into the incumbent's `.jsonl`.
- **The event is loud.** A displacement SHALL be logged distinctly from an
  ordinary re-register (reconnect / `/reload`, where the incumbent socket is the
  same or already closed), naming both pids so the duplicate is identifiable
  without `ps` archaeology.
- **Delivery stops being reported from socket state alone.** `sendToSession`
  SHALL NOT report success purely because some socket for that id is `OPEN`;
  `POST /api/session/:id/prompt` SHALL NOT return `success:true` for a session
  whose bridge is in a contended/ambiguous state. **BREAKING** for any client
  treating `success:true` as delivery — today it never meant that.
- **Teardown covers displaced sockets.** `stop()` SHALL terminate every socket
  the gateway accepted, not only those currently in the connection map.
- **Close is socket-identity–scoped.** A closing socket SHALL only remove a
  connection-map entry that still points at itself.
- **Resume refuses to duplicate.** Resuming a session file already served by a
  live bridge SHALL be rejected, never spawn a second pi against the same
  session file — at **both** guard sites (REST `/api/session/:id/resume` and the
  WebSocket drag-to-resume path), using the same liveness definition as the
  contention rule.
- **Health exposes the condition.** `/api/health` SHALL surface duplicate/
  displaced bridges so this state is visible without reading `server.log`.
- **NOT in scope, and why:**
  - *Spawn-correlation token TTL and watchdog pid/cwd identity* — owned by
    `fix-spawn-correlation-ttl-coupling`; this change must not move those
    constants.
  - *An end-to-end prompt ACK from pi* (true delivery receipt). The honest fix
    for "success ≠ delivered", but it is a protocol addition; here we only stop
    reporting success in the state we can already detect locally.
  - *Reaping pre-existing orphan keepers on boot* — separate lifecycle concern.
  - *The `cwd-FIFO fallback` correlation tier itself* — it behaved as written.

## Capabilities

### New Capabilities

- `bridge-connection-contention`: what the gateway does when two live sockets
  claim one `sessionId` — resolution rule, displaced-socket closure,
  socket-identity–scoped cleanup, teardown coverage, and the health surface.

### Modified Capabilities

- `session-lifecycle-logging`: a displacement SHALL log distinctly from an
  ordinary re-register, carrying both the incumbent and the newcomer pid.
- `session-resume`: resuming a session file already served by a live bridge
  SHALL NOT produce a second pi for that session id.
- `session-identity`: one live bridge per session id becomes an invariant the
  gateway enforces, not an assumption.

## Impact

- `packages/server/src/pi/pi-gateway.ts` — `session_register` contention rule,
  `sendToSession` success semantics, `ws.on("close")` identity scoping, `stop()`
  coverage.
- `packages/server/src/session/session-api.ts` — `/api/session/:id/prompt`
  response when the bridge is contended.
- `packages/server/src/spawn-process/process-manager.ts`,
  `packages/server/src/rpc-keeper/` — resume-time guard against a second pi for
  a live session file.
- `packages/server/src/health/` — duplicate/displaced bridge surface.
- `packages/shared/src/protocol.ts` — a **new server→extension rejection
  message**. The register direction needs nothing new (`session_register`
  already carries `pid` and `sessionFile`), but the refusal direction has no
  carrier today, and without one a refused bridge reconnects forever.
- `packages/extension/src/connection.ts` — on receiving the rejection, stop
  retrying for that session id and surface the reason.
- `packages/server/src/browser-handlers/session-action-handler.ts` — the second
  copy of the resume guard.
- `packages/server/src/event-wiring.ts` — the register-time `sessionFile` steal
  (`:1172`) must not run for a refused register.

## Discipline Skills

- `systematic-debugging` — the fault was reached only by disproving four healthy
  observables against transcript growth; the fix must be judged by a
  reproduction (two bridges, one id) going red first, not by "prompts feel
  reliable again".
- `observability-instrumentation` — a silent overwrite is the whole defect;
  the distinct log line and the health surface are part of the fix, not
  follow-up polish.
- `doubt-driven-review` — the contention rule (evict incumbent vs. refuse
  newcomer) changes which pi survives a race, and picking wrong destroys the
  session doing real work; it gets an adversarial pass before it stands.
- `security-hardening` — `session_register` is an untrusted socket input, and
  the rule decides whether an arriving socket can displace an established one.

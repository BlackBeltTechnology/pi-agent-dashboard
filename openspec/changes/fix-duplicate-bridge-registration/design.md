## Context

`piGateway` keeps `connections: Map<sessionId, WebSocket>` as the single routing
table for every server→extension message. `session_register`
(`packages/server/src/pi/pi-gateway.ts:301`) writes into it unconditionally:

```js
currentSessionId = msg.sessionId;
connections.set(msg.sessionId, ws);
```

Two live bridges claiming one id therefore resolve by arrival order, silently.
The displaced socket stays open, keeps streaming telemetry (so the session looks
healthy everywhere) and receives nothing. `sendToSession` reports `true` on the
*surviving* socket's `readyState`, which is what surfaces as
`POST /api/session/:id/prompt → {"success":true}` for a prompt nobody will ever
read. Field evidence and pid table: `proposal.md`.

Three existing mechanisms constrain the design:

- **A ping reaper** (`start()`, `PING_MISS_THRESHOLD = 3`) iterates
  `wss.clients`, so it *does* see displaced sockets. Its cleanup scans
  `connections` for the client, finds nothing for a displaced socket, and
  terminates it anyway — correct by luck, not by intent. Note its "TCP alive but
  no pong ⇒ bridge is busy, keep" branch: a half-open incumbent is deliberately
  NOT reaped quickly.
- **A heartbeat timeout** (`resetHeartbeat`, 180 s) unregisters a session whose
  bridge stopped talking, with a reconnect grace path.
- **A resume liveness guard already exists** — `/api/session/:id/resume` returns
  409 `"session is already active"` unless `isSessionProcessGone(id, …)`
  (change: `resume-zombie-active-session`).

That last one matters: the guard is keyed on the **session id**, and it did not
prevent tonight's duplicate. The second keeper resumed the same *session file*
under a different id. The same shape is visible elsewhere in the live data —
card `019feda6` is served by a bridge whose `sessionFile` is
`…_019feda3-8d51-….jsonl`. Identity of a *conversation* is the session file;
identity of a *connection* is the session id. The guard protects the latter and
the duplicate was created through the former.

## Goals / Non-Goals

**Goals:**

- One live bridge per `sessionId`, enforced at the gateway rather than assumed.
- A losing socket is closed, not leaked — including across `stop()`.
- Contention is loud in `server.log` and visible in `/api/health`.
- `POST /api/session/:id/prompt` stops returning `success:true` for a session
  whose bridge is contended.
- Resume cannot mint a second pi against a session file a live bridge already
  serves.

**Non-Goals:**

- A true end-to-end delivery ACK from pi. `success:true` will still mean
  "handed to the one socket we believe owns this session", just no longer
  "handed to *a* socket that happens to be open". A real receipt is a protocol
  addition, deliberately deferred.
- Spawn-correlation token TTL and watchdog pid/cwd identity — owned by
  `fix-spawn-correlation-ttl-coupling`. This change must not move those
  constants.
- Reaping orphan keepers that predate the fix.
- Changing the heartbeat (180 s) or ping (3-miss) windows.

## Decisions

### D1 — Incumbent wins; the newcomer is refused and closed

A `session_register` naming an id whose map entry holds a **different** socket
that is still `OPEN` is refused: the server logs the contention, sends the
newcomer a rejection, and closes it. The incumbent's entry is untouched.

*Rationale:* the incumbent is by definition the connection that has been serving
the session; the newcomer has, in every observed instance, been a redundant
resume that had done no work. Tonight the newcomer won and 25 minutes of prompts
went into a process that had been idle since boot.

*Why the ordinary cases do not trip it:* on `/reload` and on reconnect the old
socket is already `CLOSED` (or is the *same* socket re-registering, e.g. an
in-process new/fork/resume changing `sessionId`) — neither is a
different-and-OPEN incumbent, so there is no contention to resolve. The
existing "session ID changed" placeholder cleanup keeps working unchanged.

*Alternatives considered:*
- **Newcomer wins, but loudly + close the loser.** Preserves today's ordering
  and is a smaller diff, but keeps the failure mode whenever the newcomer is the
  redundant one — which is the only case seen in the field.
- **Liveness-scored tie-break** (incumbent wins only while passing ping).
  Strictly more correct against a half-open incumbent, but makes the winner
  depend on reaper timing — the resulting behaviour is hard to state in a spec
  and harder to test deterministically. Rejected in favour of D2, which reaches
  the same end state through machinery that already exists.

### D2 — A zombie incumbent is handled by reaping, not by tie-breaking

If the incumbent is a half-open socket, D1 would refuse the real bridge's
reconnect. Rather than scoring liveness inside the register path, the register
path stays a pure `readyState` check and the *existing* reaper handles the
zombie: the ping loop terminates a TCP-dead client, which fires its `close`
handler, which clears the entry (per D3) — after which the newcomer's next
reconnect attempt registers unopposed. The bridge already reconnects with
exponential backoff (`ConnectionManager`), so this needs no new retry logic.

*Trade-off:* recovery from a half-open incumbent is bounded by the ping/heartbeat
windows instead of being instant. See Risks.

*Rejected:* trusting the `isNew` / `registerReason` fields on the register
message to identify the "real" bridge. They are self-reported by the party we
are trying to adjudicate, and `session_register` is untrusted socket input.

### D3 — Close and teardown become socket-identity–scoped

`ws.on("close")` currently deletes by id (`connections.delete(currentSessionId)`
in the automation branch, `pi-gateway.ts:398`), so a displaced socket closing can
evict a live winner. Every map removal keyed on a closing socket SHALL first
confirm `connections.get(id) === ws`. `stop()` SHALL terminate `wss.clients`
rather than `connections.values()`, so no accepted socket survives teardown.

This is the half that made the incident survive two restarts: a socket outside
the map was never terminated, so it re-registered against the fresh server.

### D4 — `sendToSession` reports routing, and the prompt API distinguishes it

`sendToSession` keeps returning a boolean but SHALL only return `true` for the
socket the map holds for that id (it does today — the bug is that the map holds
the wrong one). With D1 in place the map cannot hold a usurper, so the honest
remaining failure is "no live bridge", which already returns `false`. The prompt
endpoint additionally distinguishes a *contended/ambiguous* bridge from a
healthy one in its error payload, so the operator sees the real state instead of
`success:true`.

### D5 — The resume guard keys on the session file, not just the session id

Extend the existing 409 to refuse a `continue` resume whose target
`sessionFile` is already served by a live bridge under **any** session id.
Per the user decision this is a hard refusal with a clear error — no silent
reuse, no force flag in this change.

*Rationale:* this is the actual mint point of the duplicate. Keying only on
`session.id` leaves the exact hole tonight's duplicate went through.

## Risks / Trade-offs

- **A half-open incumbent blocks the real bridge's reconnect until the reaper
  fires.** → D2 bounds it by the existing ping/heartbeat windows and the bridge
  retries with backoff; the contention log line names both pids so a stuck case
  is diagnosable in one grep instead of `ps` archaeology.
- **Refusing a newcomer could reject a legitimate register we failed to
  anticipate** (some path where the old socket is genuinely OPEN and stale). →
  The rejection is logged with both pids and surfaced in `/api/health`; the
  contention counter makes a wrong rule visible in a day of real use rather than
  hiding as a silent overwrite.
- **`stop()` terminating `wss.clients` widens teardown's blast radius** to
  sockets that never registered. → That is the intent (leaked sockets are the
  defect); the sockets are being terminated during shutdown anyway.
- **Callers reading `success:true` as delivery keep over-trusting it.** → Only
  narrowed here, not fixed; a true ACK is called out as a Non-Goal so the gap
  stays visible rather than being quietly declared solved.
- **The change touches the single routing table every session depends on.** →
  Rule stated as one predicate (`different socket AND OPEN`), reproduced by a
  test that connects two sockets on one id before any production change lands.

## Migration Plan

No data migration, no protocol change: `session_register` already carries `pid`
and `sessionFile`, which is everything the rule needs.

1. Land the reproduction first (two sockets, one id) and watch it go red.
2. Land D3 (identity-scoped close + `stop()` coverage) — pure defect fix, no
   behaviour choice, and it independently stops the "survives a restart" half.
3. Land D1/D2 (contention rule + logging), then D4, then D5.
4. Rollback: D1 is a single predicate; reverting it restores last-writer-wins
   without touching D3's cleanup.

Operationally, an existing duplicate is not auto-reaped (Non-Goal) — after
deploy, the losing keeper is killed by pid as done during the incident.

## Open Questions

- Should the refusal reuse an existing server→extension message type or add a
  dedicated one? The rejection must be readable by the bridge before its socket
  closes; `specs` will pin the observable behaviour (refused + closed + logged)
  and leave the carrier to implementation if no existing type fits.
- Should `/api/health` expose a cumulative contention counter, the currently
  contended ids, or both? Leaning both — the counter catches a rule that is
  firing too often, the id list is what an operator needs mid-incident.

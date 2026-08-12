## Context

`piGateway` keeps `connections: Map<sessionId, WebSocket>` as the single routing
table for every server→extension message. Two live bridges claiming one id
resolve by arrival order, silently. The displaced socket stays open, keeps
streaming telemetry (so the session looks healthy everywhere) and receives
nothing. `sendToSession` reports `true` on the *surviving* socket's
`readyState`, which is what surfaces as `POST /api/session/:id/prompt →
{"success":true}` for a prompt nobody will ever read. Field evidence and pid
table: `proposal.md`.

### What the register path actually does today

The claim on the routing table does **not** happen in the `session_register`
branch. It happens one block earlier, on the *first message carrying a
`sessionId`* — and `session_register` is that message:

```js
// pi-gateway.ts:262 — runs BEFORE the session_register dispatch at :279
if (!currentSessionId && "sessionId" in msg && msg.sessionId) {
  currentSessionId = sid;
  connections.set(sid, ws);        // ← the real claim point
  …auto-create placeholder session…
}
…
if (msg.type === "session_register") {
  …watchdog.clearByToken/clearByPid/clearByCwd…   // :285 — side effects first
  …placeholder cleanup…                            // :291
  connections.set(msg.sessionId, ws);              // :300 — re-set, already ours
}
```

A contention predicate placed at `:300` therefore reads `connections.get(S) ===
ws` — *the newcomer itself* — and sees no contention. **Any contention rule must
be enforced at `:262`, not at `:300`.** This invalidated the first draft of D1
and is why D0 below exists.

Three further mechanisms constrain the design, each verified in source:

- **The ping reaper does not reap a half-open socket.** At
  `PING_MISS_THRESHOLD = 3` it inspects the TCP socket, and
  `socketAlive → reset the miss counter and keep` (`:217-224`).
- **The heartbeat timeout does not either.** It short-circuits on
  `ws.readyState === WebSocket.OPEN → reschedule; return` (`:93-97`).
- Consequently a peer that died **without a FIN** holds `readyState === OPEN`
  and `socket.writable` for the OS TCP timeout — minutes to indefinitely.
  Neither reaper clears it. An earlier draft of this design delegated half-open
  recovery to "the existing reapers"; that guarantee does not exist.

- **A resume liveness guard already exists** — `/api/session/:id/resume` returns
  409 `"session is already active"` unless `isSessionProcessGone(id, …)`
  (change: `resume-zombie-active-session`), and the **same** guard exists a
  second time on the WebSocket drag-to-resume path
  (`session-action-handler.ts:363`). Both resolve liveness through
  `piGateway.isSessionConnected` → `readyState === OPEN`, so both inherit the
  half-open blindness above.

That guard is keyed on the **session id**, and it did not prevent the incident.
The second keeper resumed the same *session file* under a different id.
Identity of a *conversation* is the session file; identity of a *connection* is
the session id. The guard protects the latter; the duplicate was minted through
the former.

- **`sessionFile` is mutated at register time.** Every register carrying a
  `sessionFile` nulls that field on every *other* session sharing it
  (`event-wiring.ts:1172-1176`). Any rule keyed on `sessionFile` must run
  before that side effect, or the key it depends on is already gone.

## Goals / Non-Goals

**Goals:**

- One live bridge per `sessionId`, enforced at the gateway rather than assumed.
- Contention resolved by *demonstrated liveness*, not arrival order.
- A losing socket is closed **and told why**, so it stops retrying — and is not
  leaked, including across `stop()`.
- Contention is loud in `server.log` and visible in `/api/health`.
- `POST /api/session/:id/prompt` stops returning `success:true` for a session
  whose bridge is contended.
- Resume cannot mint a second pi against a session file a live bridge serves.

**Non-Goals:**

- A true end-to-end delivery ACK from pi. `success:true` still means "handed to
  the one socket we believe owns this session", just no longer "handed to *a*
  socket that happens to be open". A real receipt is a protocol addition,
  deliberately deferred.
- Spawn-correlation token TTL and watchdog pid/cwd identity — owned by
  `fix-spawn-correlation-ttl-coupling`. This change must not move those
  constants.
- Reaping orphan keepers that predate the fix.
- Changing the heartbeat (180 s) or ping-miss (3) **windows**. D2 adds a
  *separate* probe with its own window; it does not retune these.

## Decisions

### D0 — The contention check moves to the real claim point

The first-message identity block (`:262`) becomes the single place a socket may
claim a routing entry, and it becomes contention-aware. The `session_register`
branch keeps `connections.set` only as a no-op re-assert for the socket that
already owns the id.

The `session_register` branch's own `connections.set` (`:300`) survives as the
claim for the **id-change** path (a socket moving from `S1` to `S2`), which the
spec requires — so it is a second claim point, and it SHALL be contention-checked
too. Today it is unconditional.

Equally load-bearing: **no register side effect may run before the contention
decision.** Today the watchdog clear (`:285`), the placeholder cleanup (`:291`),
`resetHeartbeat`, the connection/created callbacks, and `onEvent` (`:374`) all
fire regardless. A refused newcomer that reaches `onEvent` would strip the
incumbent's `sessionFile` (`event-wiring.ts`), run ghost cleanup, and consume the
spawn-correlation token — corrupting exactly the state D5 keys on; one that
reaches `resetHeartbeat` would reset the *incumbent's* reconnect-grace timer. The
refusal path SHALL short-circuit before all of them.

The same ownership gate applies **after** the register: `session_heartbeat` and
`model_update` are keyed on `msg.sessionId` with no ownership check, so a refused
socket's in-flight messages — and anything arriving during the probe window —
can still reset the incumbent's heartbeat or overwrite its `processMetrics`.
Messages from a socket that does not own the id SHALL be dropped.

The spawn-register watchdog SHALL NOT be cleared by a refused register — it must
stay armed so the refused duplicate's pi is reclaimed rather than left writing
into the incumbent's transcript (D2). Today only the WebSocket spawn handler arms
it; **every** spawn entry point SHALL arm it — REST resume, WebSocket
drag-to-resume, zombie reopen, and headless reload — not just the REST path that
minted the incident.

That has an API consequence the spec cannot hand-wave: the watchdog's arm options
take a **required** `ws`, and its fire path dereferences `ws.readyState` /
`ws.send` to deliver the diagnostic. The REST path has no WebSocket. Arming from
a transport-less caller therefore requires the watchdog to accept an absent
browser transport and still perform the reclaim — the reclaim is the half D2
depends on, and it must not be conditional on a browser listening.

Ordering matters for the id-change path specifically. For a first claim the
decision sits at `:262`, above every side effect. For an id-change the socket
already has a `currentSessionId`, so `:262` is skipped and the only natural
decision point is `:300` — which is *below* the watchdog clear (`:285`) and the
placeholder cleanup (`:291`). `clearByCwd(msg.cwd)` at `:285` would disarm a
pending spawn watchdog in the same cwd before the register is refused, violating
the rule above. **The id-change contention decision SHALL be hoisted above the
watchdog clear.**

### D1 — Contention is resolved by a bounded probe, using the reaper's own liveness rule

On a `session_register` for an id whose entry holds a **different** socket in
`OPEN` state, the gateway probes the incumbent (WebSocket ping) and waits a
bounded window. The outcome uses the **same two-factor rule the ping reaper
already encodes**:

- **Incumbent pongs** → alive and serving. Newcomer refused (D2).
- **No pong, but the incumbent's TCP socket is still writable** → per the
  gateway's own documented behaviour this is a *busy* bridge, not a dead one.
  Incumbent keeps the entry; newcomer refused.
- **No pong and the TCP socket is not writable** → dead. The gateway terminates
  the incumbent, clears its entry, and **accepts the newcomer**.

*Why not "no pong ⇒ dead":* pongs are emitted by the `ws` library but processed
on the same event loop the bridge blocks while running a tool. The gateway says
so itself at `pi-gateway.ts:213-219` — *"the bridge is just too busy to process
pong frames"* — and the reaper's entire keep-branch exists for that case. A
pong-only rule would terminate the live, working incumbent: precisely the
outcome incumbent-wins was chosen to prevent. An earlier draft of this design
asserted the opposite ("a pong is answered by the WebSocket layer… busyness does
not block it"); that was wrong and is corrected here.

*Accepted residual — a true half-open incumbent is still undetectable.* A peer
that died without a FIN leaves the socket `OPEN` **and** writable, so it reads
identical to "busy" under this rule and keeps the id. Neither reaper clears it
(Context), so the id is stranded until the OS TCP timeout. Recovery is the
operational one already exercised during the incident: kill the losing keeper by
verified pid, then let the survivor re-register. TCP keepalive on bridge sockets
would make this case decidable in bounded time and was considered; it was
rejected for this change as a new transport-level mechanism, and is the obvious
follow-up if the stranded case shows up in practice. **This is the known cost of
never sacrificing a busy-but-live session, chosen deliberately.**

*Same-process reconnect is not contention.* If the registering socket reports the
**same pid** the gateway has recorded for the incumbent, it is the same pi
reconnecting (its previous socket's close frame was lost or is still in flight),
not a duplicate. The gateway SHALL replace the entry rather than refuse. Without
this, a lost close frame plus D2's terminal refusal permanently orphans a
legitimate bridge. The pid is self-reported, so it is used **only** in this
fail-safe direction — to *avoid* a permanent refusal, never to justify one.

The exemption needs a recorded incumbent pid, and a pid is recorded only by a
completed `session_register`. An auto-created **placeholder** incumbent (claimed
at `:262` by a first message, `source: "unknown"`, no pid) therefore cannot match
it — so a placeholder SHALL NOT be treated as a protected incumbent at all: a
real register always displaces one. This closes the window rather than leaving
the exemption's guarantee overstated.

*Why this is testable* — the objection that sank the first draft's tie-break was
determinism. The rule is deterministic because both factors are *demanded*, not
observed: the test drives a socket that does not pong with a destroyed TCP
socket and asserts the newcomer is accepted; a socket that pongs, and a socket
that is silent but writable, both assert refusal. None of it depends on reaper
scheduling.

*Why the ordinary cases do not trip it:* on `/reload` and reconnect the old
socket is already `CLOSED` (or is the *same* socket re-registering) — neither is
a different-and-`OPEN` incumbent, so no probe is issued and the fast path is
unchanged.

*Alternatives considered:*
- **Strict incumbent-wins, no probe** — the first draft. Rejected once the
  reaper premise was disproved: it strands the session with no recovery.
- **Strict + operator force flag.** Recovery exists but is manual, and the
  failure presents as "the dashboard is broken" long before anyone reaches for a
  flag.
- **Newcomer wins, loudly.** Smaller diff, but keeps the observed failure mode:
  in the incident the newcomer was the idle duplicate.
- **Trusting `isNew`/`registerReason` on the register message.** Rejected:
  self-reported by the party being adjudicated; `session_register` is untrusted
  socket input.

### D2 — Refusal is terminal: the loser is told, and stops retrying

Closing the refused socket is not enough. The bridge treats any close as
transient and reconnects with exponential backoff, and **no rejection message
type exists** in the protocol today — so a refused duplicate would loop forever
while its pi process stays alive writing into the *same* `.jsonl` as the
incumbent.

A dedicated server→extension **rejection message** is added: the server sends it
before closing, and the bridge SHALL stop retrying *for that session id* on
receipt (and surface the reason rather than dying silently).

**This drops the "no wire-protocol change" claim** made by the first draft of
the proposal, which has been corrected. The register message already carries
`pid` and `sessionFile` — that part still needs nothing new — but the *refusal*
direction does.

*Rejected:* killing the refused newcomer by the pid **it reports on the register
message**. That makes the server execute a kill on the word of an untrusted
socket message.

*Not the same thing, and retained:* the spawn-register watchdog's reclaim, which
kills by **server-minted spawn token** (`findPidsBySpawnToken`) — i.e. only
processes this server spawned and can still identify. Because D0 leaves the
watchdog armed for a refused register, that reclaim is what stops the refused
duplicate's pi from going on writing into the incumbent's `.jsonl`. It is
therefore load-bearing, not incidental — and it must be armed on **every** spawn
entry point (D0), not only the WebSocket one.

### D3 — Close, cleanup, and teardown become socket-identity–scoped

`ws.on("close")` fires `onDisconnect(currentSessionId)` in **both** branches, and
the automation branch additionally runs `connections.delete` +
`sessionManager.unregister` + finalize — all keyed on the id the socket last
claimed, never checking whether that socket still owns it. A displaced or
refused socket closing can therefore raise a spurious disconnect on a live
session, or finalize an automation run that another socket is serving.

Every id-keyed cleanup triggered by a closing socket — the map delete,
`onDisconnect`, `sessionManager.unregister`, the automation finalize, and the
`heartbeatTimers` / `heartbeatMeta` deletes (which would otherwise clear the
*incumbent's* reconnect-grace timer) — SHALL first confirm
`connections.get(id) === ws`. `stop()` SHALL terminate
`wss.clients` rather than `connections.values()` (`wss.close()` does not
terminate clients), so no accepted socket survives teardown.

This is the half that made the incident survive two restarts: a socket outside
the map was never terminated, so it re-registered against the fresh server.

### D4 — `sendToSession` reports routing; the prompt API reports the contention record

With D0/D1 the map cannot hold a usurper, so at prompt time there is exactly one
owner and the send is honest. "Contended" is therefore **not** a live routing
state — it is a *recorded event*. To avoid a permanently-mislabelled session or
an unreachable branch, the record has an explicit lifecycle:

- A refusal stamps a contention record on the affected session id.
- The record is **cleared** by whichever comes first: the refused spawn being
  reclaimed, a bounded TTL expiring, the incumbent disconnecting, or the session
  ending. The incumbent alone is not a sufficient trigger — it is healthy and
  may never disconnect, and D3 makes the *refused* socket's close a no-op for
  that id, so an incumbent-only rule would pin the record for the session's
  whole remaining life: exactly what this lifecycle exists to prevent.
- `POST /api/session/:id/prompt` SHALL NOT return a plain success while a
  contention record is live for that id; it reports the bridge state as the
  reason, distinguishable from the existing "no bridge" failure.
- **The response SHALL state whether the prompt was delivered.** Under D0/D1 the
  map holds exactly one owner, so a contended-but-delivered prompt is the normal
  case; reporting a bare failure would invite a retry and double-send. "Not a
  plain success" means *annotated*, not *failed*.

`sendToSession` keeps returning a boolean and SHALL only return `true` for the
socket the map holds for that id.

### D5 — The resume guard keys on the session file, at both call sites, with D1's liveness definition

Extend the existing 409 to refuse a `continue` resume whose target `sessionFile`
is already served by a live bridge under **any** session id. Per the user
decision this is a hard refusal with a clear error — no silent reuse, no force
flag.

Three corrections the review forced:

1. **Both guard sites.** The identical guard exists in `session-api.ts:245`
   (REST) and `session-action-handler.ts:363` (WebSocket drag-to-resume).
   Patching one leaves the hole open on the other.
2. **Liveness means D1's definition,** not `readyState === OPEN`. Reusing the
   raw readyState check would make a half-open incumbent refuse the resume —
   the lockout D1 exists to prevent.
3. **The lookup runs before the register-time `sessionFile` mutation**
   (`event-wiring.ts:1172`), and tolerates sessions with no `sessionFile`
   (placeholders store `undefined`) — those simply cannot match.

*Rationale:* this is the actual mint point of the duplicate. Keying only on
`session.id` leaves the exact hole tonight's duplicate went through.

### D6 — Observability: what is logged, what health exposes, and when it clears

- The refusal log line names the session id, the incumbent pid, and the newcomer
  pid. Either pid may be **unknown** — placeholder sessions register with
  `pid: undefined` — so the line SHALL render a placeholder rather than omit the
  field or fail to log.
- `/api/health` exposes a cumulative refusal counter **and** the currently
  recorded contended ids (resolves the first draft's open question): the counter
  catches a rule firing too often, the id list is what an operator needs
  mid-incident.
- The id list follows D4's lifecycle; the counter is cumulative for the process
  lifetime. D2 stops the refuse/reconnect loop for any bridge that understands
  the rejection — an **older bridge that does not** will keep reconnecting, so
  the refusal log and health entry SHALL be rate-limited per session id rather
  than emitted per attempt.

## Risks / Trade-offs

- **The probe adds latency to a contended register** (bounded by its window).
  → Only on the contended path; the uncontended fast path is untouched.
- **A true half-open incumbent is undetectable under D1's rule** and strands the
  session id until the OS TCP timeout. → Accepted deliberately (D1): the
  alternative rule sacrifices busy-but-live sessions, which is worse. Recovery is
  the manual keeper kill already exercised in the incident; TCP keepalive is the
  named follow-up.
- **The `pid`-equality reconnect exemption trusts a self-reported field.** → Used
  only to *avoid* a permanent refusal, never to grant one; a spoofed pid buys an
  attacker no more than registering the id outright already would.
- **A new protocol message is a compatibility surface.** → An older bridge that
  does not understand it still gets closed, i.e. degrades to today's behaviour
  rather than breaking.
- **`stop()` terminating `wss.clients` widens teardown's blast radius** to
  sockets that never registered. → That is the intent (leaked sockets are the
  defect); they are being terminated during shutdown anyway.
- **Callers reading `success:true` as delivery keep over-trusting it.** → Only
  narrowed here; a true ACK is a Non-Goal so the gap stays visible.
- **The change touches the single routing table every session depends on.** →
  The rule is one predicate plus one bounded probe, reproduced by a test that
  connects two sockets on one id before any production change lands.

## Migration Plan

1. Land the reproduction first (two sockets, one id) and watch it go red.
2. Land D3 (identity-scoped cleanup + `stop()` coverage) — pure defect fix, no
   behaviour choice, and it independently stops the "survives a restart" half.
3. Land D0 (claim point + side-effect ordering) — prerequisite for any rule.
4. Land D1/D2 (probe + rejection message), then D4/D6, then D5.
5. Rollback: D1 is one predicate plus a probe; reverting it restores
   last-writer-wins without touching D3's cleanup.

Operationally, an existing duplicate is not auto-reaped (Non-Goal) — after
deploy, the losing keeper is killed by pid as done during the incident.

## Resolved Constants

Pinned at the `scenario-design` clarification gate, because each blocked a
concrete test Triple:

| constant | value | why not an existing one |
|---|---|---|
| contention probe window | **5 s** | matches the low end of the `spawnRegisterTimeoutMs` clamp; cannot reuse `WS_PING_INTERVAL` (60 s) or `HEARTBEAT_TIMEOUT` (180 s) — a register would hang |
| contention record expiry | **60 s** | long enough for an operator to see it mid-incident, short enough not to pin the flag on a healthy session |
| refusal log / health rate limit | **1 per session id per 5 s** | mirrors the bridge's existing refused-inbound-frame warning throttle |

## Open Questions

- None blocking. TCP keepalive on bridge sockets is the named follow-up if the
  undetectable half-open case (D1's accepted residual) shows up in practice.

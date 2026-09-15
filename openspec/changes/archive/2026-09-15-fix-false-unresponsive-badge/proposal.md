# Fix the false "unresponsive" host-pressure badge

## Why

Every live session card showed `unresponsive · 24m 41s` while the sessions were
healthy. Live `/api/sessions` at the same moment reported `processMetrics`
ages of 3–20 s for all 13 live sessions, and the spread across the cards (8 s)
matched the per-session metric ages at the browser's last connect. The badge was
counting time since the page loaded, not time since a bridge went quiet.

Root cause: the shipped capability rests on a false premise. Its spec states

> `processMetrics` … is already carried to the browser in `sessions_snapshot`
> **and `session_updated`**.

The second half was never true. `pi-gateway.ts` writes `processMetrics` on every
heartbeat via `sessionManager.update(...)`, and `sessionManager.onChange`
(`server.ts`) only persists `.meta.json` — no broadcast carries the field
(`grep -rn "processMetrics" packages/server/src` → the gateway write and the
diagnostics routes, nothing else). The browser therefore receives the field
exactly once, in the connect `sessions_snapshot`, where it freezes. The client
derived `Date.now() - processMetrics.updatedAt` and self-ticked every 5 s, so
EVERY live card flipped to `unresponsive` about a minute after page load and
climbed from there.

The client cannot observe bridge silence at all — the fact lives on the server,
next to the heartbeat timers. So the server derives the verdict and pushes it.

## What Changes

- **Server derives host pressure** (`session/host-pressure-tracker.ts`): fed by
  EVERY frame a bridge sends (a blocked event loop cannot put one on the wire),
  emitting `{state, since}` at 35 s (degraded) and 60 s (unresponsive), and an
  explicit `null` when a frame arrives after a verdict.
- **Emission is transition-only**, preserving the capability's cost promise: a
  healthy session costs zero frames; a pressured one costs two.
- **A shed transition frame is repaid.** `session_updated` is transcript-class in
  `browser-gateway.ts` and IS shed under backpressure; its status-reconcile debt
  register rebuilds only `{status, currentTool}`. A shed RECOVERY frame would
  therefore strand a badge forever — this bug back, caused by load instead of by
  a missing broadcast. The reconcile payload carries `hostPressure` too.
- **An OPEN bridge socket is a precondition of the signal.** A wedged event loop
  keeps its socket open and stops writing; a CLOSED socket is carrier loss, which
  the heartbeat/status machinery already models with its own 180 s grace. The
  tracker is therefore cleared on socket close and on every unregister path
  (explicit, heartbeat timeout, sleep-retry expiry, reload placeholder swap), so
  a network blip cannot paint `unresponsive` at 35 s and no timer or map entry
  survives a dead session.
- **Thresholds live in `packages/shared`.** The client's between-transition
  escalation depends on the same numbers the server fires on; two copies would
  drift silently.
- **New session-row field** `hostPressure?: {state, since} | null` (transient,
  not persisted in `sessionToMeta`), broadcast via `session_updated`.
- **The client renders the verdict instead of deriving it.** It still ticks
  locally from the server-stamped `since` so a badge escalates between
  transitions, but never falls BELOW the server's state (browser clock skew must
  not erase a badge the server raised).
- `processMetrics.eventLoopMaxMs` keeps its role: past-tense corroboration only.

## Impact

- Affected specs: `session-host-pressure-indicator` (MODIFIED — the
  data-source requirement replaces the false "already on the wire" premise).
- Affected code: `packages/server/src/session/host-pressure-tracker.ts` (new),
  `packages/server/src/pi/pi-gateway.ts`, `packages/server/src/server.ts`,
  `packages/server/src/pairing/browser-gateway.ts`,
  `packages/shared/src/types.ts`,
  `packages/client/src/components/session/SessionCard.tsx`.
- No new endpoint, no polling loop. A healthy session still adds zero frames and
  zero pixels.

## Discipline Skills

- `systematic-debugging` — the badge was diagnosed against live `/api/sessions`
  evidence and a server-side grep before any code changed; the premise, not the
  threshold, was the fault.
- `review-code` — non-trivial cross-package change (shared type + gateway +
  client render path) reviewed before commit.
- `doubt-driven-review` — cross-model adversarial review of this proposal + delta
  surfaced four contract violations the first draft shipped over: a shed verdict
  frame stranding a badge permanently, carrier loss misreported as host pressure,
  tracker state leaking on every timeout-unregister path, and a self-contradicting
  absent-state scenario. All four are folded into the spec above.

`security-hardening`, `performance-optimization` and
`observability-instrumentation` do not apply: no untrusted input, no new
external call or endpoint, and the change REDUCES emitted frames relative to
any broadcast-every-heartbeat alternative.

# Design — terminate the session process for every spawn strategy

## Evidence this design must satisfy

Sampled at one instant inside the E2E harness, mid-run:

```
tmux panes:      21
resident pi:     21      (~127 MB RSS each)
server records:  0
memory.current:  2550 MiB / 4096 MiB, climbing
```

Any design that does not drive the first two numbers down while the third stays
flat has not fixed this.

## D1 — Where termination belongs: the server, not the caller

**Decision:** terminate inside `handleShutdown`/`handleForceKill`, keyed by the
session's recorded spawn strategy.

Rejected alternatives:

- **Let the E2E fixture kill tmux windows.** Wrong layer: it fixes the harness
  while every real tmux deployment keeps leaking, and it would make the suite
  pass while the product stays broken — the worst possible outcome, since the
  suite is what would otherwise reveal it.
- **Switch the default strategy to `headless`.** Hides the defect. Existing tmux
  deployments still leak, and the code path stays untested.
- **Rely on the advisory gateway `shutdown` message.** This is today's behaviour
  and is exactly what fails: it is a request, not a guarantee, and nothing checks
  the answer.

## D2 — One ladder, many handles

**Decision:** keep a single SIGTERM → grace → SIGKILL escalation (the one
`fix-keeper-kill-escalation` already established) and vary only *how the target
is resolved*:

| strategy | handle recorded at spawn | teardown |
|---|---|---|
| `headless` | PID (+ keeper PID) in `headlessPidRegistry` | existing `killBySessionId` |
| `tmux` | window/pane id **(nothing records this today)** | kill the window, then escalate on the pane's process |

The gap to close first is the missing handle: at present the server cannot name
the tmux window belonging to a session, which is why no teardown could exist.
Killing the window alone is also not sufficient on its own — a pane process that
ignores the hangup must still meet the ladder.

## D3 — Confirm before reporting removed

**Decision:** `session_removed` is broadcast after termination is confirmed; a
failure path emits a diagnostic naming the session and the surviving process.

This is the observability half of the bug and is independently valuable: it is
what would have surfaced the leak on day one instead of presenting as an
anonymous harness-memory mystery weeks later. Note the ordering constraint —
consumers treat `session_removed` as authoritative, so it must not be emitted
optimistically.

**Risk:** a confirmation wait makes shutdown slower, and the E2E reap awaits
`session_removed` per session. Bound the wait with the existing ladder's grace
rather than adding a second independent timeout, and keep failure non-blocking
(diagnose and move on) so one stuck session cannot stall a suite.

## D4 — Orphan detection is a first-class query

**Decision:** expose the "resident session processes vs live sessions" comparison
so it can be asserted, not just observed by a human running `docker exec`.

`scripts/probe-harness-memory.mjs` and `qa/tests/16-e2e-memory-bound.sh` (landed
by `fix-e2e-harness-memory-exhaustion`) already compute this out-of-band; test
P3 becomes meaningful only once divergence is supposed to be zero. This is what
makes a regression of this fix loud instead of silent.

## Open question for implementation

How the tmux window identity is recorded at spawn is deliberately not fixed here
— it depends on how the tmux spawn path names windows today, which must be read
before choosing between (a) a registry keyed by session id, mirroring
`headlessPidRegistry`, or (b) deriving the window name deterministically from the
session id. Prefer (a) for symmetry with the existing ladder unless the spawn
path already guarantees a derivable name.

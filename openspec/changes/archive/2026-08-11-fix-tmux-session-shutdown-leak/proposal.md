# Shutting down a session SHALL terminate its process, whatever spawned it

## Why

Shutting down a session spawned under `PI_SPAWN_STRATEGY=tmux` removes it from
the dashboard and reports success, while the `pi` process keeps running forever,
orphaned. **tmux is the docker default** (`docker/.env.example:37`,
`docker/README.md`), so this is the behaviour most containerised deployments get.

Measured inside the E2E harness at a single instant, mid-run:

| Probe | Value |
|---|---|
| tmux panes | **21** |
| resident `pi` processes | **21** — ~127 MB RSS each |
| sessions the dashboard reports | **0** |
| `memory.current` | 2550 MiB of a 4096 MiB cap, still climbing |

One pane per orphaned process, and nothing in the system knows they exist any
more. Raw evidence:
`openspec/changes/fix-e2e-harness-memory-exhaustion/measurements/tmux-leak-evidence.txt`
and `.../acceptance-timeseries.jsonl`. Filed as issue **#452**.

### Root cause

`handleShutdown`
(`packages/server/src/browser-handlers/session-action-handler.ts`) ends a session
with:

```ts
piGateway.sendToSession(msg.sessionId, { type: "shutdown", sessionId });
await headlessPidRegistry.killBySessionId(msg.sessionId);   // headless only
killHeadlessBySessionId(msg.sessionId);                     // headless only
sessionManager.unregister(msg.sessionId);
broadcast({ type: "session_removed", sessionId });
```

Both kill paths are **headless-only**. A tmux-spawned session is never registered
in `headlessPidRegistry`, so the only thing asking it to stop is the advisory
gateway message. When that does not produce an exit, nothing escalates — yet the
record is unregistered and `session_removed` broadcast unconditionally, which is
precisely what orphans the process.

```
$ grep -rn 'kill-window|kill-session|killWindow' packages/server/src/
(no matches)
```

No code path in the server terminates a tmux-spawned session. The headless
strategy has a full SIGTERM → 2 s → SIGKILL ladder
(`fix-keeper-kill-escalation`); tmux has nothing.

### Why it is worth its own change

Two independent defects compose here, and only the first is about tmux:

1. **No teardown exists for the tmux strategy.**
2. **Shutdown reports success without confirming termination.** Even for
   headless, `session_removed` is broadcast unconditionally. A kill that failed
   is indistinguishable from one that worked — which is why the leak went
   unnoticed long enough to look like an unrelated harness-memory mystery.

## What Changes

- **Every spawn strategy gets a real teardown.** `handleShutdown` (and
  `handleForceKill`) SHALL terminate the session's process regardless of how it
  was spawned — for tmux, by killing the session's window/pane and escalating on
  the process itself with the same SIGTERM → 2 s → SIGKILL ladder headless
  already uses. The ladder is shared, not reimplemented per strategy.
- **Shutdown stops lying.** The server SHALL confirm the process is gone before
  reporting the session removed, and SHALL surface a diagnostic when termination
  fails instead of silently orphaning. A session whose process outlived its
  shutdown SHALL be observable.
- **The harness memory guarantee moves here** (spec delta relocated from
  `fix-e2e-harness-memory-exhaustion`): a full E2E suite run SHALL finish inside
  the container's declared cap. That guarantee was unreachable while every
  shutdown leaked ~127 MB, no matter how correct the suite's per-test reaping is.
- **NOT in scope:**
  - *Changing the default spawn strategy.* Switching the harness or the docker
    default to `headless` would hide this defect rather than fix it, and every
    existing tmux deployment would still leak.
  - *Raising `MEM_LIMIT`.* The Docker VM has 8 GB total against a 4 GiB cap; a
    larger cap postpones the same unbounded accumulation.
  - *The REST/WS liveness divergence* (#449). Adjacent and already filed: the
    REST route omits `setLiveness({closedReason:"manual"})`. Fixing termination
    does not fix that, and vice versa.

## Capabilities

### Modified Capabilities

- `force-kill-handler`: new requirement — ending a session SHALL terminate its
  process for every spawn strategy, and SHALL NOT report the session removed
  until termination is confirmed or explicitly reported as failed.
- `docker-test-harness`: new requirement (moved here) — the harness SHALL
  survive a full suite run inside its declared memory cap.

## Impact

- `packages/server/src/browser-handlers/session-action-handler.ts` —
  `handleShutdown`, `handleForceKill`.
- Wherever tmux sessions are spawned, so their window/pane identity is
  recoverable at shutdown (today nothing records it).
- `tests/e2e/` — the memory-bound L2 assertions
  (`qa/tests/16-e2e-memory-bound.sh`, `scripts/probe-harness-memory.mjs`) already
  exist from `fix-e2e-harness-memory-exhaustion` and become meaningful once this
  lands.

## Dependencies

Builds on `fix-e2e-harness-memory-exhaustion`, which lands the per-test session
reap, the residual-session budget, the fail-loud harness-down latch, the import
guard and the out-of-band memory probe. That change releases session *records*
correctly; this one makes the *processes* actually die, which is what turns the
memory guarantee from unreachable into testable.

## Discipline Skills

- `systematic-debugging` — the root cause was reached evidence-first
  (panes vs processes vs records sampled at one instant); the fix is verified the
  same way rather than by "memory looks better now".
- `security-hardening` — an unkillable process that the system has forgotten is a
  resource-exhaustion path reachable by ordinary use.
- `observability-instrumentation` — the second defect *is* an observability
  failure: shutdown reported success it had not verified.

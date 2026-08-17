# Harden the greeting collapse so the NEWEST greeting always wins

## Why

The `ib-greeting` custom message is a singleton current-state overlay: a newer
greeting REPLACES the prior one in place via a stable id (`custom-ib-greeting`),
keyed collapse in the event reducer. The reducer's replace-in-place is blind to
event **arrival order** — it simply overwrites the existing row with whatever
greeting event arrives last.

That blindness leaves the head one state behind on open. Replay events are built
from a session snapshot; a live tick can persist a newer greeting *after* that
snapshot is taken but the snapshot's (stale) greeting events can still arrive at
the client *after* the newer live greeting. The blind collapse then clobbers the
newer greeting with the stale one, and the head renders one state behind the
newest — the exact symptom users see when opening an invoice.

## What Changes

- Add a monotonicity guard to the reducer's `ib-greeting` collapse: a greeting
  event whose timestamp is **older** than the shown greeting's timestamp SHALL
  NOT overwrite it. The newest greeting wins regardless of arrival order; an
  equal timestamp still replaces (idempotent re-replay of the same state).
- Track the greeting row's timestamp so the guard has an authoritative
  comparison anchor; advance it on every accepted replacement.
- Non-greeting `role:"custom"` messages keep per-entry ids and are unaffected.

## Impact

- Affected specs: `event-reducer`
- Affected code: `packages/client/src/lib/chat/event-reducer.ts`
  (`message_end` custom greeting branch)

## Discipline Skills

- `systematic-debugging` — the fix follows an evidence-first root-cause of a
  live/replay ordering race reproduced by a failing unit test before any change.

No other `eng-disciplines` skills apply: the change touches no auth, untrusted
input, secrets/PII, external calls, latency budget, or irreversible step.

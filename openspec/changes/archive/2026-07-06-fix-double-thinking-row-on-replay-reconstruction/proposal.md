# fix-double-thinking-row-on-replay-reconstruction

## Why

`develop` CI is red. `CI / npm test` fails 3 client reducer tests, all asserting
a single `thinking` row where the reducer now produces two:

- `event-reducer-streaming-text-flush.test.ts` — "flushed shape produces correct
  content-array order" and "thinking row stays before flushed assistant row".
- `event-reducer-interactive-ui-order.test.ts` — "[thinking, text,
  toolCall:ask_user] — thinking, text, tool, ui in that order".

Received `[thinking, thinking, assistant, …]`; expected `[thinking, assistant,
…]`.

Root cause: the archived change `reconstruct-reasoning-on-replay` added a
`message_end` block (`event-reducer.ts:1224`) that rebuilds `role:"thinking"`
rows from `msg.content` thinking blocks, guarded only by `!isLive`. The guard
assumes `!isLive` ⟺ "cold replay, no thinking rows yet". That is false. A turn
can stream `thinking_start/delta/end` (which already pushed one thinking row)
and then reach a `message_end` whose `opts.isLive` is not `true` — the default.
Both producers fire and a duplicate thinking row is appended.

The failing tests encode the correct product invariant: a turn that streamed
reasoning and then finalized must yield **exactly one** thinking row. So the
reducer is wrong, not the tests. `isLive` is the wrong signal — the real
condition is "does a thinking row for this turn already exist?".

## What Changes

- Reconstruct `thinking` rows from `msg.content` only when the current
  assistant turn has **no** existing `role:"thinking"` row (dedupe against rows
  already produced by streaming `thinking_*` events), instead of relying solely
  on `!isLive`.
- Real cold replay (`state-replay.ts`) still emits no `thinking_*` events, so no
  prior row exists and reconstruction still fires — behavior preserved.
- Client-only. No protocol, server, config, or persistence changes.

## Capabilities

### Modified Capabilities

- `event-reducer` — reasoning-row reconstruction on `message_end` gains a
  dedupe guard so a streamed-then-finalized turn yields exactly one thinking
  row regardless of the `isLive` flag.

## Discipline Skills

- None. Pure client reducer fix with unit-test coverage; no auth, perf budget,
  external call, or migration.

## Impact

- `packages/client/src/lib/event-reducer.ts` — `message_end` reconstruction
  skips when a thinking row for the current turn already exists.
- `packages/client/src/lib/__tests__/event-reducer.test.ts` — regression test:
  streamed thinking + non-live `message_end` yields exactly one thinking row.
- Restores green `CI / npm test` on `develop`.
- User-visible: no change. Reopened sessions still show reasoning; live sessions
  no longer risk a duplicate reasoning row.

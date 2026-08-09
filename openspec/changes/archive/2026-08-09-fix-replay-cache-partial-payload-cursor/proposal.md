## Why

A dashboard session can render an empty (or single-row) chat that **survives every
page reload** — history never returns until the user manually clears site data.
Diagnosed live on session `019fd8d5`: the server was healthy throughout
(`loadAndReplay` → 277 events in <100 ms) and a fresh browser rendered the full
history; only the affected browser stayed blank, permanently.

Cause is a **provenance gap** in the durable replay cache. `browser-gateway`'s
`broadcast()` fans an `event` out to every browser socket *regardless of session
subscription*, and `useMessageHandler` unconditionally calls
`replayPersister.record()` on receipt. So a tab that never opened, rehydrated, or
seeded session X still accumulates a buffer for X — typically one stray
`command_feedback` row (the observed case was `/reload completed`).
`replay-persist.ts` then derives `maxSeq` from that buffer itself
(`maxSeqOf(buf)`) and persists it. The entry is internally consistent but its
payload never descended from a replay: it is **not a valid cursor**.

On the next load `rehydrateSession` trusts it, subscribes with `lastSeq: 250`, the
server correctly delta-replays only `seq > 250` (nothing), and the chat shows that
single stray row. Each reload re-persists the same entry, so the failure is
**self-perpetuating** — reloading provably cannot fix it, and only clearing site
data does.

The capability's stated contract is that the cache is "an optimization only" which
degrades safely to full replay on any miss/reset/version-mismatch. This is a hole
in that contract: a non-descended payload degrades to a *permanently wrong view*
instead of a full replay.

## What Changes

- **Provenance invariant (write side).** A per-session buffer is persistable only
  when it **descends from a replay this tab actually received** — a rehydrate hit
  or any `event_replay` batch — rather than being accumulated purely from live
  broadcast events. Provenance is decided by the **kind of message**, not by the
  first seq it carries, so a compacted or capped cold replay starting at `seq > 1`
  still counts. A non-descended buffer is **not persisted**; nothing is deleted,
  so a sibling tab's valid entry is never destroyed.
- **Live-path gap detection.** On the live `record()` path — where sequence
  numbers are contiguous by construction — a seq gap (a frame dropped under WS
  back-pressure) marks the buffer non-descended, so it stops being persisted as a
  cursor and the next load full-replays. Replay-path gaps are **not** treated this
  way: `replay-compaction` legitimately drops events without rewriting seqs.
- **One-shot field repair.** Bump `REPLAY_CACHE_SCHEMA_VERSION` so entries written
  before this change (which carry no provenance marker and may already be
  poisoned) are purged by the existing schema-mismatch path on first read,
  self-healing affected browsers with no user action.
- No protocol change, no server change, no new message type.

### Explicitly rejected

An earlier draft proposed requiring the payload to be **anchored at `seq 1`**.
That is wrong: `replay-compaction.ts` never rewrites seq values, `MAX_REPLAY_EVENTS`
may trim a replay to a tail, and the existing spec scenario *"A healthy cache entry
still delta-rehydrates"* (plus its test) asserts that a payload starting at `seq 5`
is healthy. A seq-1 rule would reclassify correct entries as poison and force
permanent full replays, regressing the very traffic reduction this capability
exists to provide.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `session-replay-persistence`: adds a **cursor-provenance** requirement to the
  existing "cache is an optimization only" contract — a persisted `maxSeq` is
  authoritative only when its payload descended from a replay the client received;
  a buffer accumulated solely from broadcast live events, or one with a live-path
  seq gap, SHALL NOT be persisted as a cursor.

## Impact

- `packages/client/src/lib/replay/replay-persist.ts` — track per-session
  provenance (`seed()` establishes it, `record()` alone does not); live-path gap
  detection; `flush()` persists only a descended buffer.
- `packages/client/src/lib/replay/replay-cache.ts` — `REPLAY_CACHE_SCHEMA_VERSION`
  bump (one-shot purge of pre-change entries via the existing mismatch path).
- `packages/client/src/hooks/useMessageHandler.ts` — distinguish the two
  `record()` call sites so the persister can tell a live broadcast event from a
  replay batch (origin argument); the unconditional `record()` on broadcast
  `event` itself stays.
- Tests: vitest alongside `useMessageHandler.replay-cache.test.tsx` and
  `rehydrate-session.poisoned-cache.test.ts`.
- **Not changed:** `rehydrate-session.ts` keeps its current semantics — the
  existing "healthy entry starting at seq 5 still delta-rehydrates" scenario and
  test remain valid and MUST NOT regress.

## Discipline Skills

`systematic-debugging` (root-causing the empty-chat report) ·
`doubt-driven-review` (proposal + design, before the invariant stands) ·
`scenario-design` (the `test-plan.md` manifest) · `review-code` (before commit,
once the L1 suite is green).

## Review record

- **Doubt cycle 1 — fresh-context adversarial review: run.** Disproved the first
  draft's `seq 1` anchor invariant (see *Explicitly rejected*) and surfaced the
  sibling-tab delete hazard, the hot-path log churn, and the WS-drop gap case.
  All findings reconciled into this revision.
- **Doubt cycle 2 — cross-model review on `@propose-review-1`: NOT run.** Blocked
  by a stale extension `ctx` (subagent spawn failed: *"This extension ctx is stale
  after session replacement or reload"*). Skip explicitly acknowledged by the user
  rather than silently swallowed. This proposal therefore carries **single-model
  review only**.

### Known limitations (accepted, not closed here)

- **Replay-path gaps remain trusted.** A gap arriving inside `event_replay` is
  indistinguishable client-side from a legitimate compaction drop, so it is not
  treated as poison. Closing that would need server cooperation (a
  coverage/anchor hint in the replay envelope) and is out of scope.
- **`flush()` after `drop()`** can resurrect a pre-reset entry; today that
  self-heals downstream because `lastSeq > server maxSeq` triggers
  `session_state_reset`. Documented as existing coupling, not addressed here.

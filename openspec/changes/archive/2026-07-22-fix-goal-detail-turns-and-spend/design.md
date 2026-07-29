## Context

Two independent defects on the goal statistics surfaces, surfaced on a real
completed goal. Both read "statistic not shown", but they have different root
causes and different fixes. Planning-phase doubt-review (single-model +
cross-model `@propose-review-1`) reshaped Decision 2 and expanded the surface
list; the corrections are folded in below.

## Decision 1 — Turns: client fallback to the persisted record (no server work)

The turn data is **already durable**. `persist-goal-status-and-progress` added
`goal-status-projector.ts`, which writes `lastKnownTurnsUsed` / `totalTurnsUsed`
/ `lastProgressAt` onto the `GoalRecord` from the `goal_status` stream. Verified
on record `dcf86d69`: `lastKnownTurnsUsed: 1, totalTurnsUsed: 1`.

The defect is purely that the clients read turns from the ephemeral live snapshot
only. Fix is a one-expression fallback, applied on **both** surfaces:

```
turnsUsed = snap?.turnsUsed ?? goal.lastKnownTurnsUsed   // undefined → "—"
maxTurns  = goal.budget?.maxTurns ?? snap?.maxTurns
```

- `GoalDetailClaim.tsx` (~L211) — inline gauge; fill (`gaugePct`) uses resolved
  `turnsUsed`.
- `GoalsBoardClaim.tsx` — `TurnRing used=… max=…` ring component; **structurally
  different** from the detail gauge (a percentage ring, not an inline bar), so it
  is a separate edit, not a copy-paste. Both bind the same resolved values.

Behavior: live loop → live turns (unchanged); ended/reloaded → persisted
`lastKnownTurnsUsed`; legacy record with neither → `—`.

**Out of scope (decided, not deferred by omission):** `GoalChip.tsx` returns
`null` when `deriveSnapshot` is null, and `GoalControl.tsx` renders `"—"` — both
are **session-scoped** in-session controls with no handle on the folder
`GoalRecord`, so they cannot read `lastKnownTurnsUsed`. They stay live-only.

## Decision 2 — Spend: server-side read-time rollup (not a persisted projector)

**Chosen:** derive `totalSpendUsd` by summing `DashboardSession.cost` over the
goal's `sessionIds`, at every point the server emits goals.

### Corrected rationale (the reset argument was wrong)

An earlier draft justified "sum, don't project" by claiming turns need a projector
because `goal_status.turnsUsed` resets per driver while cost does not. That is
**false on both halves**: (a) turns already have a persisted cumulative field
(`totalTurnsUsed`), and (b) per-session cost **does** reset per driver — a
respawned driver is a new session starting at `cost: 0`. The real asymmetry is the
**data source**, not reset behavior:

- **Turns** arrive only as the **ephemeral `goal_status` event stream**. Nothing
  else records them, so they MUST be projected onto the record to survive the
  driver's death. Hence the projector.
- **Cost** is **owned durably by each session** (`DashboardSession.cost`,
  persisted to `.meta.json`). A goal's spend is fully recoverable at any time by
  summing its linked sessions — no projection needed to survive driver death,
  because the sessions themselves persist.

So the sum is the right tool *because the source is per-session durable*, not
because "cost doesn't reset".

### Rejected — persisted spend projector

A spend projector (mirror of the turns projector) would add a second consumer, a
persisted field to keep in sync, and cross-driver accounting — to compute a number
the per-session cost already yields on read. Its only real advantage is surviving
**unlink/prune** (see limitation). Not worth the surface for v1.

### Delivery paths — the join must cover ALL of them

`goal-routes.ts` GET is not the only path goals reach a client. Doubt-review found:

- `server.ts:1065` — `goalStore.subscribe(... broadcastToAll({ type:"goals_update",
  goals: payload.goals }))` emits **raw** records (`goal-store.ts` broadcasts
  `latest.goals.map(g => ({...g}))`, undecorated). `useGoals` has **no live
  `goals_update` subscription today**, so this path is currently unconsumed — but
  the wire is typed and live, so "server owns the join" is only true if we
  decorate here too.
- POST/PATCH `/goals` responses return the raw mutated record; a client that reads
  the immediate response (not `refetch()`) would see `totalSpendUsd` undefined.

**Resolution — one PURE choke-point helper.** `decorateGoalsWithSpend(goals,
sessionManager): GoalRecord[]` computes the sum per goal and returns **new**
objects — `goals.map(g => ({ ...g, totalSpendUsd }))`, **never mutating in
place**. Purity is load-bearing, not stylistic: `goal-store.ts`
`create`/`update`/`linkSession`/`unlinkSession` return a `result` reference that
is *also* the object stored in the cache (`cache.set(cwd, next)`), so an in-place
`g.totalSpendUsd = …` on a mutation-response record would be written to disk on
the next `JSON.stringify(next)`. A pure map can never touch the cache. Apply the
helper at **every** handler that returns goal record(s): GET, the POST/PATCH
responses, the `linkSession`/`unlinkSession` responses (all return
`data: updated`), and the `goals_update` subscriber (all have `sessionManager` in
scope). Single source of the join. (GET + broadcast are already alias-safe —
`goal-store.ts` emits `latest.goals.map(g => ({...g}))` — but the mutation
responses hand back cache-aliased records, so the helper's purity is what makes
non-persistence hold there.)

### Attribution + robustness

- Spend of a goal = `Σ cost of every session in goal.sessionIds` (its driver
  history, including respawns — every linked session is by construction work for
  that goal).
- `sessionManager.get(sid)` unresolvable, or `.cost` undefined → that session
  contributes `0`. The per-session lookup is guarded (try/catch or optional
  chaining) so one bad id never 500s the list/broadcast.
- **Not persisted (structurally enforced):** the primary guarantee is the helper's
  **purity** — it returns fresh objects and never writes onto a cached record, so
  no delivery path (including the cache-aliased mutation responses) can leak
  `totalSpendUsd` to disk. Secondary facts reinforce it: GET/broadcast decorate
  already-copied records, and the PATCH parser's field allowlist
  (`goal-routes.ts` ~L230-262) rejects a client trying to write it back. This
  matches the existing server-joined `groupId` convention (optional field on the
  type, set on read); no store-side strip is added (parity with `groupId`).

### Accepted limitation — spend shrinks on unlink/prune

Because the sum is over **currently linked** sessions, unlinking a session, or its
`.meta.json`/`events.jsonl` aging out, drops that session's cost from the total.
`totalTurnsUsed` (cumulative, projected) does not shrink — so the two quantities
have asymmetric longevity. Accepted for v1 (the reported problem is "show spend for
a live/just-completed goal", which the sum solves). If spend must survive unlink,
the future path is a persisted cumulative spend projector — explicitly deferred.

## Wire shape

`GoalRecord.totalSpendUsd?: number` — optional, **server-derived at read time**,
never store-written, never bridge-sent. Doc comment states this on the type.

## Display format (client, both surfaces)

- cap set: `${fmtUsd(spend)} / ${fmtUsd(cap)}`, fill = `gaugePct(spend, cap)`.
- no cap: `${fmtUsd(spend)} · no cap`, no fill.
- absent/0 → `$0.00`.
- The cap fill is a **display indicator only** — `maxSpendUsd` is not enforced at
  runtime (`goal-budget-guard.ts` gates `maxTurns` only).

`fmtUsd` = 2-decimal USD; reuse an existing client money formatter if present,
else local `n => "$" + (n ?? 0).toFixed(2)`.

## Out of scope

- Spend-cap **enforcement** (halting at `maxSpendUsd`).
- Persisted cumulative spend (survive unlink/prune).
- `GoalChip` / `GoalControl` live-only behavior.
- Any change to `@ricoyudog/pi-goal-hermes` or the `goal_status` payload.
- Correctness of the underlying per-session cost accounting (owned upstream by
  session stats).

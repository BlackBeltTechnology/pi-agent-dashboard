## Why

The goal detail page shows no execution statistics once the loop is not live, and
never shows spend at all. Reproduced on a completed goal (`achieved`, 1 turn):

- **Turns reads `—/3`** even though the durable `GoalRecord` holds
  `lastKnownTurnsUsed: 1` / `totalTurnsUsed: 1` (correctly projected by
  `goal-status-projector.ts`, change `persist-goal-status-and-progress`). The
  detail gauge renders turns **only** from the live snapshot
  `snap = deriveSnapshot(driverEvents)`; when the driver session ends there are
  no live `goal_status` events, so `snap === null` and it falls back to
  `—/<maxTurns>`. It never reads the persisted turn fields. Every completed or
  reloaded goal therefore shows `—`. `GoalsBoardClaim.tsx` has the **same** dual
  defect (its `TurnRing` reads `snap.turnsUsed` only; its spend block shows only
  the cap). The verdict timeline survives only because it reads persisted
  `goal.verdicts`.
- **Spend is always empty.** The spend gauge only ever renders the *cap*
  (`maxSpendUsd ? "cap $X" : "no cap"`). No actual spend is shown, and none is
  derived anywhere: `GoalStatusSnapshot` (from `@ricoyudog/pi-goal-hermes`)
  carries only `turnsUsed / maxTurns / lastVerdict` — no cost.

Per-session USD cost **is** already tracked: `DashboardSession.cost`
(`packages/shared/src/types.ts:101`) is accumulated in `event-wiring.ts:847`
(`cost: (session?.cost ?? 0) + stats.cost`) and persisted to the per-session
`.meta.json` (`session-to-meta.ts:36` → `session-scanner.ts:84`, debounced). A
goal's spend is therefore the sum of `cost` over its linked sessions — a
read-time join.

**Scope guard:** this change makes existing statistics *visible*. It does NOT add
dashboard-side spend-cap *enforcement* (halting the loop at `maxSpendUsd`) — that
stays deferred as in `goal-authoring`. Today `goal-budget-guard.ts` enforces
`maxTurns` only; `maxSpendUsd` is display-only, so the spend/cap gauge is a
**display indicator, not a runtime budget bar**.

## What Changes

- **FIX (client) — Turns fallback, both surfaces.** `GoalDetailClaim.tsx` (inline
  gauge, ~L211) and `GoalsBoardClaim.tsx` (`TurnRing`) SHALL render turns from the
  live `snap` when present, else fall back to the persisted
  `goal.lastKnownTurnsUsed`; denominator `goal.budget?.maxTurns ?? snap?.maxTurns`.
  Only when neither exists does it show `—`.
- **ADD (server) — one spend-decoration choke point.** A single helper
  `decorateGoalsWithSpend(goals, sessionManager)` SHALL compute
  `totalSpendUsd = Σ DashboardSession.cost` over each goal's `sessionIds`
  (unresolvable session or missing cost → 0; per-session lookup guarded, never
  throws). It SHALL be applied at **every** server→client goal emission so the
  "server owns the join" invariant holds on all paths:
  - GET `/api/folders/goals` (`goal-routes.ts`),
  - POST/PATCH `/goals` responses,
  - the `goals_update` broadcast subscriber (`server.ts:1065`, which has
    `sessionManager` in scope).
- **MODIFY `GoalRecord`** (`packages/shared/src/types.ts`): add optional
  `totalSpendUsd?: number`, documented as **server-derived at read time, never
  persisted, never bridge-sent** — same convention as the existing server-joined
  `groupId`. Decoration runs *after* `store.list()`/on broadcast, so the stored
  record never carries it; the PATCH parser's field allowlist already blocks a
  client from writing it back.
- **FIX (client) — Spend display, both surfaces.** `GoalDetailClaim.tsx` (~L219)
  and `GoalsBoardClaim.tsx` spend block SHALL render actual `goal.totalSpendUsd`:
  cap set → `$0.29 / $5.00` + proportional fill; no cap → `$0.29 · no cap`;
  absent/0 → `$0.00`. (Adds a fill element to the detail spend gauge.)

**Explicit out-of-scope UI (documented, not silently skipped):** the in-session
live controls `GoalChip.tsx` (returns `null` when no live snapshot) and
`GoalControl.tsx` (`turns = snap ? … : "—"`) are session-scoped and cannot read
the folder `GoalRecord`. They stay **live-only** — a completed goal's chip stays
hidden / shows `—`. Changing that needs record access these components don't have;
out of scope for this change.

## Impact

- Affected specs: `goal-detail-stats` (new capability).
- Affected code: `packages/goal-plugin/src/client/GoalDetailClaim.tsx`,
  `packages/goal-plugin/src/client/GoalsBoardClaim.tsx`,
  `packages/server/src/routes/goal-routes.ts`,
  `packages/server/src/server.ts` (broadcast subscriber),
  a new `decorateGoalsWithSpend` helper (server), `packages/shared/src/types.ts`.
- **Migration / compatibility:** additive. `totalSpendUsd` is optional and
  server-derived; older clients ignore it. Legacy records with no
  `lastKnownTurnsUsed` still fall back to `—`. No wire/REST breaking change.
- **Known limitation (accepted):** spend is summed over **currently linked**
  sessions, so unlinking a session — or its `.meta.json`/`events.jsonl` aging out
  — reduces the reported spend. This is asymmetric with cumulative `totalTurnsUsed`
  (which never shrinks). Accepted for v1; a persisted cumulative spend (a spend
  projector mirroring the turns projector) is the future path if spend must
  survive unlink. See `design.md` Decision 2.
- **Cold-start note:** immediately after a server restart, a goal's spend may read
  `0` until its sessions' stats are scanned/replayed; it self-heals on the next
  read.
- **Rollback:** safe — client fallback degrades to today's behavior; the derived
  field is ignored by older clients.
- **Rebuild:** client change → `npm run build` + restart; server change →
  restart (jiti, no build).

## Discipline Skills

- `review-code` — non-trivial cross-layer change (client gauges ×2 + server
  decoration at three emission paths + shared type) reviewed before commit.
- `doubt-driven-review` — DONE in planning (single-model + cross-model
  `@propose-review-1`); it surfaced the WS-broadcast second delivery path, the
  `DashboardSession` type-name fix, the board-surface parity, and corrected the
  spend-durability rationale. Spend attribution across respawned/unlinked drivers
  remains the sensitive edge to re-check at implementation.

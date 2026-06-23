# Design

## Context

`GoalRecord` (dashboard) is the durable definition; `@ricoyudog/pi-goal-hermes`
is source of truth for live loop state, associated by `goalId` on the
`goal_status` snapshot. Control round-trips as `plugin_action` →
`goalCommandFor` → `/goal …` text dispatched into the session. The extension is
**not vendored locally**, so its exact command grammar beyond
`/goal <text>` and `/subgoal <text>` is unconfirmed.

## Decision 1 — Additive `GoalRecord` fields, optional + bounded

Add `judge?` and `verdicts?` as optional. Existing records load unchanged; no
`schemaVersion` bump unless a normalization pass is introduced. `verdicts` is
FIFO-capped (e.g. 50) so the goals file can't grow unbounded on long loops.

- **Why**: zero-migration, safe rollback, older clients ignore unknown fields.
- **Alternative rejected**: separate `verdicts.json` sidecar — more files, more
  atomic-write surface, no real benefit at this volume.

## Decision 2 — Judge/budget into the loop is **probe-gated**

The dashboard cannot assume `pi-goal-hermes` accepts judge/budget config via
command. Three tiers, picked at runtime:

```
probe extension command surface
        │
        ├─ accepts e.g. /goal config --judge … --max-turns …
        │        → push full config into the live loop  (best)
        │
        ├─ accepts only /goal <text> + /subgoal <text>
        │        → criteria via /subgoal (works today);
        │          budget enforced dashboard-side (stop dispatching
        │          continuations past maxTurns / maxSpendUsd);
        │          judge model recorded as intent only           (degraded)
        │
        └─ unknown → record intent on GoalRecord, no loop coupling (safe)
```

- **Why**: ships UI value without inventing an extension API. Screen A always
  *records* the config; enforcement strength depends on the probe.
- **Risk**: dashboard-side budget enforcement double-counts if the extension
  also enforces. Mitigation: only enforce dashboard-side when the probe reports
  the extension does **not** own budget.

## Decision 3 — Verdict timeline built from the existing snapshot stream

No new extension event is required for v1. The bridge already mirrors
`pi-goal-hermes:event` → `goal_status` with `turnsUsed` + `lastVerdict`. The
server appends a `GoalVerdict` whenever `(turnsUsed, lastVerdict)` advances for a
goal's driver session.

- **Why**: reuses the live data path; the timeline is "good enough" from deltas.
- **Limitation**: granularity is per-snapshot, not guaranteed per-judge-call. If
  Hermes coalesces, some intermediate verdicts are lost. Acceptable for v1; a
  richer per-call event is a follow-up if needed.

## Decision 4 — Loop controls reuse the existing `plugin_action` path

Pause/Resume/Done/Clear/Subgoal already map in `goalCommandFor`. Screen C wires
buttons to the existing `sendPluginAction("goal", sessionId, action, payload)`;
no new server contract for control. Only **judge/budget** (Decision 2) and
**verdict retention** (Decision 3) need new server code.

## Migration / compatibility / rollback

- Additive optional fields → forward/backward compatible REST + file format.
- Rollback = revert code; persisted `judge`/`verdicts` become dead-but-harmless.
- Older client + newer server: unknown fields ignored by client → no crash.
- Newer client + older server: `judge`/`verdicts` absent → UI shows empty
  states (no judge pill, empty timeline), never errors.

## Open questions

1. Exact `pi-goal-hermes` command grammar for judge/budget (drives Decision 2
   tier). Resolve by probing an installed extension before the loop-coupling task.
2. Does the extension emit a discrete per-judge-call event we could consume
   instead of deriving from snapshot deltas? (Would upgrade Decision 3.)

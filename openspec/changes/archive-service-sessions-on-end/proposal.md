## Why

Service sessions — the sessions a plugin spawns to do machine work — accumulate
on the board as ordinary ended cards for up to `sessionList.archiveAfterDays`
(default 30). A weekly `consolidate-hermes-memory` automation produces two runs
every Monday in `$HOME`, so a folder the user never opened renders six-plus
stale cards permanently.

Two independent defects produce that symptom.

**1. The automation identity never survives to disk.** `SessionMeta` declares
`kind` and `automationRun` and documents them as *"Persisted so a run session
restored on cold start keeps its automation grouping + effective board
visibility"*, and `session-scanner.ts:229` reads `kind: meta.kind` on restore.
But `sessionToMeta()` — the FULL-OVERWRITE projection whose own header warns
that *"Any dashboard-owned field omitted here is silently WIPED on the next
save"* — enumerates neither. The spawn seam merges them in via
`mergeSessionMeta`; the first routine debounced save wipes them. `automationRun`
is additionally never restored: `session-scanner.ts` contains no reference to
it at all.

Measured on a live install: **0 of 4601** `.meta.json` files carry `kind` or
`automationRun`.

| Consumer | Behaviour once the identity is wiped |
|---|---|
| `filterSessions` (`session-grouping.ts:282`) | a `visibility: hidden` run stops being filtered off the board and renders as a normal card |
| `AutomationBadge` | reads `session.automationRun?.name` → renders nothing |
| ended-run correlation after restart | the `automationRun.runId` stamp is unrecoverable from the sidecar (a *live* run is unaffected — `event-wiring.ts:1409-1426` re-applies the stamp from the pid registry on register) |

The existing guard (`meta-key-byte-identity.test.ts:58`) passes `kind` through
`sessionToMeta` but asserts only `recover`, so the wipe passes CI.

**2. Archiving is age-only and kind-blind.** `archive-sweeper.ts` archives on
`max(endedAt, restoredAt)` vs `archiveAfterDays`. A finished machine run has no
reason to occupy the live set or the board for 30 days: its durable output is
its run record and `result.md`, not a conversation the user returns to.

The host has no way to ask "is this session disposable once it ends". The
closest existing marker, `lifecyclePolicy: "ephemeral"`, is **not** that
question: `embed-session-lifecycle` specifies the embed acquire path to set it
on human visitor chats, and its acquire ladder explicitly *resumes* an ended
ephemeral session. Archiving on that marker would evict conversations the embed
front is specified to resume.

## What Changes

- `sessionToMeta()` enumerates `kind` and `automationRun`; `sessionFromMeta()`
  restores `automationRun` (it already restores `kind`). The byte-identity guard
  gains a round-trip assertion — today it is blind exactly where the wipe
  happens.
- The plugin spawn lifecycle declaration (`PluginSessionLifecycle`, currently
  `{ recover, finalizeOnSocketClose }`) gains `archiveOnEnd?: boolean`. A plugin
  declares that its spawned session is disposable once it ends; core never names
  the plugin. The automation engine sets it; the goal plugin and the embed
  acquire path do not, so visitor chats stay resumable.
- New config `sessionList.archiveServiceSessionsOnEnd` (boolean, default
  `true`) gates the behaviour, independent of `archiveAfterDays`.
- A session declared `archiveOnEnd` is archived after a fixed grace window
  measured from its ended transition, with eligibility re-validated at fire
  time. The grace exists for a specific hazard: archiving evicts the session
  from the live set, and the automation plugin's end-of-session handlers
  (`result.md` capture, `engine.onSessionDeath`) read it.
- One-time backfill at boot scan: an unarchived sidecar with `live !== true`
  (the same gate the existing age rule uses — a clean stop leaves a non-`ended`
  status behind) and `lifecyclePolicy: "ephemeral"` is archived at scan time
  regardless of age. `ephemeral` is used *only* here, and only because the
  orphaned sidecars predate `archiveOnEnd`; it is safe today because the
  automation engine (`engine.ts:695`) is the sole producer of that marker in
  the repo, and `embed-session-lifecycle` is disabled by default.

Non-goals: no deletion of session data (archived sessions stay readable via the
folder `Archive (N)` fold and `/session/:id?archived=1`); no change to
`archiveAfterDays` semantics for user sessions; no change to the idle reaper,
which governs only *active* ephemeral sessions; no change to the automation run
monitor (its route has no in-app producer — `packages/automation-plugin/src/
client/AGENTS.md:11` — and the automation board reads run records, not sessions).

## Capabilities

### New Capabilities
<!-- None. Both halves modify existing behaviour. -->

### Modified Capabilities
- `meta-json-session-cache`: a saved session's plugin classification and
  disposability declaration survive any later save of an unrelated field, and
  are restored on cold start.
- `session-archive-sweeper`: gains a disposable-session archive rule (on-end,
  graced, re-validated) and a one-time boot backfill, both gated on
  `sessionList.archiveServiceSessionsOnEnd` and orthogonal to
  `archiveAfterDays`, and explicitly distinct from the ephemeral lifecycle
  marker so `embed-session-lifecycle`'s resume-an-ended-session acquire step is
  not undercut.

## Impact

- `packages/dashboard-plugin-runtime/src/server/server-context.ts` +
  `packages/server/src/pending/pending-plugin-ref-registry.ts` —
  `archiveOnEnd?: boolean` on the mirrored `PluginSessionLifecycle`.
- `packages/server/src/event-wiring.ts` — carry the declaration onto the session
  at register (beside the existing `lifecycle` resolution at `:1415`); route the
  ended transition to the sweeper (`sessionManager.onEnded` at `:492` is a
  single-owner slot already taken, so the seam is here, not a second subscriber).
- `packages/automation-plugin/src/server/engine.ts` — declare `archiveOnEnd`
  on the run spawn.
- `packages/shared/src/types.ts` + `session-meta.ts` — session + sidecar field.
- `packages/shared/src/config.ts` — `sessionList.archiveServiceSessionsOnEnd`.
- `packages/server/src/session/session-to-meta.ts` — enumerate `kind`,
  `automationRun`, `archiveOnEnd`.
- `packages/server/src/session/session-scanner.ts` — restore `automationRun` +
  `archiveOnEnd` in `sessionFromMeta`; backfill rule beside the age rule.
- `packages/server/src/session/archive-sweeper.ts` — per-session pending grace
  timers (one per session id; `onEnded` re-fires on a later `closedReason`
  change, so scheduling must be idempotent), fire-time re-validation, timers
  cleared in `stop()`.
- `packages/server/src/server.ts` — call `archiveSweeper.stop()` on shutdown;
  it is currently started (`:3044`, `:3050`) and never stopped, so pending
  timers would outlive the server.
- `packages/server/src/session/session-archive.ts` — `ArchiveReason` gains a
  member distinguishing this path from `"sweep"` in the log.
- Tests: `meta-key-byte-identity.test.ts` (round-trip), `archive-sweeper.test.ts`
  (grace, re-validation, idempotent scheduling, stop), session-scanner backfill.

## Discipline Skills

- `review-code` — non-trivial cross-package change (plugin contract + shared
  config + server persistence + archive), reviewed before commit.
- `doubt-driven-review` — applied during planning; it caught the ephemeral-vs-
  disposable conflation, a dead-scope client change, and a wrong scan predicate.
  Re-applied if the grace-window design changes.
- `systematic-debugging` — used to reach the root cause (0/4601 sidecars carry
  the field); re-applied if orphaned cards survive the backfill, which would
  indicate a second identity-loss path.
- `observability-instrumentation` — an automatic eviction needs a log line
  naming its reason, as the age sweep has.

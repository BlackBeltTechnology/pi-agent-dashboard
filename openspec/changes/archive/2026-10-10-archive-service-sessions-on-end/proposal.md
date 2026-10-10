## Why

Service sessions — the sessions a plugin spawns to do machine work — accumulate
on the board as ordinary ended cards for up to `sessionList.archiveAfterDays`
(default 30). A weekly `consolidate-hermes-memory` automation produces two runs
every Monday in `$HOME`, so a folder the user never opened renders six-plus
stale cards permanently.

**Archiving is age-only and kind-blind.** `archive-sweeper.ts` archives on
`max(endedAt, restoredAt)` vs `archiveAfterDays`. A finished machine run has no
reason to occupy the live set or the board for 30 days: its durable output is
its run record and `result.md`, not a conversation the user returns to.

The host has no way to ask "is this session disposable once it ends". The
closest existing marker, `lifecyclePolicy: "ephemeral"`, is **not** that
question: `embed-session-lifecycle` specifies the embed acquire path to set it
on human visitor chats, and its acquire ladder explicitly *resumes* an ended
ephemeral session. Archiving on that marker would evict conversations the embed
front is specified to resume.

**The backlog already on disk is unidentifiable by kind.** Until
`fix-automation-identity-persistence` (#710, archived 2026-09-19)
`sessionToMeta()` dropped `kind` + `automationRun` on every routine save, so the
run sidecars written before it carry neither (measured pre-#710: 0 of 4601
sidecars). That fix is landed — `session-to-meta.ts:109-110` enumerates both,
`session-scanner.ts:244` restores `automationRun`, `meta-key-byte-identity
.test.ts` `#E2` guards it — and is **not** redone here. What remains is that the
pre-#710 run sidecars' only surviving marker is `lifecyclePolicy: "ephemeral"`.

Measured on a live install: 940 ephemeral sidecars, 552 without `kind`, 508
unarchived and not `live`.

## What Changes

- The plugin spawn lifecycle declaration (`PluginSessionLifecycle`, currently
  `{ recover, finalizeOnSocketClose, hidden }`) gains `archiveOnEnd?: boolean`.
  A plugin declares that its spawned session is disposable once it ends; core
  never names the plugin and never reads its ref to decide. The automation
  engine sets it on every run, hidden or shown (a shown run stays on the board
  until archived on end; the Automation view reads the run store, not the
  session). The goal plugin and the embed acquire path do not, so visitor chats
  stay resumable.
- `archiveOnEnd` is persisted only when declared (register seam write +
  `sessionToMeta()` pass-through) and restored in `sessionFromMeta()`. Plain user
  sessions gain no bytes.
- New config `sessionList.archiveServiceSessionsOnEnd` (boolean, default
  `true`) gates the behaviour, independent of `archiveAfterDays`. The existing
  `archiveAfterDays = 0` wording ("disables automatic archiving") and its
  Settings hint are narrowed to age-based archiving.
- A session declared `archiveOnEnd` is archived after a fixed grace window
  (30 s) measured from its ended transition, with eligibility re-validated at
  fire time. The grace exists for a specific hazard: archiving evicts the session
  from the live set, and the automation plugin's end-of-session handlers
  (`result.md` capture, `engine.onSessionDeath`) read it. A session viewed at
  fire time is re-armed for another grace window. A session archived or
  restored by another path meanwhile is left alone, and a restored session is
  not re-scheduled by a later `closedReason` re-notification. Not retroactive:
  a session that ended while the setting was off is left to the boot backfill
  (a separate rule) or the age rule.
- Boot backfill at scan time, on the age rule's gate (`live !== true`,
  `archived === undefined`; `/api/restart` leaves runs `live` to reattach),
  regardless of age:
  - **declared leg, every boot** — `archiveOnEnd: true` (a grace timer that died
    with the server);
  - **legacy leg, first boot of the new server only** — `lifecyclePolicy:
    "ephemeral"` and not declared. It exists only because the pre-#710 run
    sidecars' sole surviving marker is `ephemeral`. A
    `serviceArchiveBackfillAt` stamp in `~/.pi/dashboard/boot-state.json` makes
    it one-shot, so it can never reach a post-upgrade embed visitor chat.
- `AutomationRunMonitor` keeps working once its run session is archived: it
  resolves the run from the run store by session id, renders status +
  `result.md`, and links the transcript to `/session/:sid?archived=1`.

Non-goals: no deletion of session data (archived sessions stay readable via the
folder `Archive (N)` fold and `/session/:id?archived=1`); no change to
`archiveAfterDays` semantics for user sessions; no change to the idle reaper,
which governs only *active* ephemeral sessions; no re-work of
`kind`/`automationRun` persistence (landed in #710); no Settings UI control for
the new flag (config file + config endpoint only); no fix for ended sidecars
stranded with `live: true` (pre-existing, shared with the age rule).

## Capabilities

### New Capabilities
<!-- None. All changes modify existing behaviour. -->

### Modified Capabilities
- `meta-json-session-cache`: the durable-identity requirement extends to the
  disposability declaration.
- `automation-run-lifecycle`: every run spawn declares disposable-on-end; a
  `shown` run renders on the board until archived on end; Automation view
  presence comes from the run record; the run monitor falls back to the run
  store + archived transcript when the session is archived.
- `session-archive-sweeper`: `archiveAfterDays = 0` narrowed to age-based
  archiving; gains a disposable-session archive rule (on-end, graced,
  re-validated) and a boot backfill (declared leg + one-shot legacy leg), both
  gated on `sessionList.archiveServiceSessionsOnEnd`, and explicitly distinct
  from the ephemeral lifecycle marker so `embed-session-lifecycle`'s
  resume-an-ended-session acquire step is not undercut.
- `settings-panel`: the `archiveAfterDays` hint says `0` disables age-based
  auto-archive.

## Impact

- `packages/dashboard-plugin-runtime/src/server/server-context.ts` (`:167`) +
  `packages/server/src/pending/pending-plugin-ref-registry.ts` (`:48`) —
  `archiveOnEnd?: boolean` on the mirrored `PluginSessionLifecycle`; add it to
  the `hasLifecycle` test in `file()` (`:196-200`) and to
  `CORE_RESERVED_REF_KEYS` (`:27`); mirror the reserved key in
  `packages/chat-gateway/src/server/__tests__/fake-seam.ts`.
- `packages/server/src/event-wiring.ts` — widen the inline lifecycle type
  (`:1636`); in the register seam's `if (lifecycle)` block set `archiveOnEnd` in
  memory and persist it with its own `mergeSessionMeta` (like `recover:false`,
  `:1713`). Ended routing: the single `sessionManager.onEnded` owner (`:602`)
  calls the sweeper; `wireEvents` deps gain the sweeper handle.
  `pendingArchiveIntents` (user-requested archive on unregister, `:695-699`)
  unchanged.
- `packages/automation-plugin/src/server/engine.ts` — widen the local spawn
  lifecycle type (`:175-176`); `archiveOnEnd: true` in the run spawn `lifecycle`
  (`:726`). Result endpoint accepts `sessionId` (run-store lookup).
- `packages/automation-plugin/src/client/AutomationRunMonitor.tsx` + `api.ts` —
  non-resident fallback + `?archived=1` transcript link.
- `packages/shared/src/types.ts` + `session-meta.ts` — `archiveOnEnd` on session
  + sidecar.
- `packages/shared/src/config.ts` — `archiveServiceSessionsOnEnd` in the
  `sessionList` type, `DEFAULT_SESSION_LIST` (`:299`), `parseSessionListConfig`
  (`:1455`), `validateSessionListConfig` (`:1478`).
- `packages/server/src/session/session-to-meta.ts` — enumerate `archiveOnEnd`
  (pass-through).
- `packages/server/src/session/session-scanner.ts` — restore `archiveOnEnd` in
  `sessionFromMeta`; `ScanOptions` gains the flag + `legacyPass`; backfill as a
  separate branch beside the age rule (`:395`).
- `packages/server/src/persistence/boot-state.ts` — read/stamp
  `serviceArchiveBackfillAt`.
- `packages/server/src/session/archive-sweeper.ts` — `getConfig` type widened;
  `scheduleServiceArchive(id)`; per-session pending grace timers (one per id),
  fire-time re-validation, per-instance stopped latch, timers cleared in
  `stop()`.
- `packages/server/src/session/session-archive.ts` — export `ArchiveReason`;
  gains `"service-end"`.
- `packages/server/src/server.ts` — `archiveSweeper.stop()` after
  `piGateway.stop()` in both the server `stop()` and the `start()` failure
  teardown (`:2862-2870`); stamp the backfill marker after the boot scan.
- `packages/client/src/components/settings/SettingsPanel.tsx` + i18n — hint
  wording.
- Tests: `meta-key-byte-identity.test.ts`, `archive-sweeper.test.ts`,
  `session-scanner.test.ts`, boot-state, config tests, register-seam test,
  pending-ref registry test, engine spawn + result-by-sessionId tests,
  `AutomationRunMonitor` test, `SettingsPanel` test.

## Discipline Skills

- `review-code` — non-trivial cross-package change (plugin contract + shared
  config + server persistence + archive), reviewed before commit.
- `doubt-driven-review` — applied during planning (three cycles, cross-model);
  caught the already-landed identity fix, the unarchive-within-grace race, the
  `archiveAfterDays = 0` contradiction, the core-reads-ref violation of a
  key-presence fence, the `/api/restart` live-run hazard, and the archived-run
  monitor gap.
- `systematic-debugging` — used to reach the root cause; re-applied if orphaned
  cards survive the backfill, which would indicate a second identity-loss path.
- `observability-instrumentation` — an automatic eviction needs a log line
  naming its reason, as the age sweep has.

## Why

Archived sessions come back. Archiving itself works (manual, age sweep, and
`archive-service-sessions-on-end` all evict and stamp `archived: true`), but two
on-demand history-seeding loops re-read every `.jsonl` in a folder and re-insert
any id that is not resident — which is exactly every archived id. The re-insert
goes through `register` → `unregister` → `update`: `register` queues a save of the
header-only record, and `unregister`'s eager liveness write uses that queued record
as its base and writes it over the sidecar, so `archived`/`archivedAt` and the
automation identity (`kind`, `automationRun`, `archiveOnEnd`) are erased.

Measured on a live install (2026-11-17): 213 sessions were simultaneously in the
archive index AND resident; 210 sidecars in one folder were rewritten in the same
second as `source: "tui"`, `closedReason: "unknown"`, no archive fields. Reproduced
in a scratch folder: archive session A, spawn session B in the same folder → A is
resident again and its sidecar has lost `archived: true`. After the next restart
the index (rebuilt from sidecars) would forget them permanently.

The guard already exists — `session-bootstrap.ts:35` skips `sessionArchive.has(id)`
(added by `archive-sessions-lazy-load`) — but the same loop was copy-pasted to two
more sites that never received it.

## What Changes

- Extract one shared history-seeding helper used by all three discovery sites:
  boot (`session/session-bootstrap.ts`), first-session-in-folder
  (`event-wiring.ts` `isNewCwd` branch), and pin-folder
  (`browser-handlers/directory-handler.ts` `pinDirectorySideEffects`).
- The helper skips any id that is resident, present in the archive index, or
  already has a sidecar (boot restored every sidecar-backed session, so a
  non-resident one is archived or broken), so the guard cannot drift between
  copies again and a seed can never stand in for a real sidecar.
- The helper seeds through `sessionManager.restore()` (no lifecycle hooks, no
  sidecar write) instead of `register` → `unregister` → `update`, so seeding a
  discovered transcript never rewrites its sidecar.
- Seeded history has one uniform shape (ended, `hidden: false`,
  `dataUnavailable: true`, evidence-derived `endedAt`), matching the boot path. The
  first-session-in-folder path's leftover `hidden: true` literal is dropped, as
  `archive-sessions-lazy-load` already did for boot; the two on-demand sites' seeds
  flip `dataUnavailable` from `false` to `true`, like boot.
- Resume placement treats a register whose prior in-memory status was `ended` as a
  resume, so resuming a seeded (or unarchived) session still gets its Resume
  placement.
- Out of scope: repairing already-resurrected sessions (done operationally on
  2026-11-17 by re-archiving the 213 split-brain ids via the archive API before
  any restart), and making the routine sidecar save merge instead of overwrite.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `meta-json-session-cache`: the "Session discovery by filesystem scan"
  requirement's archived-skip rule currently names only pinned-directory header
  discovery; widen it to every on-demand `.jsonl` header discovery path, and
  require that discovery seeding never writes the session's sidecar.

## Impact

- Code: `packages/server/src/session/session-bootstrap.ts`,
  `packages/server/src/event-wiring.ts`,
  `packages/server/src/browser-handlers/directory-handler.ts`,
  `packages/server/src/server.ts` (resume `wasEnded` check), plus the new shared helper
  module under `packages/server/src/session/`.
- No protocol, API, config, or client change.
- Behaviour: archived sessions stay archived when a new session starts in their
  folder or the folder is pinned. Resuming an unarchived session now gets the same
  Resume placement as any other ended session. Discovered non-archived history in a folder
  entered after boot becomes visible (`hidden: false`) instead of auto-hidden.

## Discipline Skills

- `review-code` — non-trivial server change; review before commit.
- `systematic-debugging` — root cause already established by live evidence and a
  scratch-folder reproduction; the repro becomes the regression test.
- No `security-hardening`, `performance-optimization`,
  `observability-instrumentation`, or `doubt-driven-review`-for-irreversible-step
  trigger applies: no untrusted input, no latency budget, no new endpoint, no
  migration (the data repair was an operational step outside this change).

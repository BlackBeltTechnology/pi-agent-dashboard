# Fix: session-name provenance is lost on restart/resume and dashboard renames latch `user`

> plan-proposal is driving this change. Originally scoped as an investigation
> (split out of `fix-auto-naming-reasoning-model`, design D8b); the investigation
> ran during planning and re-scoped it to a fix. Findings below.

## Why

Name provenance (`nameSource`) drives the permanent auto-naming lockout. On the live
system it is almost entirely wrong: **0 `auto` vs 1062 `user`** across 2467
`~/.pi/agent/sessions/**/*.meta.json` (snapshot 2026-10-11 — top-level `nameSource` of
each parsed `.meta.json`, NOT a text grep, which double-counts the nested
`autoNamerState.nameSource`; 174 at proposal time on 2026-08-20; 502 of the `user` rows
had an mtime of 2026-10-10). Every one of the 914 `user` rows
that carries `autoNamerState` has `attemptsUsed: 0`, `hasAutoName: false` and no
`lastSelfApplied` — the auto-namer evidence has been erased. Two distinct causes:

**Cause A — provenance is dropped on process restart and session resume.**
The original premise ("`lastSelfApplied` is not carried across reload") is stale:
`fix-auto-naming-reasoning-model` (#526) carries the full namer state across an
in-process reload via `prev.namerState`. Provenance is still lost when:

- the pi **process restarts** — the server's register-time `auto_name_state_restore`
  deliberately strips `nameSource` / `hasAutoName` / `lastSelfApplied`, and the bridge's
  adopter forces `hasAutoName: false`;
- the bridge **switches/resumes a session** — it resets `namerState` and relies on that
  same stripped restore.

The next observation of the session's own auto-name then finds no matching
`lastSelfApplied`, classifies it external, latches `user`, and persists state that
overwrites the stored evidence. This also violates the existing spec scenario
"Seed provenance on reconnect" (`bridge-auto-session-namer`), which no production path
honours — `seed()` is called only from tests.

**Cause B (new, likely dominant) — the dashboard's own renames are classified as a user rename.**
Sampled `user` names are change slugs (`add-team-plugin`, `fix-ci-pipeline-followups`).
The server's attach auto-rename sends `rename_session`, the bridge calls
`pi.setSessionName`, pi echoes it via `session_info_changed`, and `classifyNameChange`
finds no self-applied match → `user`. Detach auto-revert and the plugin-host
`renameSession` take the same path.

## What Changes

- **New provenance value `system`** (`nameSource: "auto" | "user" | "system"`): a name the
  dashboard set programmatically (attach auto-rename, detach auto-revert, trusted-plugin
  rename). Not a user lockout; the auto-namer also does not overwrite it. A later genuine
  rename still escalates to `user`; `system` never downgrades `user`.
- **`rename_session` (server→bridge) carries an origin.** System senders tag it and record
  `system` server-side; the bridge applies the provenance change synchronously BEFORE
  setting the name so the pi echo classifies as `system`, not external. Absent origin
  keeps today's behaviour (compatibility). REST rename now tags `user` server-side.
- **Server-owned witness + stale-claim guard.** New `SessionMeta.nameSourceFor` records
  the name an `auto`/`system` provenance applies to; the server refuses a `user` claim for
  exactly that name (old-bridge echo, restart relabel, register→restore race).
- **Register-time restore carries provenance.** `auto_name_state_restore` additionally
  carries the server-owned `nameSource` + witness; the bridge adopts it on restart AND
  session resume, and applies it even to a namer an early observation already created.
- **Detach specs aligned with shipped code.** Detach reverts an attach-set name (as the
  code already does), now skipped when the name is user-owned.
- **No migration.** Forward-only: the existing 1062 `user` rows stay as-is (decided during
  planning; a blanket reset would clobber genuine renames and the evidence to separate
  them is erased).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `bridge-auto-session-namer` — provenance seeding on restart/resume (incl. live namer),
  `system` classification, `system` in eligibility, carried-state enumeration.
- `bridge-extension` — `session_info_changed` self-filter also ignores `system` echoes.
- `session-rename` — programmatic renames record `system`; REST rename tags `user`;
  stale-`user`-claim guard; detach revert wording.
- `meta-json-session-cache` — `nameSource` gains `"system"`; new `nameSourceFor` witness.
- `proposal-attachment`, `openspec-attach-combo` — detach revert matches shipped code,
  skipped for a user-owned name.
- `dashboard-server` — REST rename records `user` server-side.

## Impact

- `packages/extension/src/auto-session-namer.ts` (`classifyNameChange`,
  `adoptRestoredNamerState`, `createAutoNamer`, `isEligible`, `PersistedNamerState`,
  `nameSource` unions), `bridge.ts` (restore handler incl. live-namer apply, stale
  comments at the restore handler), `command-handler.ts` (`rename_session` origin hook).
- `packages/server/src/event-wiring.ts` (restore projection, attach auto-rename,
  `session_name_update` guard), `session/session-api.ts`,
  `browser-handlers/session-meta-handler.ts`, `server.ts` (plugin `renameSession`),
  `openspec/proposal-attach-naming.ts` (`detachShouldClearName`),
  `session/session-to-meta.ts` + `session-scanner.ts` (`nameSourceFor`),
  `pending/pending-plugin-ref-registry.ts` (`nameSourceFor` reserved).
- `packages/shared/src/{protocol,types,session-meta}.ts` — `nameSource` union widened;
  `nameSourceFor` (on `SessionMeta` and `DashboardSession`); `sanitizeSessionName` moved
  here from the extension so server and bridge compare identically; `rename_session.origin?`; restore payload widened (and the
  `AutoNamerStopState` doc comment that says provenance is never carried).
- Wire compatibility: all new fields optional; old↔new pairs keep at least today's
  behaviour, and the server guard keeps persisted provenance correct against an old
  bridge. Rollback: a reverted build reads `system` as "not user" and may auto-name over
  a dashboard-set name (a visible rename; no other data loss).

## Discipline Skills

- `systematic-debugging` — the restart/resume and echo paths must be reproduced as
  failing tests before the fix.
- `doubt-driven-review` — the provenance lattice and the arming gate change the
  permanent-lockout state machine for every session; stress-tested in planning.
- `review-code` — non-trivial cross-package change, before commit.

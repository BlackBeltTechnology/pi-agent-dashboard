# Test Plan — fix-ended-session-missing-endedat

Stage: design   Generated: 2026-08-11

All three clarifications raised at the HARD gate were answered before this
catalog was written:

- **C1** evidence precedence → recorded last activity, then transcript
  last-write time, then `startedAt`.
- **C2** a heartbeat/grace-expiry ending is **not** witnessed → evidence-derived,
  not detection time.
- **C3** the performance scenario is **dropped**; boot cost is covered
  structurally by E12 (no filesystem call when `endedAt` is already present)
  rather than by a timing threshold.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 ended always has timestamp | state-transition | L1 | automated | session in map, `status:"active"`, `endedAt` undefined | `update(id, {status:"ended"})` with no `endedAt` | record has a numeric `endedAt` |
| E2 | R1 explicit value preserved | equivalence | L1 | automated | session ending with caller-supplied `endedAt = 1_700_000_000_000` | `update(id, {status:"ended", endedAt})` | stored `endedAt === 1_700_000_000_000` |
| E3 | R1 re-ending | state-transition | L1 | automated | session already `ended` with `endedAt = T` | `update(id, {status:"ended"})` again, no timestamp | `endedAt` still `T` |
| E4 | R1 restore path | state-transition | L1 | automated | object `{status:"ended"}`, no `endedAt` | `restore(session)` — the bare `sessions.set` path | stored record has a numeric `endedAt` |
| E5 | R2 precedence, both present | decision-table | L1 | automated | reconstructed session, `lastActivityAt = A`, transcript mtime `M`, `A ≠ M` | restore with no `endedAt` | `endedAt === A` |
| E6 | R2 precedence, activity absent | decision-table | L1 | automated | reconstructed session, no `lastActivityAt`, transcript mtime `M` | restore with no `endedAt` | `endedAt === M` |
| E7 | R2 precedence, no evidence | decision-table | L1 | automated | reconstructed session, no `lastActivityAt`, transcript unreadable | restore with no `endedAt` | `endedAt === startedAt` |
| E8 | R2 witnessed ending | state-transition | L1 | automated | running session, `lastActivityAt = T − 60s` | server directly witnesses the end at `T` | `endedAt === T`, not `T − 60s` |
| E9 | R4 liveness excludes bad record | decision-table | L1 | automated | record `status:"ended"`, `endedAt` undefined | `listActive()` | record absent from the result |
| E10 | R4 live session has no timestamp | decision-table | L1 | automated | running session, no `endedAt` | `listActive()` | record present; missing `endedAt` is not treated as a defect |
| E11 | R3 seeding by end time | state-transition | L1 | automated | two ended ids absent from stored order: `S1` started 10:00 ended 12:00, `S2` started 11:00 ended 11:30 | `reconcileSessionOrder` seeds them | `S1` is seeded ahead of `S2` |
| E12 | R1 + boot cost | decision-table | L1 | automated | session already carrying `status:"ended"` and an `endedAt` | enters the map via `restore()` | no filesystem stat is performed for that record |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R2 badge on the bootstrap path | state-transition | L3 | automated | historical TUI session restored by `session-bootstrap`, transcript last written 30 days ago, no `lastActivityAt` | dashboard renders its card in the ended tier | the card's time badge reads ~30 days, not the age of `startedAt` and not "just now" |
| F2 | R3 stored order is authoritative | state-transition | L3 | automated | a directory whose ended tier already has a stored order, browser connected | server restart replays the boot restore loop | ended-tier order is identical before and after, and **zero** `sessions_reordered` frames are received during the restore loop |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R2 timeout-inferred ending | fault-injection (abort) | L1 | automated | bridge dies silently; session's last activity is `T − 5min` | server concludes the session ended when the grace period expires at `T` | `endedAt === T − 5min`, not `T` |
| X2 | R2 unreadable evidence | fault-injection (abort) | L1 | automated | transcript file missing or unreadable when the timestamp is derived | session reconstructed at boot | falls back to `startedAt`, no exception escapes, the remaining sessions still restore |
| X3 | R5 abandoned zombie normalisation | state-transition | L1 | automated | zombie session with `status:"active"` and **no** `sessionFile` | prompt normalises it to `"ended"` then hits the early return at `session-action-handler.ts:229-231` | record carries an evidence-derived `endedAt`, not the time the normalisation ran |
| X4 | R2 history register→unregister | fault-injection (abort) | L1 | automated | historical sessions discovered for a directory, each with a known `modifiedAt` | directory is added/pinned, driving `register()` then `unregister()` | each record's `endedAt` equals its evidence value, not the time the directory was added |

---

## Coverage summary

- Requirements covered: 5/5 (R1 ended-always-has-timestamp, R2 evidence
  derivation, R3 seeding order, R4 liveness-is-status, R5 transitional ended)
- Scenarios by class: edge 12 · perf 0 (dropped per C3) · frontend 2 · error 4
- Scenarios by level: L1 16 · L2 0 · L3 2
- Scenarios by disposition: automated 18 · manual-only 0

No `manual-only` rows: every requirement in this change has a machine-checkable
observable (a stored field value, a list membership, a seeded order, a rendered
badge, or the absence of a broadcast frame). Nothing here rests on human
judgment.

No L2 rows: this change has no install, spawn, or multi-OS runtime surface.

## New infra needed

None. L1 rows extend the existing vitest suites beside
`packages/server/src/session/`; the two L3 rows extend the existing Playwright
suite against the docker harness, reading its derived `dashboardPort` from
`.pi-test-harness.json` rather than a hardcoded port.

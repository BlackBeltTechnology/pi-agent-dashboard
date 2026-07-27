## Context

Cold-start recovery decides "was this session running when the host died?" from
`.meta.json` alone: `live:true ∧ status≠"ended" ∧ closedReason≠"manual" ∧ kind≠"automation"`
(`packages/shared/src/session-meta.ts:184`). The `live` marker is stamped eagerly while a
session runs and is expected to be **cleared** by every clean exit. Recovery is therefore
*proof by absence*: nothing cleared the flag ⟹ assume a crash.

Verified state of the exit paths (this repo, today):

| path | code | clears marker? |
|---|---|---|
| `server.stop()` | `server.ts:2278` loop over `listActive()` | yes |
| manual close / force-kill | `session-action-handler.ts:547,693` | yes (`closedReason:"manual"`) |
| dismiss / retract | `server.ts:790` `retractRecoveryCandidate` | yes |
| `POST /api/restart` | `system-routes.ts:542` → `spawnRestart` → `process.exit(0)` | **no** |
| `POST /api/shutdown` | `system-routes.ts:503` → `process.exit(0)` | **no** |
| SIGTERM / SIGINT | *no handler in `cli.ts`* | **no** |
| SIGKILL / power loss | — | no (correct) |

`server.stop()` is reachable from exactly two callers: `idleTimer.setStopFn(server.stop)`
(`server.ts:2320`) and Electron's `before-quit` → `/api/shutdown`. So the marker-clearing
behaviour is anti-correlated with user intent:

```
                          stop() runs?   marker    outcome
  PC restart (idle-stop     YES          cleared   NO offer   ← false negative
    or Electron quit first)
  POST /api/restart          NO          kept      OFFER      ← false positive
  true crash / power cut     NO          kept      OFFER      ← correct
```

`fix-recovery-offer-bridge-liveness-gate` added a two-channel process-liveness gate to
compensate (Class 1 keeper reclaim, `server.ts:1717`; Class 2 bridge reattach,
`server.ts:373`). It is sound in principle but two implementation facts defeat it on the
restart path:

- `RECOVERY_REATTACH_GRACE_MS = 2500` (`server.ts:226`) vs `RESTART_QUIESCE_MS = 5000`
  (`system-routes.ts:136`). `announceRestart` tells bridges to suppress reconnect for 5 s;
  the retraction window closes at 2.5 s and `liveRecoveryCandidates` is then *finalized*.
  Class 2 cannot fire. No test relates the two constants.
- The `ask` offer is **broadcast immediately** and merely made non-actionable until
  `graceUntil` (its `tasks.md` 3.1 records this as a deliberate deviation from the design's
  "defer the broadcast"), so the card is visible on every restart regardless of retraction.
- Its §4 resume-time liveness re-check was marked optional and, per its own `tasks.md`,
  **not implemented** — justified as "eliminated by construction" by the gate, which the
  two facts above invalidate.

## Goals / Non-Goals

**Goals:**
- Replace proof-by-absence with a **positive, closed** record of deliberate exit intent.
- `/api/restart` and `/api/shutdown` never produce recovery candidates — without relying on
  any timing window.
- An idle auto-stop and an OS-initiated shutdown **do** leave sessions recoverable.
- Keep the 07-22 liveness gate as defense-in-depth and make its window arithmetically capable
  of firing.
- Never under-offer relative to today (unknown/absent record ⇒ recovery allowed).

**Non-Goals:**
- Removing the per-session `live` marker or the liveness gate. Both stay; the boot record
  closes the enumeration they sit on.
- Any new user-facing setting. `reopenSessionsAfterShutdown` semantics are unchanged.
- Per-session pick-and-choose within the offer.
- Reliable OS-shutdown-vs-user-quit discrimination inside Electron (see Open Questions).

## Decisions

### D1 — Server-scoped boot record carrying positive exit intent

One file, `~/.pi/dashboard/boot-state.json`, written atomically (tmp + rename):

```json
{ "bootId": 1785136186530, "exitIntent": null, "at": 1785136186530 }
```

- **At startup**, after reading the previous record, write `{ bootId: liveEpoch, exitIntent: null }`.
  `bootId` reuses the existing `liveEpoch` (`server.ts:291`) so sessions already carry their
  owning boot id — no new per-session field.
- **On every deliberate exit**, overwrite `exitIntent` before `process.exit`.
- **A crash never overwrites it** → the record stays `null` → dirty boot.

Why server-scoped rather than per-session: an exit path must write **O(1)**, not O(sessions).
The current `stop()` loop writes N sidecars on the way down and is skipped entirely by the
paths that matter. One atomic rename is cheap enough to run in `/api/restart`, `/api/shutdown`,
and a signal handler.

**Alternative rejected — clear `live:false` per session inside `/api/restart`.** This is what
`fix-recovery-offer-bridge-liveness-gate` considered and dismissed as "insufficient". It *is*
insufficient alone (it misses signals and supervisor kills) and it races the exit with N writes.
The boot record generalises it: one write covers every session, and the signal handler (D4)
covers the paths a per-endpoint fix cannot.

### D2 — Exit-intent → recovery mapping

`ExitIntent = "restart" | "shutdown" | "user-quit" | "idle" | "signal" | null`

| intent | recorded by | recovery |
|---|---|---|
| `restart` | `POST /api/restart` | **suppress** — sessions survive via keeper; the server is being replaced |
| `shutdown` | `POST /api/shutdown`, CLI `stop` | **suppress** — deliberate teardown of this server |
| `user-quit` | Electron `before-quit` (user-initiated) | **suppress** — user closed the app on purpose |
| `idle` | idle timer → `stop()` | **allow** — the *server* chose to stop; the user closed nothing |
| `signal` | new SIGTERM/SIGINT handler | **allow** — OS-initiated (reboot / systemd stop) |
| `null` / absent | crash, SIGKILL, power loss, pre-upgrade | **allow** — the original target case |

The load-bearing distinction: **server-lifecycle intent lives in the boot record; per-session
user intent already lives in `closedReason:"manual"`.** A session the user actually closed is
excluded by `closedReason`, so app-quit and idle-stop do not need to double as "the user
discarded these sessions". This is what lets `idle` flip to *allow* and fix the false negative
without re-introducing nagging.

### D3 — Classification gains one conjunct

```text
recoverable(bootId) = exitIntentFor(bootId) ∈ { "idle", "signal", null }

candidate = live === true
          ∧ status !== "ended"
          ∧ closedReason !== "manual"
          ∧ kind !== "automation"
          ∧ recoverable(meta.liveEpoch)          ← NEW
```

`exitIntentFor` resolves a session's `liveEpoch` against a **bounded ring of the last 8 boot
records** (kept in the same file). Rationale: two consecutive dirty boots must not lose a
legitimate offer from the first one, which a single-record "previous boot only" check would
discard. An unknown `liveEpoch` (older than the ring, or absent) resolves to `null` ⇒ allowed,
preserving the never-under-offer property.

Corollary: `stop()` **no longer clears `live` markers**. Clearing was the mechanism being
misused as a signal; intent is now recorded explicitly. Marker consumption on
dismiss / retract / offer-broadcast is unchanged (it enforces "shown once per dirty boot").

### D4 — SIGTERM/SIGINT handler recording `"signal"`

`runForeground()` (`cli.ts:151`) installs no signal handlers, so an OS shutdown kills the
server with no trace. Add handlers that record `exitIntent:"signal"`, `flushAll()`, and exit.
This makes the PC-restart case an *explicit recoverable* exit rather than an accident of
"nothing ran". It also stops SIGTERM from silently skipping `metaPersistence` flushes.

Scope note: the handler must be idempotent and must not fight `spawnRestart`'s
SIGTERM→SIGKILL ladder (`restart-helper.ts:158`) — the restart intent is recorded *before* the
ladder runs, and `exitIntent` is write-once-per-boot (first writer wins) so a subsequent
`signal` cannot overwrite `restart`.

### D5 — Derive the grace window from the quiesce window

```ts
// must outlast the window during which bridges are told NOT to reconnect
const RECOVERY_REATTACH_GRACE_MS = RESTART_QUIESCE_MS + RECONNECT_HEADROOM_MS; // 5000 + 2000
```

Both constants move to one shared module so the relation is expressible, plus a test asserting
`RECOVERY_REATTACH_GRACE_MS > RESTART_QUIESCE_MS`. With D1–D3 the restart path no longer
depends on this window at all; the correction matters for the `signal` / crash paths where
keepers or bridges survive the server.

### D6 — Defer the `ask` broadcast until liveness resolves

Broadcast after the grace window closes, per `fix-recovery-offer-bridge-liveness-gate`'s
design, instead of broadcasting immediately with a non-actionable button. The offer is sticky
and non-timed, so a ~7 s delay is imperceptible; a card that appears and then retracts is the
actual defect. `graceUntil` / the "verifying" resume state remain as a safety net for a client
that connects mid-window.

### D7 — Land the resume-time liveness re-check

`handleResumeSession`'s `continue` path guards on in-memory `status` plus the grace window
(`session-action-handler.ts:288-303`). Add a real keeper/bridge liveness probe so a stale offer
can never double-spawn one `sessionId` (returns `resume.already_active`). Required, not
optional: it is the only guard that holds when an upstream assumption breaks — which is the
exact failure mode this lineage keeps repeating.

## Risks / Trade-offs

- **[Boot-record write fails / disk full]** → `exitIntent` unwritten ⇒ treated as dirty ⇒
  over-offer. Fails toward the conservative side (never under-offers). Log the write failure.
- **[Two servers sharing one HOME]** → the record is HOME-scoped like the rest of
  `~/.pi/dashboard/`. One dashboard per HOME is an existing invariant; a second instance would
  interleave `bootId`s. The ring makes this survivable (unknown epoch ⇒ allowed) rather than
  silently wrong.
- **[`user-quit` suppresses recovery]** → a user who quits the app with sessions running gets
  no offer on relaunch. Matches Chrome (restore is offered after a *crash*, not a clean quit)
  and preserves 06-30's explicit "never nag about deliberate closes" goal. Reversible: it is
  one row in the D2 table, not a structural choice. See Open Questions.
- **[Electron OS-restart still maps to `user-quit`]** → `before-quit` fires for both a user
  quit and an OS shutdown, so the Electron false-negative is only *partially* fixed by this
  change (fully fixed for the standalone/daemon install via D4). Called out as a follow-up
  rather than silently claimed.
- **[Deferring the broadcast delays a genuine crash offer]** → by `RECOVERY_REATTACH_GRACE_MS`
  (~7 s). Acceptable: the offer is sticky and the alternative is a flashing false card.
- **[`idle` becoming recoverable increases offers]** → an idle-stopped server now offers its
  sessions back. Intended (it is the user's reported false negative); still dismissible and
  still once-per-dirty-boot.

## Migration Plan

None required. The boot record is created on first startup after the upgrade; until then its
absence resolves to `null` ⇒ recovery allowed ⇒ current behaviour. No sidecar schema change,
no protocol change, no config change, no user action. Rollback = revert; a leftover
`boot-state.json` is ignored by older builds.

## Open Questions

- **Should `user-quit` suppress or allow recovery?** D2 picks *suppress* (Chrome model). If the
  product intent is closer to "the dashboard always restores what was running", this flips to
  *allow* and the Electron follow-up below becomes unnecessary. One-row change — worth deciding
  explicitly before implementation.
- **Electron OS-shutdown discrimination** — is there a reliable cross-platform signal
  (Windows `WM_QUERYENDSESSION`, macOS `NSWorkspaceWillPowerOffNotification`) to distinguish
  an OS-initiated quit from a user quit? If yes, Electron records `"signal"` instead of
  `"user-quit"` in that case and the Electron false-negative closes fully.
- **Should `bootId` be a UUID rather than `Date.now()`?** Reusing `liveEpoch` avoids a new
  per-session field, but two boots inside the same millisecond would collide. Practically
  impossible given startup cost; a monotonic counter persisted in the record would remove the
  question entirely.

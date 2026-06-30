## Why

When a user's machine shuts down or crashes while pi sessions are running, those working sessions are silently lost — on next launch the dashboard shows no indication they existed, and the user must hunt through `~/.pi/agent/sessions` and resume each one by hand. We want the dashboard to notice "these sessions were running when the machine went down" and offer to reopen them — while never nagging about sessions the user closed on purpose.

Validation of the existing codebase (5 independent code audits) established that the reopen *action* is already plumbed, but **no durable signal exists today** to distinguish an interrupted session from an intentionally-closed one. This change adds that signal.

## What Changes

- Add an **eager per-session liveness marker**: while a session is running, the server stamps `live: true` (+ a monotonic `liveEpoch`) into the session's `.meta.json` sidecar at turn boundaries — written eagerly, NOT via the existing debounce, because shutdown is precisely when deferred writes are lost.
- Add a durable **`closedReason`** to the manual-close path (`handleShutdown` / `handleForceKill`): an intentional close stamps `{ live: false, closedReason: "manual" }`. A clean server `stop()` stamps `{ live: false }` for each session it tears down.
- On **cold start**, classify each rediscovered session: a sidecar still carrying `live: true` and no `closedReason: "manual"` is an **interrupted-session recovery candidate**.
- **Exempt recovery candidates from the existing cold-start status normalization** (`server.ts` force-rewrites any non-`ended` status to `ended` on restore) so the interrupted signal survives long enough to act on.
- Add a **reopen prompt**: on cold start with ≥1 recovery candidate, the server broadcasts a single recovery offer; the user reopens via the existing `resume_session` flow. Concurrent reopens from multiple devices are deduped by the existing `pendingResumeIntents` registry (last-write-wins).
- Add a **setting** `reopenSessionsAfterShutdown: "off" | "ask" | "auto"` (default `"ask"`) that gates the final step only: `off` = never offer, `ask` = prompt, `auto` = reopen candidates without prompting.
- **Reject** two tempting-but-broken detection mechanisms (documented in design.md): the home-lock "stale lock = dirty boot" detector (unreliable — SIGTERM release handlers exist and will clean the lock once wired), and any reliance on shutdown-time persistence (lost on crash).

## Capabilities

### New Capabilities
- `shutdown-session-recovery`: Detect sessions that were running when the host/server died (vs. cleanly closed), and on cold start offer to reopen them, gated by a user setting. Owns the liveness-marker semantics, the cold-start classification, the recovery-candidate exemption from status normalization, the reopen prompt, and the setting.

### Modified Capabilities
- `meta-json-session-cache`: Add durable optional fields `live`, `liveEpoch`, and `closedReason` to the `.meta.json` sidecar, and add an **eager (non-debounced) write path** for the liveness marker at turn boundaries (existing writes are debounced and flushed only on clean shutdown, which loses the signal on crash).

## Impact

- **Server**: `packages/server/src/browser-handlers/session-action-handler.ts` (manual-close stamps `closedReason`), `packages/server/src/meta-persistence.ts` (eager write path), `packages/server/src/server.ts` (cold-start classification + exempt candidates from the ~line 239-240 force-`ended` normalization), `packages/server/src/session-scanner.ts` (surface new fields), liveness stamping at turn boundaries (event wiring).
- **Shared**: `packages/shared/src/session-meta.ts` (`SessionMeta` gains `live`/`liveEpoch`/`closedReason`); recovery-offer + setting types in the browser/server protocol.
- **Client**: reopen-prompt UI; new entry in the settings panel for `reopenSessionsAfterShutdown`.
- **No dependency on** the home-lock (`home-lock.ts` / `home-lock-release.ts`) — explicitly avoided per validation.
- **Backward compatible**: all new sidecar fields are optional; sessions without them behave exactly as today.

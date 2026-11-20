## Why

Three reports share one symptom — **a live pi session never appears in the dashboard** — and one
path: bridge init → `session_register` delivery → server spawn watchdog.

- [#1175](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1175) — after `/resume`
  (and `/new`, `/fork`) pi tears down the extension runtime and loads a **fresh `ExtensionAPI`**.
  `releaseBridgeOwnerOnShutdown` only clears `prev.pi` for `reason === "reload"`
  (`packages/extension/src/terminal-reload.ts:296-298`), so `isBridgeReentry`
  (`terminal-reload.ts:286-288`) sees `prev.generation > 0 && prev.pi !== pi` and `initBridge`
  returns early (`packages/extension/src/bridge.ts:181`). The outgoing session unregisters
  (`bridge-handlers/lifecycle.ts:1017-1043`), the replacement never registers. pi's own type
  confirms the reason set: `"quit" | "reload" | "new" | "resume" | "fork"`
  (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:658`). **CONFIRMED.**
- [#1127](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1127) — while the WS is not
  OPEN, every frame goes through one FIFO ring of `maxBufferSize` (default 10 000)
  (`packages/extension/src/connection.ts:487,596-602,721-724`); on overflow `buffer.shift()` evicts the
  **oldest** frame. `session_register` is sent first (`session-sync.ts:154-189`) and the history replay
  after it, one `send` per event (`session-sync.ts:238-258`, `handleSessionChange` `:298,327`), so a
  large branch evicts the register itself. When the WS is already open nothing is buffered
  (`connection.ts:589-594`), so this only bites a session that starts before the socket connects
  (every spawn). The eviction log is throttled to one line per 5 s naming only the *first* dropped type
  (`connection.ts:614,734-740`). **CONFIRMED** (mechanism verified in code; the 76 MB repro itself not run).
- [#1128](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1128) — on timeout the
  watchdog always reclaims (kills) the spawn (`spawn-register-watchdog.ts:316`,
  `_reclaimSpawn` `:338-352`) while Settings says "before showing a warning"
  (`packages/client/src/components/settings/SettingsPanel.tsx:2330`; `settings-panel` spec "Settings
  panel exposes spawn-register timeout") and the banner says only "never connected"
  (`SpawnErrorBanner.tsx:119-120`). The failure record carries no sign that a process was killed
  (`spawn-register-watchdog.ts:297-312`, `SpawnFailureEntry` `spawn-failure-log.ts:22-39`). **CONFIRMED.**
  Issue fixes #3 (size-proportional window) and #4 (attach bridge drop counters) are **not adopted**:
  #3 is moot once #1127 stops eviction; #4 is not feasible — the counters ride the session heartbeat
  (`lifecycle.ts:911-912`) and a never-registered session has none, so the server cannot see them.
  Fix #2's "skip reclaim while data flows" contradicts the existing spec ("the watchdog SHALL NOT
  change reclaim behaviour to make recovery more likely", `spawn-register-watchdog` spec) and is
  left out; honest wording and reporting is the fix.

## What Changes

- **#1175** — `releaseBridgeOwnerOnShutdown` releases ownership for every reason except `"quit"`
  (`reload`, `new`, `resume`, `fork`). A different pi that loads while the owner has **not** shut down
  (a subagent never receives the parent's `session_shutdown`) is still rejected.
- **#1127** — `ConnectionManager` send buffer keeps **control frames** (`session_register`,
  `session_unregister`, `replay_complete`, `commands_list`, `models_list`, `providers_list`) when it
  overflows: only non-control frames are evicted, oldest first; control frames are themselves bounded
  (256) and flush in original order. Overflow is reported **aggregated by type** (counts per type,
  control frames kept) instead of one first-type line.
- **#1128** — Settings hint says the spawn is terminated; the timeout banner, the
  `spawn_register_timeout` message and the `REGISTER_TIMEOUT` failure record say whether the watchdog
  terminated a process (`terminated` + pids). Reclaim behaviour is unchanged.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `bridge-extension` — ADDED: bridge ownership is released on every session-replacing shutdown (#1175).
- `incremental-event-sync` — MODIFIED `Drop-site delivery instrumentation`; ADDED
  `Bridge send buffer never evicts control frames` (#1127).
- `spawn-register-watchdog` — ADDED: fire reports whether it terminated the spawn (#1128).
- `spawn-error-persistence` — ADDED: timeout banner states termination (#1128).
- `settings-panel` — MODIFIED `Settings panel exposes spawn-register timeout`: helper text states
  termination (#1128).

## Non-goals

- Exposing `maxBufferSize` in config, batching replay frames, or sizing the buffer from the branch
  length (#1127 fixes #2) — see design.md; follow-up if pinning is not enough.
- Deferring replay until the socket opens (see design.md alternative D).
- Conditional / size-proportional reclaim, longer default timeout (#1128 fixes #2/#3).
- Server-side claim/origin rules — owned by `harden-bridge-session-claim`.

## Relationship

- **Active `harden-bridge-session-claim`** — touches the *server* claim path
  (`pi/bridge-contention.ts`, `pi-gateway.ts` register/first-frame/move-commit, origin binding) and
  its spec `bridge-connection-contention`. This change touches no server claim code: #1175 is
  extension-side init, #1127 is extension-side buffering, #1128 is the watchdog + copy. No requirement
  overlaps; the only meeting point is that a register that is no longer evicted (#1127) is judged by
  its decider, and that a replacement bridge (#1175) registers a **new** session id from a new socket,
  so its origin rules apply as for any fresh register. Separate change; no fold (different packages,
  different risk). `harden-bridge-session-claim` is unstarted/unarchived — merge order is free.
- **Archived** `fix-terminal-session-dashboard-reload` (D4, 2026-09-26) introduced the `reload`-only
  release this change generalises; `fix-large-session-resume-replay` added the per-event `replay:true`
  frames that make the flood; `fix-stuck-tool-card-on-dropped-event` added the drop counter/warning
  this change extends. None fixed these issues.

## Discipline Skills

- `review-code` — non-trivial change; tests pass before commit.
- `performance-optimization` — send-buffer eviction runs on a 10 000-frame flood; must stay O(1) amortised per frame (design.md D2).
- `doubt-driven-review` — widening the re-entry release (#1175) is a security-adjacent guard (subagent must not take over its parent's bridge); check before it stands.
- `observability-instrumentation` — aggregated overflow report (#1127) and `terminated` evidence on `REGISTER_TIMEOUT` (#1128).

## Impact

- Code: `packages/extension/src/terminal-reload.ts`, `packages/extension/src/connection.ts`,
  `packages/server/src/spawn-process/spawn-register-watchdog.ts`,
  `packages/server/src/spawn-process/spawn-failure-log.ts`, `packages/shared/src/browser-protocol.ts`
  (`SpawnRegisterTimeoutMessage`), `packages/client/src/components/settings/SettingsPanel.tsx`,
  `packages/client/src/components/session/SpawnErrorBanner.tsx`,
  `packages/client/src/lib/i18n-en-source.json`, `i18n/i18n-hu.ts`, `i18n/i18n-zh-CN.ts`.
- Compatibility: protocol additions are optional fields (`terminated?`, `terminatedPids?`); an old
  client ignores them, an old server omits them (client falls back to the current label). Failure-log
  entries gain optional fields. No migration, no config change, no wire-frame change.
- Rollback: revert; nothing persisted depends on the new fields.
- Rebuild: extension → `npm run reload`; server/shared → `restart-server.ts`; client → `npm run build` + restart.

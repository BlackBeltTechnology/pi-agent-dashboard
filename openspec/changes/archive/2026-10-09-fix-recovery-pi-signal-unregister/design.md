## Context

See proposal.md (Why) for the field evidence. Current mechanics this design builds on:

- Cold-start classification loops `scanResult.sessions` (`DashboardSession`s built by
  `sessionFromMeta`, `packages/server/src/session/session-scanner.ts:138-189`, liveness mirror
  `:278-280`), resolves the
  owning boot's intent from `session.liveEpoch`, and collects candidates where
  `isRecoveryCandidate(...) && isRecoveryAllowed(ownerIntent)` —
  `packages/server/src/server.ts:698-736`.
- `isRecoveryCandidate` = `live === true && status !== "ended" && closedReason !== "manual" &&
  recover !== false`; `recover:false` is the generic plugin opt-out (automation/goal) —
  `packages/shared/src/session-meta.ts:274-288` (predicate body `:281-288`).
- The boot id is the server's `liveEpoch = Date.now()` — `packages/server/src/server.ts:652`.
  Sessions are stamped `{ live:true, liveEpoch }` once per activation on the first activity
  event — `packages/server/src/event-wiring.ts:1186-1195`; the guard resets on every
  `session_register` — `event-wiring.ts:1491-1501`.
- Every session end (both seams) eagerly writes `{ live:false, closedReason: reason ??
  "unknown" }` — `packages/server/src/event-wiring.ts:602-621`. That includes a relocation
  (`session_moved` → `status:"ended"` + in-memory `movedTo`, `event-wiring.ts:2021-2027`);
  `movedTo` is not persisted (`packages/server/src/session/session-to-meta.ts`).
- `setLiveness` clears any liveness field omitted from its payload, so the end write DELETES
  `liveEpoch` — `packages/server/src/persistence/meta-persistence.ts:111-131`. The debounced
  full overwrite preserves `live/liveEpoch/closedReason` only via the read-back in
  `writeNow` (`meta-persistence.ts:76-80`) because `sessionToMeta` enumerates none of them;
  it preserves `endedAt` because `sessionToMeta` does enumerate it.
- `unregister()` sets `endedAt` before firing `onEnded`: `Date.now()` for a witnessed end,
  `derive(session)` (last activity → transcript mtime → `startedAt`, never "now") for an
  inferred one (`witnessed:false`: heartbeat / reconnect-grace expiry) —
  `packages/server/src/session/memory-session-manager.ts:455-491`,
  `packages/server/src/session/derive-ended-at.ts`. Register resets `endedAt` —
  `memory-session-manager.ts:407`.
- A bridge `session_unregister` calls `sessionManager.unregister(id)` with no reason —
  `packages/server/src/pi/pi-gateway.ts:924-926` — so it lands as `closedReason:"unknown"`.
  The bridge sends it from every `session_shutdown` — `packages/extension/src/bridge.ts:
  4091-4120`; pi passes `reason:"quit"` for both `/quit` and SIGTERM/SIGHUP (pi
  `core/agent-session-runtime.js` `dispose()`; `modes/interactive/interactive-mode.js`
  `registerSignalHandlers`, SIGHUP only on non-win32).
- Boot record: `stampBootStart` pushes the previous boot to `ring[0]` —
  `packages/server/src/persistence/boot-state.ts:78-87`; `recordExitIntent` writes
  `{ bootId, exitIntent, at: Date.now() }` write-once — `boot-state.ts:94-107`;
  `resolveExitIntent(liveEpoch)` returns only the intent — `boot-state.ts:114-120`.
- Exit-intent writers: SIGTERM/SIGINT → `"signal"` (`packages/server/src/cli.ts:336-345`; no
  SIGHUP handler); `/api/shutdown {userQuit:true}` (Electron quit) → `"user-quit"`, else
  `"shutdown"`, then `process.exit` without touching pi
  (`packages/server/src/routes/system-routes.ts:1298-1322`); `stop()` →
  `browserGateway.shutdownHeadlessProcesses()` then `"idle"`/`"ephemeral"`
  (`packages/server/src/server.ts:4214-4259`), and does not clear per-session markers.
- Offer consumption (dismiss / retract / broadcast) writes `{ live:false }` —
  `packages/server/src/server.ts:1306`, `:4163`, `packages/server/src/pairing/browser-gateway.ts:2230`.
  The `auto` branch does not consume (`server.ts:4176-4210`).

## Goals / Non-Goals

**Goals:**
- A host shutdown/reboot that lets pi exit gracefully before the dashboard is signalled
  offers those sessions (standalone server → `signal`; Electron → `user-quit`).
- Zero change to restart/quit pick-up: sessions whose pi survives keep `live:true` and never
  enter the new path.
- One-shot in every mode (`ask`, `auto`, `off`), independent of boot-ring ordering.

**Non-Goals:**
- No bridge/pi/protocol/client/Electron change; no signal listener inside pi.
- No new server signal handlers (SIGHUP was considered and dropped: it would override an
  inherited `nohup` ignore and bypass the instance-coordination lock-release contract).
- Not covering `idle` (`autoShutdown` defaults off, `shutdownIdleSeconds: 300`,
  `packages/shared/src/config.ts:1286-1287`; the stop only fires at 0 connections, so an
  in-window session would be one the user just quit).
- Not distinguishing a deliberate `/quit` or `/new` < 60 s before shutdown (accepted false
  positive; in `auto` mode it is resumed — user decision).
- Not fixing pre-existing gaps of the `live:true` path (a slow-reattaching survivor under
  `user-quit`, `auto` spawn-failure re-offer, overlapping instances rewriting `bootId`).

## Decisions

### D1 — Infer "died with the host" server-side from timing, not from a bridge signal flag

Alternatives: (a) bridge adds a SIGTERM/SIGHUP listener to tag `session_unregister` with
`cause:"signal"`; (b) bridge skips unregister on signal; (c) server re-marks recently
unregistered sessions live inside its own SIGTERM handler.
Rejected (a): a listener in the bridge changes Node's default-termination semantics for the
whole pi process and couples us to pi's private signal ordering (`signal-exit` re-send logic in
`interactive-mode.js`), across interactive, print and RPC modes we do not own. Rejected (b):
turns a closed terminal tab into a crash and relies on heartbeat expiry. Rejected (c): racy —
unregisters land ~23 s before the server's SIGTERM, and the server may die mid-handler.
Chosen: persist end evidence durably (D2), decide at cold start against the boot record (D3).

### D2 — Shutdown evidence is written only for an explicit bridge unregister

The only seam a graceful pi exit reaches is the bridge's `session_unregister` handler
(`packages/server/src/pi/pi-gateway.ts:924-926`). It is NOT exclusive to pi exiting: the bridge
sends the same message on every `session_shutdown` reason — quit, reload, and session
replacement `new`/`resume`/`fork` (`packages/extension/src/bridge.ts:4110-4119`,
`packages/extension/src/session-sync.ts:246`) — and the server cannot see the reason without a
protocol change (out of scope). Those replacements are accepted false positives (Risks).
Every other `unregister()` caller is not a pi exit: same-tick history register/unregister (`witnessed:false`:
`browser-handlers/directory-handler.ts:73`, `event-wiring.ts:1900`, `event-wiring.ts:2609`),
placeholder/ghost cleanup (`pi-gateway.ts:849`, `event-wiring.ts:1596`), finalize-on-close
(`pi-gateway.ts:1005`), heartbeat/grace expiry (`pi-gateway.ts:274-386`), manual close.
`UnregisterOptions` (`memory-session-manager.ts:63-73`) gains `endSource?: "bridge_unregister"`;
the gateway passes it. The manager records it in a manager-PRIVATE set keyed by session id
(NOT a `DashboardSession` field, so it never reaches the shared type or broadcasts), written
inside `unregister()` before `mgr.onEnded?.()` fires (`memory-session-manager.ts:491`) and
cleared by `register()`; exposed as `wasEndedByBridgeUnregister(id)`.
`onEnded`'s eager write (`event-wiring.ts:602-621`) adds `{ liveEpoch: <current boot>,
endedAt: session.endedAt }` iff `wasEndedByBridgeUnregister(id)`, `session.closedReason ===
"unknown"` and `session.movedTo === undefined` (defensive: a relocation never passes through the
bridge-unregister seam today); otherwise it is exactly today's `{ live:false, closedReason }`.
A later `reasonChanged` re-fire of `onEnded` in the same boot either rewrites the same evidence
(reason still `unknown`) or drops it (reason refined) — never a later epoch, because a restored
record from an earlier boot is never in the set. `liveEpoch` and `endedAt` are always written
together in one atomic write, so a `live:false` sidecar with `liveEpoch` always has a persisted
`endedAt` (the scanner's derived fallback, `session-scanner.ts:189`, never applies to it).

**Dashboard Stop race.** `shutdownSession` writes `closedReason:"manual"` to disk only, then
signals pi (`packages/server/src/browser-handlers/session-action-handler.ts:957-965`); pi's
bridge unregister then ends the in-memory session as `unknown` and the end write overwrites the
disk reason. `shutdownSession` and `handleForceKill` (`:1236-1240`) therefore also stamp
`closedReason:"manual"` on the in-memory session BEFORE signalling, so `unregister()` keeps it
(`memory-session-manager.ts:466-468`) and no evidence is written.
`setLiveness` accepts an optional `endedAt`: written when present; when absent, the value in the
write's base (pending debounced snapshot if any, else disk — `meta-persistence.ts:119`) is
kept. A comment names the `writeNow` read-back (`meta-persistence.ts:74-82`) that preserves
`liveEpoch` through debounced overwrites; a regression test pins it.
`liveEpoch` on a `live:false` sidecar now means "boot in which the session ended";
the meta-json delta records that definition.

### D3 — Window predicate

New pure `isShutdownWindowCandidate(s, ownerBoot, windowMs)` beside `isRecoveryCandidate` in
`packages/shared/src/session-meta.ts`, taking `{ live, liveEpoch, endedAt, closedReason,
recover }` (satisfied by `SessionMeta` and `DashboardSession`). True iff:

- `live !== true`, `liveEpoch` and `endedAt` defined;
- `closedReason === "unknown"` (an allowlist: of today's vocabulary `manual | process_gone |
  spawn_failed | unknown`, `packages/shared/src/types.ts:74`, only `unknown` can follow an
  explicit unregister; a future value is excluded until reviewed), `recover !== false` (the
  generic plugin opt-out; no `kind` check — `detach-automation-goal-from-core`,
  `packages/shared/src/__tests__/recovery-candidate.test.ts:57-68`);
- `ownerBoot` defined, `ownerBoot.exitIntent ∈ {signal, user-quit}`;
- `|endedAt − ownerBoot.at| ≤ windowMs`.

No `status` conjunct — the debounced `status:"ended"` may be lost (observed). The server
evaluates it on the scanned session BEFORE the loop normalizes `endedAt`
(`server.ts:730-735` would otherwise synthesize one).
Absolute difference: under `user-quit` the server records `at`, then awaits `deleteTunnel`
before exiting (`system-routes.ts:1311-1322`); an unregister can land after `at`.
Intent allowlist: `signal`, `user-quit`. Everything else — `restart`, `shutdown`, `ephemeral`,
`idle`, unrecorded — never qualifies through this path.
`RECOVERY_SHUTDOWN_WINDOW_MS = 60_000` in `packages/shared/src/recovery-timing.ts` (module
header extended: it now also owns the shutdown window, unrelated to the quiesce/grace pair).
Measured gap on macOS 2026-10-09: 22.9–23.1 s.

### D4 — Owner-boot lookup across the ring

Add `resolveExitRecord(bootId)` in `packages/server/src/persistence/boot-state.ts`, returning
the matching current-or-ring entry `{ bootId, exitIntent, at }` from the same `cached ??
readBootState()` source as `resolveExitIntent` (`boot-state.ts:114-120`), or `undefined`.
No dependency on `ring[0]` position, so a replacement boot that crashed during startup does not
hide the shutdown boot.

### D5 — One-shot by consuming evidence at classification

When the cold-start loop classifies a session as a shutdown-window candidate, it immediately
writes `setLiveness(file, { live:false, closedReason })` — dropping `liveEpoch` — in every
mode, after copying what the offer/resume needs into the in-memory candidate. In `off` mode the
evidence is consumed without collecting the candidate. A later boot cannot re-qualify the
session; a toggle from `off` to `ask` cannot surface an old shutdown.
Trade-offs: if the boot that classified it dies before offering, the candidate is lost; in
`auto` mode a failed respawn is not retried on the next boot (the `live:true` path's
non-consuming `auto` branch, `server.ts:4176-4210`, would retry) — accepted for one-shot.

### D6 — Window candidates join the existing pipeline

In the cold-start loop, `candidate = (diskCandidate ∧ allowed) ∨ windowCandidate` (window
gated by `recoveryMode !== "off"` for collection). Window candidates get
`recoveryCandidate = true` and enter `recoveryCandidates`, so keeper reclaim, bridge-reattach
retract, grace window, ask/auto (auto-resumes them — user decision), dismiss and resume-time
"already alive" refusal apply unchanged. New log line:
`[recovery] <id>: shutdown-window (ended <Δ>s from boot <id> exit via <intent>)`.

### Platform matrix (expected after this change)

| Host shutdown | pi exit | server intent | Path that offers |
|---|---|---|---|
| macOS / Linux, standalone server (daemon) | graceful (SIGTERM/SIGHUP) → unregister | `signal` | window (new) |
| macOS / Linux, Electron | graceful → unregister | `user-quit` | window (new) |
| Windows, standalone | hard kill (no SIGTERM delivery; no SIGHUP handler on win32) | `null` | `live:true` (existing) |
| Windows, Electron | hard kill | `user-quit` or `null` | `live:true` (existing) |
| Power loss, any | none | `null` | `live:true` (existing) |
Windows rows are unverified in the field; manual QA per the scenario manifest.

## Risks / Trade-offs

- [A session ended by `/quit`, `/reload`, or replaced by `/new` `/resume` `/fork` < 60 s before a
  PC shutdown or Electron quit is offered, or auto-resumed in `auto` mode — even though the pi
  process itself survived a replacement] → accepted (user decision; no protocol change);
  dashboard Stop and force-kill (`manual`) never qualify.
- [pi unregisters, then the server is SIGKILLed / loses power before its SIGTERM handler
  records `signal`] → intent `null`, session `live:false` → not offered. Documented limitation.
- [Server hosted in a terminal receives SIGHUP on logout] → dies unrecorded (`null`) → not
  offered. Documented; daemonized/Electron servers are unaffected.
- [The boot that classified a window candidate dies before offering] → lost (D5).
- [macOS shutdown spacing > 60 s] → missed as today; Δ logged for tuning.
- [Old sidecars have no `liveEpoch` on `live:false`] → never window candidates (no retroactive
  offers).

## Migration Plan

Additive sidecar fields; no data migration. Rollback = revert; extra `liveEpoch`/`endedAt` on
ended sidecars are ignored by the old classifier (`live:false` fails `isRecoveryCandidate`).

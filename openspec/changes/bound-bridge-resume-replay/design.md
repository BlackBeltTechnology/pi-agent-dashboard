# Design — Bound Bridge Resume Replay

## Context

Live server evidence (running instance, `~/.pi/dashboard/server.log`):

- `grep -c 'dropped frame (back-pressure)'` → 236 lines; `total dropped=2097`; peak `seq=143132`; `bufferedAmount` up to `6936566` vs `MAX_WS_BUFFER=4194304`.
- `[hydration] slow load: 5539ms (session=019f7dfd… bytes=10411122)`.
- Real session files: `107 MB`, `92 MB`, `92 MB`, `49 MB` (`~/.pi/agent/sessions`).

The drop is the user-visible "stuck": `browser-gateway.ts` `sendTo`/`fanout` silently discard frames once `ws.bufferedAmount > MAX_WS_BUFFER`. On a resume, the flood originates from the bridge's unbounded `replaySessionEntries()` combined with the server re-fanning each replayed entry to the subscribing browser.

## Goals / Non-Goals

**Goals**
- Resume of a large session renders the recent tail promptly, with zero back-pressure drops.
- Same-id resume of an unchanged transcript reuses the loaded store (no wipe-and-refill).
- Reconnect (transient WS drop) remains correct and cheap.

**Non-Goals**
- Changing pi's own on-disk hydration cost (`pi --session` parse time) — that lives in pi-coding-agent, not the dashboard.
- Re-architecting the server subscribe path — `tail-first-session-loading` already bounded it; this change reuses its window/`load_older` machinery.
- Persisting older paginated pages (unchanged from `tail-first-session-loading`).

## Decisions

### D1. Bridge replays a bounded tail, not the full branch
`replaySessionEntries()` selects the last N entries (same budget concept as server `TAIL_WINDOW_EVENTS`) and sends them in yielding batches (`setImmediate` between chunks) so the bridge event loop and the WS buffer never saturate. The bridge already computes `eventCount` for the register message — it reuses `getBranch()` length for window selection. Older history is served by the existing server-side `load_older` from the on-disk/in-memory buffer; the bridge does not eagerly resend it.

### D2. Replayed history is not re-fanned-out as live frames
On a same-id resume, the server inserts replayed entries into the event store but does not broadcast each as a live `event` to the subscribing browser (that is the overflow source). The browser gets the bounded tail through the normal subscribe → `event_replay` window, which is already batched + back-pressure-aware and drives the client refold. `replay_complete` still terminates the cycle.

### D3. `canSkipWipe` tolerates pi setup-entry drift
Today `canSkipWipe` requires `msg.eventCount === lastEntryCount` exactly. pi auto-appends `model_change` / `thinking_level_change` setup entries on session start, so a genuine resume of an unchanged transcript reports a slightly different count and needlessly triggers `deleteEventsForSession` + `broadcastSessionStateReset` + full refill. Relax to: skip the wipe when the stored tail is a prefix-consistent subset of the bridge's reported branch (count within a bounded setup-entry delta AND store already has events). Correctness guard: never skip when the delta exceeds the bound or the store is empty.

### D4. Dropped-frame signal drives a bounded client re-subscribe (optional, additive)
`browser-gateway.ts` already tracks `droppedFramesBySession`. When a session crosses a small threshold, emit a structured notice; the client responds with a bounded re-subscribe (tail window) instead of sitting on a truncated transcript. This is a safety net, not the primary fix — D1+D2 should make drops not happen at all.

## Risks / Trade-offs

- **R1. Skipping the wipe could show a stale/short transcript.** Mitigation: D3's bound + "store non-empty" guard; a mismatch beyond the setup-entry delta still wipes. Covered by a resume-after-new-turns scenario.
- **R2. Bounded bridge replay could drop entries the client needs.** Mitigation: server `load_older` backfills on scroll (already shipped); the bridge tail matches the server tail budget so the union is complete.
- **R3. Reconnect vs resume conflation.** The bridge tags `registerReason` (`spawn` vs `reattach`); the bounded-replay path applies to both, but the wipe-skip (D3) already keys on `eventCount` and only fires when the store has events — a fresh reconnect with an empty store still full-loads.

## Migration / Rollout

Pure behavioral change; no persisted-schema migration. Bridge change requires `npm run reload`; server change requires restart. Verify against a >90 MB fixture session with the dropped-frame counter asserted at zero.

## Context

Target scenario: the user's PC shuts down (or crashes / loses power) while one or more pi sessions are running. On next dashboard launch we want to offer to reopen exactly those interrupted sessions — and never prompt about sessions the user closed deliberately.

Five independent read-only code audits established the ground truth this design rests on:

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | `resume_session` + `pendingResumeIntents` plumbing exists; reopening is free; dedup = last-write-wins | **TRUE** | `session-action-handler.ts:268,318,330`; `pending-resume-intent-registry.ts:41-42,81-86` |
| 2 | `stop()` calls `removePid()` + `metaPersistence.flushAll()` + `piGateway.stop()`; flush writes status as-is | **TRUE** | `server.ts:1671,1677,1685`; `meta-persistence.ts:45-48,84-88` |
| 3 | Manual close stamps a durable `closedReason` to `.meta.json` | **FALSE** | No such field anywhere; `handleShutdown` only `sessionManager.update({status:"ended"})` in memory (`session-action-handler.ts:652,677`; `memory-session-manager.ts:163-169`) |
| 4 | No SIGTERM handler ⇒ PC shutdown leaves a stale home-lock ("dirty boot" detector) | **PARTIAL / FRAGILE** | Handlers EXIST + release lock & unlink sidecar (`home-lock-release.ts:48-62`, `home-lock.ts:231-233`) but are NOT wired into `cli.ts` startup yet (archived `single-dashboard-per-home`). Detector works today only by accident; breaks when wiring lands. |
| 5 | Cold-start scanner can read `meta.status` to find interrupted sessions | **PARTIAL → effectively FALSE** | `session-meta.ts:23` has optional `status`, but `server.ts:239-240` force-rewrites any non-`ended` status to `ended` on restore — erasing the signal |

**Net:** the reopen *action* is free (claim 1); every *detection* channel I first reached for is closed (claims 3, 4, 5). The feature is viable but needs a new durable-signal path, not a free ride.

## Goals / Non-Goals

**Goals:**
- Distinguish "running when host died" from "intentionally closed" using a signal that survives a crash.
- Offer reopen on cold start for interrupted sessions only; reuse the existing resume flow.
- Behave correctly across multiple connected devices (no double-spawn, no per-device prompts diverging).
- Gate behaviour with one setting: `off | ask | auto`.
- Stay backward-compatible: all new sidecar fields optional.

**Non-Goals:**
- Re-attaching to still-alive orphaned pi processes (out of scope; the target is whole-machine shutdown where nothing survives).
- Inventing per-device identity (none exists today; the recovery decision is a server-global fact).
- Recovering sessions closed by the idle auto-shutdown timer — that runs a clean `stop()` and is treated as intentional.
- A time-window filter on recovery candidates (recover all from the dead run; user dismisses what they don't want).

## Decisions

### D1 — Detect ABSENCE of liveness, stamped EAGERLY while running (not at shutdown)

Shutdown is exactly when we cannot trust code to run, so the signal must already be on disk *before* the machine dies. While a session runs, stamp its `.meta.json` with `{ live: true, liveEpoch: <server-boot-id> }` at turn boundaries.

```text
running session   → eager write { live:true, liveEpoch }
manual close      → write { live:false, closedReason:"manual" }   (claim 3 gap → fix)
clean stop()      → write { live:false } per torn-down session
crash / PC down   → marker NEVER updated → still { live:true } next boot
```

Cold-start classification:
```text
meta.live === true  AND  status !== "ended"  AND  closedReason !== "manual"   →  recovery candidate
```
A crash cannot lie (it leaves the stale `live:true`); a clean exit can truthfully clear it.

### D2 — Eager write path, bypassing the existing debounce

`meta-persistence` writes are debounced and only force-flushed on clean shutdown (claim 2). A debounced `live` marker would be lost on crash — defeating the purpose. The liveness stamp uses an immediate atomic write (the existing tmp+rename primitive), separate from the debounced field writes.

### D3 — Exempt recovery candidates from the cold-start status normalization

`server.ts:239-240` force-rewrites any restored non-`ended` status to `ended`. Recovery candidates (per D1) must skip this rewrite so the interrupted state is actionable. Non-candidates keep today's behaviour exactly.

### D4 — Recovery decision is server-global; prompt is an idempotent broadcast

No device identity exists; the server is the single source of truth (one server per HOME). The "these N sessions are recoverable" decision is made once, at server cold start. The prompt is broadcast to all attached clients. Concurrent "reopen all" from two devices is deduped by the existing `pendingResumeIntents` (last-write-wins, claim 1) — no double-spawn, no new identity machinery.

### D4a — Prompt presentation: sticky top-right notification, not a modal

The `ask`-mode offer reuses the dashboard's existing top-right notification stack (`Toast.tsx` / `SpawnErrorToastHost`: `fixed top-4 right-4 gap-2`) rather than introducing a new surface. It queues with other notifications (grouped, spaced) and stays non-blocking. Two deltas from an ordinary toast:
- **Sticky**: no auto-timeout (ordinary toasts self-dismiss ~3s). A recovery offer must not silently vanish.
- **Inline action**: one primary "Reopen" action + non-destructive dismiss.
The card is calm/neutral with a small amber attention dot — an interrupted session is recoverable, not an error (no red). Copy is minimal ("Reopen N sessions?"). REJECTED: center modal + scrim (blocks the dashboard; disappears-on-resume feels like data loss) and full-width edge banner (too heavy for a recoverable, dismissible offer). Mock: `mocks/recovery-prompt.html`.

### D4b — Auto-dismiss on resume; once per dirty boot

If the user opens/resumes ANY session before acting on the offer, the offer has served its purpose → the client dismisses it silently (no nag). The offer is shown once per dirty boot; an explicit dismiss or a resume does not bring it back until the next unclean shutdown.

### D5 — The setting gates only the final step

`reopenSessionsAfterShutdown: "off" | "ask" | "auto"`, default `"ask"`.
- `off` — classify but never surface.
- `ask` — broadcast the reopen prompt.
- `auto` — server resumes all candidates immediately, no prompt.

### D6 — REJECTED: home-lock "stale lock = dirty boot" detector

Tempting because a stale lock implies an unclean exit. Rejected on claim 4: the SIGINT/SIGTERM/SIGHUP/SIGBREAK release handlers already exist and *delete the sidecar + release the lock*; they are merely un-wired today. The moment `single-dashboard-per-home` wires `installReleaseHandlers()` into `cli.ts`, a graceful PC-shutdown SIGTERM releases the lock cleanly and the detector silently breaks (PC shutdown becomes indistinguishable from a clean quit). Building on an un-wired bug scheduled for repair is unacceptable. The per-session liveness marker (D1) is independent of the lock.

### D7 — REJECTED: rely on shutdown-time persistence to mark interrupted sessions

Any "on the way down, mark running sessions as interrupted" logic cannot run on crash / power loss / SIGKILL — the exact cases we must catch. Hence the eager-while-running stamp (D1/D2) instead.

## Risks / Trade-offs

- **Write amplification**: an eager atomic write per turn boundary per session adds I/O. Mitigation: stamp `live:true` once per session activation (not every event); refresh `liveEpoch` only on boot-id change, not per turn.
- **Claim 2 vs 5 tension**: audits lightly disagree on whether live status is persisted at flush time. Moot for this design — D3 makes recovery depend on the explicit `live` marker, not on `status`, and the `239-240` exemption is scoped to candidates only.
- **Stale `live:true` from a pre-feature crash**: sessions that crashed before this feature shipped have no `live` field → not candidates (correct; optional fields default to absent).
- **Clean-close-then-shutdown race (bounded false-positive)**: a normal pi TUI quit clears the interrupted signal only when `unregister()` persists `status:"ended"` — which is DEBOUNCED 1 s (`meta-persistence.ts` `DEBOUNCE_MS`), and may itself wait out the heartbeat grace window (tens of seconds, `pi-gateway.ts`) when the bridge sends no explicit `session_unregister`. If the host powers off inside that window, the sidecar still reads `{ live:true, status:non-ended }` → a false recovery candidate. Same 1 s hole if the server is SIGKILLed within a debounce of any `unregister()`. Bounded and self-correcting (the offer is dismissible; a later clean run clears it); not worth an eager status write on every close. `unregister()` deliberately does NOT clear `live` — the `status:"ended"` half of `isRecoveryCandidate` is what excludes these once the debounced write lands.
- **Resume-after-manual-close in the same server run**: the once-per-activation stamp guard (`stampedLiveEpoch`, `event-wiring.ts`) is reset on every `session_register` so a resumed session re-stamps `{ live:true, liveEpoch }` on its next activity — otherwise the guard (same epoch, same sessionId via `pi --continue`) would suppress the re-stamp and `setLiveness`'s `closedReason` clear would be unreachable, wrongly excluding a resumed-then-crashed session. See D1.
- **`auto` mode surprise**: reopening many sessions unprompted could spike resource use. Mitigation: default is `ask`; `auto` is opt-in.
- **liveEpoch correctness**: requires a stable per-boot server id. If absent, fall back to treating any `live:true` as a candidate (conservative — may over-offer, never under-offers).
- **Idle-shutdown classification**: treated as intentional (clean `stop()` clears `live`). If users expect idle-killed sessions to be recoverable, that is a deliberate non-goal here and a follow-up.

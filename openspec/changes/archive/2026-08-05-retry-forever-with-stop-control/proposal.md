## Why

A provider failure currently dies after pi's three internal attempts, and the dashboard
cannot see or steer any of it. Every claim below was verified empirically against the pi we
actually ship (0.81.1) in a sandboxed lab — see `design.md` § Evidence.

1. **Retrying is not survivable.** pi's untouched defaults (`retry.maxRetries: 3`,
   `retry.baseDelayMs: 2000`) give three attempts at 2/4/8 s — a turn dies ~14 s after the
   first failure. A five-hour quota reset, exactly the case a user wants to sleep through,
   is unreachable. Neither `~/.pi/agent/settings.json` nor `.pi/settings.json` carries a
   `retry` block today, so this is the live behavior for every session.
2. **The retry surface is dead code — it emits nothing at all.** pi no longer keeps a retry
   chain inside one agent turn: **every attempt is a full `agent_start` … `agent_end` cycle**,
   with a single `agent_settled` at the very end. `RetryTracker.observeAgentEnd` deletes the
   pending failure on *every* `agent_end`, so the following `message_start` never sees one.
   Replaying pi's real event order through the shipped tracker yields **zero**
   `auto_retry_start` events. Users see N consecutive settled error banners, never a retry
   sub-line. This is a live production defect, not merely the `-1` sentinel problem the
   surface was designed around; it is fixed here as part of §2.
3. **There is no way to stop retrying.** `SessionBanner` was reduced to dismiss + Copy; its
   abort control renders only during an observed in-flight instant that (per defect 2) never
   occurs, and dismiss clears local state while pi keeps retrying underneath.

## What Changes

- **pi owns the retry loop; the dashboard configures and renders it.** A new Retry section in
  dashboard settings writes pi's own `retry` block to `~/.pi/agent/settings.json`. Raising
  `retry.maxRetries` is the entire mechanism for "keep trying" — verified: `maxRetries` has no
  clamp, and a run with `maxRetries: 8` produced 9 attempts spaced exactly `base · 2^(n-1)`.
- **No dashboard-owned retry loop.** The dashboard never re-drives a turn. This is not a
  simplification of a working design — it is forced: `resume mode:"continue"` is refused for a
  live session (`resume.already_active`) and merely reopens an ended one idle, and no bridge
  command to continue a turn exists. Since pi never settles the turn while its budget remains,
  nothing needs re-driving.
- **The waiting between attempts becomes visible.** The bridge is corrected to pi's real event
  shape: an error `agent_end` means "attempt over, another coming" and emits a waiting signal
  carrying the attempt number and the real delay; `agent_settled` is the single terminal
  signal that closes the chain. `maxAttempts` / `delayMs` are sourced read-only from pi's
  retry settings, retiring the `-1` sentinels.
- **Settings apply immediately.** pi reads its settings at session construction, so a file
  write alone changes nothing for a running session. On save, the dashboard reloads every
  connected session so the new policy takes effect at once.
- **BREAKING (UI):** the dismiss control is **collapse-only while retries are pending**. The
  card shrinks to a one-line pill still carrying the error, the attempt number, the countdown,
  and Stop. A real dismiss appears only once retrying has stopped. Collapse is sticky for that
  failure chain only. This removes the state where a live retry chain has no on-screen handle.
- **Stop retrying** is restored as an explicit banner control; it ends the chain AND aborts the
  turn, identical in effect to the session Stop. Verified to work mid-backoff: an abort sent
  15 806 ms into a 16 s sleep produced `auto_retry_end` at 15 808 ms — **2 ms**.
- **Attempt numbering** is rendered bare ("attempt 7"), never "of N": with a large
  `maxRetries` the denominator is meaningless noise.

### Explicitly out of scope

- **A single-shot manual Retry on the settled card.** It would need exactly the re-drive
  mechanism that does not exist (above). The predecessor change removed the old
  `send_prompt` re-send because it duplicated the user turn; nothing replaces it here.
- **A 60 s ceiling on the delay.** pi's curve is `baseDelayMs · 2^(n-1)`, hardcoded and
  uncapped; `retry.maxDelayMs` no longer applies to this layer (pi migrates it to
  `retry.provider.maxRetryDelayMs`, which governs only HTTP-level retry-after). We cannot
  push changes upstream, so the accepted cost is overshoot of up to ~1× the outage length.
- **`retry.provider.*`.** That layer honors provider `retry-after` exactly, but is
  **completely unobservable** — no event, no callback (verified across all five wrapped
  providers). Routing the wait there would make the dashboard show "streaming" for hours.

## Capabilities

### New Capabilities
- `pi-retry-settings`: the dashboard surface that reads and writes pi's `retry` block in
  `~/.pi/agent/settings.json`, its validation and defaults, and the apply-by-reload behavior.

### Modified Capabilities
- `bridge-retry-observability`: correct the observation model to pi's real event shape
  (`agent_end` per attempt, `agent_settled` as the sole terminal signal) — fixing the
  zero-events defect; emit a waiting signal on an error `agent_end`; carry real
  `maxAttempts` / `delayMs` read-only from pi's settings in place of the `-1` sentinels.
- `provider-retry-state`: add the `waiting` sub-state and `nextAttemptAt` alongside the
  in-flight one; drop the sentinel-only rendering path; keep the attempt counter bare.
- `session-status-banner`: dismiss becomes collapse-while-pending with a per-chain sticky
  collapse; add the collapsed one-line pill (error + attempt + countdown + Stop + expand);
  restore an explicit Stop retrying control; keep the ban on a second session-abort pill.
- `error-detection`: remove the stale `send_prompt` Retry requirement (already gone from the
  code, and unimplementable without a re-drive mechanism); a settled error whose retry chain
  is still running SHALL NOT render as terminal.

## Discipline Skills

- `doubt-driven-review`: writing a `retry` block into the user's GLOBAL pi settings changes
  behavior for every pi session on the machine, including plain CLI/TUI use — stress-test the
  write path, the defaults, and the reload-on-save before it stands.
- `security-hardening`: the dashboard gains a write path into `~/.pi/agent/settings.json`;
  validate bounds and never clobber unrelated keys.
- `review-code`: multi-package change (settings surface + bridge tracker fix + banner + card).
- `systematic-debugging`: to be invoked if the corrected tracker misfires — the expected
  failure shape is a waiting signal that never clears.

## Impact

- **Server (new):** read/write of pi's `retry` block in `~/.pi/agent/settings.json`
  (merge-preserving), exposed over the existing config REST surface; reload-on-save fan-out to
  connected sessions via the existing `{type:"reload"}` command arm.
- **Extension/bridge:** `packages/extension/src/retry-tracker.ts` — the event-shape fix plus
  waiting-signal emission and real `delayMs`/`maxAttempts`; `bridge.ts` wiring for
  `agent_settled` as the chain terminator.
- **Client:** `SessionBanner.tsx` (collapse-only dismiss, collapsed pill, Stop retrying),
  `event-reducer.ts` (`retryState` gains `waiting` + `nextAttemptAt`; `deriveBannerState`
  propagates them), `App.tsx` (banner wiring), `SessionList.tsx` (`isRetrying` detail), plus
  the new settings section.
- **Shared:** protocol additions for the waiting signal and the retry-settings payload.
- **Tests:** `retry-tracker.test.ts` (incl. a regression test pinning pi's real event order),
  `SessionBanner.test.tsx`, `event-reducer` retry scenarios, settings read/write/merge tests.
- **NOT touched:** pi's `retry.provider.*` block, pi's retryable-error classifier, and
  `.pi/settings.json` (project-scoped retry is out of scope; global only).
- **Predecessor:** extends `simplify-error-retry-single-card` (keeps its single-card,
  no-regex, observe-only stance; adds the settings surface and the controls it removed).

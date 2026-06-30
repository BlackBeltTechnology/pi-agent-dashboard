## Context

The retry/error UX has accreted six prior fix-changes (`fix-provider-retry-infinite-loop`, `unify-status-banner-and-terminal-limit-stop`, `fix-retry-banner-stuck-on-limit-exceeded`, `fix-retry-resends-last-user-message`, etc.). Each patched a symptom of one underlying model error: **retry and error are modeled as mutually-exclusive states that replace each other.**

Current data flow (see `event-reducer.ts`, `command-handler.ts`, `retry-tracker.ts`):

- pi-coding-agent retries internally and exposes NO retry events. The bridge `RetryTracker` infers retries from `message_end(stopReason:error)` matching `RETRYABLE_PATTERN` and synthesizes `auto_retry_start` / `auto_retry_end`.
- Reducer maps `retryState` (set by `auto_retry_start`) and `lastError` (set by `agent_end`) into a single `BannerState` via `deriveBannerState`; `retryState` wins.
- `agent_start` clears both `lastError` and `retryState`.
- `command-handler.ts` aborts via a wrapper-abort + a 200 ms-interval persistent-abort scheduler capped at `PERSISTENT_ABORT_MAX_MS = 2000`.

Constraints: pi exposes no retry settings (sentinel `-1` for `maxAttempts`/`delayMs`), no queue-mutation API, and retries happen entirely inside pi. The dashboard can only observe `message_end`/`agent_end` and call `cachedCtx.abort()`.

## Goals / Non-Goals

**Goals:**
- One per-session error-lifecycle surface: persistent error anchor + swappable live status sub-line.
- `lastError` survives until a confirmed non-error response; no optimistic clear on `agent_start`.
- ✕ on a retrying/retryable surface reliably stops pi's in-flight retry, even across long backoffs.
- No simultaneous yellow + red anywhere (banner, inline chat card, session dot).

**Non-Goals:**
- Changing pi-coding-agent's retry decisions or backoff schedule.
- Exposing pi's true retry settings (still unavailable → indeterminate UI stays).
- Persistent-side (JSONL) dedup; collapse remains a render-time concern.
- Reworking the `limit-exceeded` terminal path (it already hard-stops correctly).

## Decisions

### D1 — Composed surface, not XOR variants

Replace the `retrying | error | limit-exceeded | hidden` precedence with a surface that holds an optional **error anchor** AND an optional **live status**. `deriveBannerState` returns a structure that can carry both (`{ error?, retry? }`) rather than picking one. `SessionBanner` renders the error message as the persistent header and the retry status (countdown / "retrying…" / manual Retry / terminal hint) as a sub-line.

*Alternative considered:* keep XOR but reorder precedence so error wins. Rejected — error-wins hides the live retry progress the user wants to see; the actual need is composition.

### D2 — Confirmed-good clear trigger

Stop clearing `lastError` in the `agent_start` arm. Introduce a clear on the **first confirmed non-error signal** of the subsequent turn. Candidate trigger (see Open Questions): first assistant `message_start`/streamed token, OR first non-error `message_end`, OR clean `agent_end`. `retryState` clearing on `auto_retry_end` is unchanged.

*Alternative considered:* clear on `agent_start` but keep a "ghost" copy for display. Rejected — two sources of truth for the same error invites the exact desync this change removes.

### D3 — Abort that outlasts backoff

Two options:
- **(a) Extend/re-arm the persistent-abort scheduler** beyond 2 s to cover backoff (e.g. keep poking `rawAbort` until `isIdle` or `agent_end`, with a longer cap).
- **(b) Latch an `abortRequested` flag** in the bridge that is honored whenever pi re-enters `agent.continue()` after sleep, then cleared on the next `agent_end`/idle.

**Decision: (b)** — a latch is robust to arbitrary backoff length without busy-polling for tens of seconds; the scheduler's streaming-transition break (which prevents killing a user re-send) is preserved by clearing the latch on settle.

**Latch detection rule (D3b).** pi exposes no retry events; the bridge only observes `agent_start` / `message_start` / `message_end` / `agent_end` and may call `cachedCtx.abort()`. The latch therefore operates as **abort-on-sight** scoped to the aborted turn: once `abortRequested` is set for a session, ANY observed agent activity for that session (`agent_start` / `message_start` of a resumed turn) triggers a fresh `cachedCtx.abort()`. The bridge does not try to distinguish "pi waking from backoff" from "a brand-new turn" by inspecting pi internals — it relies on the clear conditions instead: the latch is cleared the instant (i) a NEW user prompt is sent for the session (so the user's deliberate new turn is never killed), or (ii) the aborted turn settles (`agent_end` / `cachedCtx.isIdle()` → true). Between set and clear, every resumption attempt is aborted. This makes "no intervening user prompt" the discriminator without needing a retry signal from pi.

### D4 — Dismiss ✕ semantics by state

- Surface in a **retrying / retryable-error** state → ✕ aborts (D3) AND clears the surface.
- Surface in a **terminal `limit-exceeded`** state → ✕ only dismisses (nothing to abort; pi already stopped).

### D5 — Suppress duplicate inline error card

Extend `collapse-retried-errors.ts` (or add a sibling helper) so that while the error-lifecycle surface owns a failure, the corresponding inline failed-attempt card in the chat stream is collapsed to a compact badge — same pattern already used by `RetriedErrorBadge` for tool retries.

## Risks / Trade-offs

- [Confirmed-good clear is too late → success feels laggy] → trigger on the first `end_turn` `message_end` (per Resolved Decision 1), not the final `agent_end`; that fires as soon as the assistant message completes successfully.
- [Confirmed-good clear is too early → a mid-turn stop clears, then the turn errors, flicker] → resolved by keying on `stopReason === "end_turn"` ONLY; `tool_use` / other mid-turn stops do NOT clear (Resolved Decision 1).
- [Latch (D3b) leaks and kills a legitimate later turn] → clear the latch on the same settle conditions that stop the current scheduler (`agent_end` / `isIdle`); add a test for re-send within the window.
- [Composed surface regresses the many existing banner tests] → the `BannerState` shape change is breaking for tests; migrate them as part of the change, keep `data-testid`s stable.
- [Bridge wire-ordering invariants (already specced) interact with deferred clearing] → preserve the existing synth-before-agent_end ordering; only the reducer's clear timing moves.

## Migration Plan

1. Reducer: change `agent_start` arm + add confirmed-good clear; update `deriveBannerState` shape.
2. Bridge: add abort latch (D3b); keep persistent-abort scheduler as the fast path.
3. UI: compose `SessionBanner`; wire Dismiss→abort by state; suppress inline duplicate card.
4. Migrate banner/reducer tests; add new lifecycle tests.
5. Client change → `npm run build` + `/api/restart`; bridge change → `npm run reload`.

Rollback: revert the reducer clear-timing + bridge latch commits; banner composition is display-only and safe to revert independently.

## Resolved Decisions (was Open Questions)

1. **Confirmed-good trigger granularity → first terminal-SUCCESS stop, not any non-error stop.** `lastError` clears on the first assistant `message_end` with a terminal-success `stopReason`, OR a clean `agent_end` whose last message has a terminal-success `stopReason` — whichever comes first. Terminal-success = pi-ai `"stop"` (the real wire value; `"end_turn"` accepted too for Anthropic-normalized / fixture paths), encoded as `CONFIRMED_GOOD_STOP_REASONS`. Deliberately NOT "any `stopReason !== "error"`": `"toolUse"` is a mid-turn pause and the turn can still error afterward; pi fires an `agent_end` carrying a `toolUse` last message when a turn yields at an interactive tool (`ask_user`), which is a pause, not a success; `"aborted"` is a user abort. Clearing on any non-success stop would reintroduce the clear→re-set flicker AND wrongly drop the anchor across an interactive pause or abort (both caught by the e2e `ask-select` discriminator). First streamed token was rejected as too eager for the same reason. BOTH the `message_end` and `agent_end` (`isCleanAgentEnd`) clears use `CONFIRMED_GOOD_STOP_REASONS`.
2. **Auto-retry header → no early promotion; retry-only stays amber until a terminal failure settles.** A retry that has NOT yet produced a terminal failure (i.e. `retryState` set, `lastError` still undefined) renders as the amber **retrying-only** sub-line — no red error header. The red error anchor appears only once `lastError` is set by a terminal failure, from EITHER reducer path: `agent_end` with `stopReason: "error"` (`extractAgentEndError`), OR `auto_retry_end` with `success === false` and a `finalError` (the exhausted-retry path, when no `agent_end` error was recorded). This keeps normal auto-retries from flashing red before they have actually failed terminally.
3. **Stale error across a brand-new user prompt → wait for confirmed-good, same as a retry.** A new (non-retry) user prompt does NOT optimistically clear the prior `lastError`; the error anchor persists until the new turn produces a confirmed-good response (decision 1). Clearing on send would reintroduce the optimistic-clear desync the whole change exists to remove. The abort latch (D3b) IS cleared on the new prompt so the new turn runs freely; only the *display* anchor lingers, and it clears the moment the new turn succeeds.

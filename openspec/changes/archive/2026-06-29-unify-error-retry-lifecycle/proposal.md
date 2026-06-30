## Why

Today the dashboard treats provider-retry (🟡) and settled-error (🔴) as **mutually exclusive replacements**: `retryState` wins over `lastError`, and `agent_start` clears `lastError` the instant a retry begins. Three user-visible defects fall out of that model:

1. **Yellow + red appear together.** The "exactly one variant" invariant is enforced only inside `SessionBanner` via `deriveBannerState`. Other red surfaces are NOT governed by it — an inline failed-tool error card in the chat stream stays red while the banner above shows the yellow retry, and a late synthesized `auto_retry_start` (past the 1500 ms guard) can set `retryState` while `lastError` is still present for any consumer reading it directly.
2. **Hitting ✕ does not stop the retry.** The red banner's Dismiss ✕ is cosmetic — it clears `lastError` but never aborts, so pi keeps retrying. The amber "Stop retrying" abort uses a 2-second persistent-abort window that is shorter than typical rate-limit backoffs (5–60 s); pi wakes from its sleep with a fresh `_retryAbortController`, sees no abort signal, and resumes the retry.
3. **The error disappears before the retry is confirmed good.** `agent_start` clears `lastError`/`retryState` optimistically. On the manual-retry path the error vanishes the moment Retry is clicked; if the retry also fails, a new error flashes in. The user loses the failure context before knowing whether the retry actually succeeded.

The root cause is the conceptual model. The correct frame: there is ONE error-lifecycle surface per session. The error is the **persistent anchor**; the retry is a **live sub-status on it**; the surface clears ONLY on a confirmed non-error response.

## What Changes

- **Reframe the banner from "yellow XOR red" to one error-lifecycle surface.** The settled error is the persistent anchor; the retry status renders as a swappable live sub-line within it (`retrying… attempt N` → manual `Retry` → terminal `limit-exceeded`). The mutual-exclusion precedence (`retrying` hides `error`) is replaced by composition.
- **Extend the single-surface invariant across ALL red surfaces**, not just the banner. While a session is in the error-lifecycle surface, the inline chat stream SHALL NOT render a duplicate red error card for the same failure (the failed attempt collapses, like `RetriedErrorBadge` does for tool retries).
- **Defer clearing `lastError` until a confirmed good response.** Stop clearing on `agent_start`. Clear only on the first confirmed non-error signal of the new turn (first streamed assistant token / a non-error `message_end` / a clean `agent_end`). **BREAKING** behavior change to the reducer's `agent_start` arm and the `provider-retry-state` clearing rules.
- **Make ✕ actually cancel.** The Dismiss ✕ on a retryable/retrying surface SHALL abort the session (not just hide the message). The persistent-abort scheduler SHALL outlast provider backoff — either by extending/re-arming its window or by latching an "abort requested" flag the bridge honors when pi wakes from its retry sleep.
- Update tests for the new lifecycle and the confirmed-clear timing.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `session-status-banner`: banner becomes one composed error-lifecycle surface (persistent error anchor + live retry sub-status) instead of three mutually-exclusive variants; Dismiss ✕ aborts on a retrying/retryable surface; the single-surface invariant extends to suppress duplicate inline chat error cards.
- `error-detection`: `lastError` is no longer cleared on `agent_start`; it clears only on a confirmed non-error response of the subsequent turn (the "Error state cleared on new turn" requirement and its dependent banner scenarios change).
- `provider-retry-state`: persistent-abort scheduler must outlast provider backoff (abort latch) so user abort reliably stops an in-flight retry.

## Impact

- `packages/client/src/lib/event-reducer.ts` — `agent_start` arm (stop clearing `lastError`), confirmed-good clear trigger, `deriveBannerState` shape.
- `packages/client/src/components/SessionBanner.tsx` — composed surface; Dismiss→abort wiring on retrying/retryable state.
- `packages/client/src/components/ChatView.tsx` + `packages/client/src/lib/collapse-retried-errors.ts` — suppress duplicate inline error card for the active error-lifecycle failure.
- `packages/client/src/App.tsx` — `onDismiss` handler (abort vs clear), session-list dot derivation.
- `packages/extension/src/command-handler.ts` — persistent-abort window / abort-latch so backoff cannot outlive abort.
- Tests across `packages/client/src/lib/__tests__/` and `packages/extension/src/__tests__/`.

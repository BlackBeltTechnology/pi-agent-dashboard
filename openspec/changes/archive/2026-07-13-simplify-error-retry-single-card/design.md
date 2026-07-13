## Context

The error-lifecycle surface today (change `unify-error-retry-lifecycle`) is a `SessionBanner` composed of two stacked blocks — a red `ErrorBlock` and an amber `RetryBlock` — selected by `deriveBannerState`. Classification depends on two regexes:

- `RETRYABLE_PATTERN` (in `packages/extension/src/retry-tracker.ts`) — a verbatim copy of pi's internal `_isRetryableError`, used to PREDICT that pi is about to retry so the bridge can synthesize `auto_retry_start` during pi's silent backoff sleep.
- `USAGE_LIMIT_PATTERN` (in `packages/shared/src/error-patterns.ts`) — matches provider billing strings; routes to the `limit-exceeded` variant and drives a bridge auto-abort that skips pi's retry sleep.

Load-bearing constraint: **pi owns retry policy; the bridge only observes.** pi's `_handleRetryableError` fires `message_end` for the failed message, sleeps, then starts a fresh assistant `message_start` for the next attempt — all within a single agent turn (one `agent_start`…`agent_end`). The bridge cannot make pi retry an error pi deems terminal; it can only re-drive the request itself (re-send or `resume mode:"continue"`).

## Goals / Non-Goals

**Goals:**
- One card per failure. Error text always visible; retry is a live sub-state on the same surface.
- Zero regex classification. Retry state derived from observed pi behavior.
- Dismiss (✕) clears only; a single labeled Stop is the sole abort.
- Manual "Try again" re-drives via continue-resume with no duplicated user message.
- Net code reduction (delete two regexes + one banner variant + auto-abort path).

**Non-Goals:**
- Dashboard-driven infinite retry loop after pi gives up (user chose "settle").
- Changing pi's own retry count/policy.
- Preserving the `limit-exceeded` 💳 variant or the usage-limit fast-abort.

## Decisions

**D1 — Single composed card.** `SessionBanner` renders ONE card element. `ErrorBlock`/`RetryBlock` merge into one body: error string (always) + optional retry sub-line ("retrying… (attempt N)") + a thin animated top strip while retrying + actions row. `deriveBannerState` still returns `{ error?, retry? }` (composition preserved) but the component renders them in a single bordered surface, not two siblings.
- *Alternative rejected:* keep two blocks styled to look joined — still two DOM cards, still the "duplicated message" complaint.

**D2 — Observe retries instead of predicting them.** `RetryTracker.observeMessageEnd` stops testing `RETRYABLE_PATTERN`. New rule: on an error `message_end`, record a "pending failure" for the session; if a fresh assistant `message_start` arrives before any user prompt or `agent_end`, emit `auto_retry_start { attempt: N }` (N = observed attempt count). On a non-error assistant `message_end` / clean `agent_end`, emit `auto_retry_end { success: true }`; on terminal `agent_end` with `stopReason:"error"`, emit `auto_retry_end { success:false, finalError }`. Attempt count comes from counting observed attempts, not a regex.
- *Consequence:* during pi's backoff sleep the card shows the error with no "retrying…" sub-line until pi's next `message_start` fires — honest ("errored, waiting") rather than a predicted label. Accepted.
- *Alternative rejected:* keep the regex copy — the exact staleness/fragility the user vetoed.

**D3 — Drop `USAGE_LIMIT_PATTERN` entirely.** Remove the `limit-exceeded` kind from `deriveBannerState`, the 💳 UI branch, and the bridge's usage-limit auto-abort + `usage-limit-orderer` billing path. Billing/quota failures flow through the ordinary error path: pi treats them as non-retryable → terminal `agent_end` error → card settles as a plain error. `packages/shared/src/error-patterns.ts` is deleted if no other importer remains.
- *Trade-off:* we lose the "skip pi's pointless retry sleep on billing" optimization; the user explicitly accepted a uniform error path over regex special-casing.

**D4 — Dismiss decoupled from abort.** `SessionBanner` removes `dismissAborts`. ✕ calls `onDismiss` only (clears `lastError`/`retryState` locally). The single **Stop** button (labeled "Stop (ends the session)") calls `onAbort` (`send({type:"abort"})`). While a retry is live the Stop button is present; on a settled error Stop is omitted (pi already stopped) and only ✕ + "Try again" remain.
- *Alternative rejected:* Reading-B "collapse to a still-retrying chip" — user chose the simpler clear-on-dismiss.

**D5 — Remove the manual "Try again" entirely.** Implementation revealed that after a terminal error the session is `idle` (pi process alive), not `ended`, and `resume mode:"continue"` requires `status === "ended"` (HTTP 409 otherwise). There is no bridge primitive to re-drive the same turn on a live idle session without sending a new user prompt. Rather than re-introduce the duplicating re-send, the manual retry is REMOVED: pi's in-flight auto-retry covers transient failures, and a settled error shows only its message + copy + clear-only Dismiss. The faulty `findLastUserPrompt` → `handleSendPromptToSession` path and the `retriedFrom` de-dup for it are deleted.
- *Alternative rejected:* re-send-with-dedup — still creates a new user turn (the reported bug).
- *Alternative rejected:* adaptive continue-vs-resend — continue only helps for an ended session (rare); the resend branch keeps the bug.
- *Decision recorded during apply (user choice): remove entirely.*

## Risks / Trade-offs

- **Backoff-window gap** (D2): no "retrying…" label during pi's sleep → Mitigation: keep the error text visible with a neutral "waiting to retry" affordance; the sub-line appears the instant pi's next attempt starts. Acceptable and more honest than a guessed label.
- **Removing usage-limit fast-abort** (D3): a billing error now waits for pi's own terminal `agent_end` instead of an immediate dashboard abort → Mitigation: pi's `_isRetryableError` does not match billing strings, so pi ends promptly anyway; net latency change is negligible.
- **Continue-resume requires an ended session** (D5): "Try again" is only valid after settle → Mitigation: gate the button on `session.status === "ended"`; while retrying, only Stop is shown.
- **Spec/test churn**: three specs + four test suites change → Mitigation: deltas are explicit; tests updated in the same change.

## Migration Plan

1. Land reducer + tracker changes behind the existing event shapes (no protocol version bump — `auto_retry_*` payloads unchanged).
2. Update `SessionBanner` + `App.tsx` wiring.
3. Delete `USAGE_LIMIT_PATTERN` / `error-patterns.ts` + usage-limit branches once no importer remains.
4. Rebuild client + restart server; reload bridges (extension change).
- **Rollback:** revert the change commit; prior `unify-error-retry-lifecycle` behavior is fully restored (no data migration, no persisted-state shape change).

## Open Questions

- None blocking. The backoff-window affordance wording (D2) is a UI-copy detail resolved during implementation.

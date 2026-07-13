## Why

The current error-lifecycle surface stacks TWO cards for one failure — a red error block and an amber retry block — and drives classification with two brittle regexes (`RETRYABLE_PATTERN`, `USAGE_LIMIT_PATTERN`) that guess pi's retry policy and provider-specific billing strings. An "overloaded" failure is simultaneously an error AND auto-retrying, yet it renders as two separate cards, and the regexes go stale whenever a provider changes wording. Worse, the ✕ dismiss aborts the session (couples clear+stop), and the manual Retry re-sends the last user message, duplicating it in the transcript.

## What Changes

- **BREAKING (UI/UX):** Collapse the error anchor + retry sub-line into ONE card. The raw error string is always shown; the retry is a live sub-state on the same surface — never two cards for one failure.
- **BREAKING (behavior):** Remove `RETRYABLE_PATTERN`. Retry state is derived by OBSERVING pi start a fresh attempt within the same turn (a new assistant `message_start` after an error `message_end`, no intervening user prompt), not by predicting retryability with a regex copy of pi's internal matcher.
- **BREAKING (behavior):** Remove `USAGE_LIMIT_PATTERN` and the `limit-exceeded` banner variant + the bridge's usage-limit auto-abort. Billing/quota failures render as ordinary errors that settle when pi stops.
- **BREAKING (behavior):** Dismiss (✕) becomes clear-only — it NEVER aborts the session. A single, explicitly-labeled **Stop** control is the only path that aborts, so the user is aware the action ends the session.
- **Fix faulty retry:** The manual "Try again" re-drives the same request via `resume mode:"continue"` (re-runs from history, adds NO duplicate user message), replacing the `findLastUserPrompt` re-send.
- When pi exhausts its own retries or hits a terminal error, the card **settles** to a plain error with "Try again" + Stop/dismiss (no dashboard auto-loop).
- Remove now-dead code: `packages/shared/src/error-patterns.ts` exports, `usage-limit-orderer.ts` usage-limit path, retry-tracker regex branch; update the three spec test suites.

## Capabilities

### New Capabilities
<!-- none — all changes modify existing spec requirements -->

### Modified Capabilities
- `session-status-banner`: One composed card (not two stacked blocks); remove `limit-exceeded` variant; ✕ is clear-only; explicit labeled Stop is the sole abort; "Try again" uses continue-resume.
- `provider-retry-state`: retry detection derives from observed pi behavior, not `RETRYABLE_PATTERN`; drop the predictive-regex requirement.
- `error-detection`: remove `USAGE_LIMIT_PATTERN` classification and the usage-limit auto-abort/limit-exceeded routing; terminal errors settle as ordinary errors.

## Impact

- **Client:** `packages/client/src/components/SessionBanner.tsx` (single-card render, clear-only ✕, labeled Stop, continue-based Try again), `packages/client/src/lib/event-reducer.ts` (`deriveBannerState` drops `limit-exceeded`; retry sub-state from observed attempts), `packages/client/src/App.tsx` (banner wiring: `onDismiss` no longer aborts; retry → continue-resume).
- **Extension/bridge:** `packages/extension/src/retry-tracker.ts` (observe-based, no regex), `packages/extension/src/bridge.ts` + `usage-limit-orderer.ts` (drop usage-limit auto-abort/ordering).
- **Shared:** `packages/shared/src/error-patterns.ts` (remove `USAGE_LIMIT_PATTERN`; likely delete the module).
- **Tests:** update/remove `error-patterns.test.ts`, `retry-tracker.test.ts`, `SessionBanner.test.ts`, `event-reducer` error/retry scenarios.
- **Predecessor:** supersedes parts of `unify-error-retry-lifecycle` (composed two-block surface, `dismissAborts`).

## Discipline Skills

- `code-simplification` — this change removes two classification regexes and collapses two cards into one; the diff should be a net simplification.
- `doubt-driven-review` — removing `USAGE_LIMIT_PATTERN` changes bridge abort behavior (a cross-boundary, hard-to-reverse policy change); stress-test before it stands.

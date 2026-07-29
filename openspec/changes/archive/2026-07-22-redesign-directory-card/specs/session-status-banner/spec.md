## MODIFIED Requirements

### Requirement: Single banner component with composed error-lifecycle surface

The dashboard SHALL render exactly one banner component (`SessionBanner`) per selected session, mounted sticky above the `CommandInput` (between `ChatView` and `CommandInput`). The banner is a single **error-lifecycle surface** whose contents are derived from a single selector over `SessionState`. Two banner components SHALL NEVER be visible simultaneously for the same session, AND the surface SHALL render as ONE card (a single bordered element), NOT two stacked blocks. The surface SHALL be rendered via the shared `InlineMessage` primitive with `severity="error"`, so its colors resolve from `--severity-error-*` theme tokens (NOT raw `red-500` literals); the in-flight retry indicator SHALL be the primitive's `animate` top accent-bar sweep.

The surface composes an optional **error anchor** (from `lastError`) with an optional **live retry sub-line** (from `retryState`) WITHIN the same card body: the error message is the header row, the retry status is a sub-line beneath it, and a thin animated indicator on the same card conveys the retrying state. There SHALL NOT be a separate red card and a separate amber card for one failure.

There SHALL be NO `limit-exceeded` surface state. Billing / quota failures render identically to any other error (ordinary error state); no `USAGE_LIMIT_PATTERN` classification is performed.

Surface states:

- **error + retrying** (one card): `lastError` set AND `retryState` set. Header shows the error message; the same card shows a "retrying… (attempt N)" sub-line + the animated indicator + a "Stop (ends the session)" action.
- **retrying only** (one card): `retryState` set, `lastError` undefined. Shows `retryState.reason` sub-line + animated indicator + "Stop (ends the session)".
- **error only** (one card, settled): `lastError` set, `retryState` undefined. Shows message + Dismiss + copy. No Stop (pi already stopped) and NO manual retry (pi's in-flight auto-retry is the only retry path).
- **hidden**: neither field set → nothing rendered.

The error anchor SHALL persist while a retry runs on top of it; the surface SHALL clear only when `lastError` clears (per `error-detection` "Error state cleared on confirmed-good response") and `retryState` is undefined.

#### Scenario: Error and retry render in a single card
- **WHEN** `SessionState.lastError = { message: "overloaded_error", timestamp: 0 }` AND `SessionState.retryState = { attempt: 2, maxAttempts: -1, delayMs: -1, reason: "overloaded", startedAt: 0 }`
- **THEN** the surface SHALL render exactly ONE card element containing the error message "overloaded_error"
- **AND** the SAME card SHALL contain the "retrying… (attempt 2)" sub-line
- **AND** the surface SHALL NOT render two separate sibling card elements

#### Scenario: Surface uses severity tokens via InlineMessage
- **WHEN** the settled-error surface is rendered
- **THEN** its background, border, and foreground SHALL resolve from `--severity-error-*` tokens through the shared `InlineMessage` primitive
- **AND** the surface SHALL NOT apply raw `red-500`/`amber-500` color literals

#### Scenario: Retrying-only when no terminal error yet
- **WHEN** `SessionState.retryState` is set AND `SessionState.lastError` is undefined
- **THEN** the surface SHALL render the single card with the retrying sub-line and `reason`
- **AND** a "Stop (ends the session)" action SHALL be present

#### Scenario: Billing error renders as an ordinary error (no limit-exceeded variant)
- **WHEN** `SessionState.lastError = { message: "usage_limit_reached", timestamp: 1 }` AND `retryState` is undefined
- **THEN** the surface SHALL render the ordinary settled-error card with message + Dismiss + copy
- **AND** the surface SHALL NOT render any `limit-exceeded` / 💳 variant
- **AND** no `USAGE_LIMIT_PATTERN` test SHALL be performed

#### Scenario: Hidden when neither field is set
- **WHEN** `SessionState.retryState` is undefined AND `SessionState.lastError` is undefined
- **THEN** the `SessionBanner` SHALL render nothing (no DOM)

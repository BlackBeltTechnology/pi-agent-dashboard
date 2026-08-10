# session-status-banner Specification

## Purpose

Unified single-banner component (`SessionBanner`) for per-session retry/error/limit state, mounted sticky above the `CommandInput`. Replaces the prior split `<RetryBanner>` + inline-`lastError` block in `ChatView`. Variant derived by a pure selector over `SessionState`.
## Requirements
### Requirement: Banner-state selector is a pure function

A helper `deriveBannerState(state: SessionState): BannerState` SHALL be exported from the
client's event-reducer module. The selector SHALL be pure and SHALL be the sole determinant of
what the `SessionBanner` renders. The host component SHALL NOT compute composition or
precedence inline.

The selector's return shape SHALL carry BOTH the optional error anchor and the optional retry
sub-status, and the retry sub-status SHALL carry the waiting flag and the next-attempt time so
the component renders the countdown without deriving it:

```ts
type BannerState =
  | { variant: "hidden" }
  | {
      error?: { kind: "error"; message: string };
      retry?: {
        attempt: number;
        maxAttempts: number;
        delayMs: number;
        nextAttemptAt?: number;
        waiting: boolean;
        startedAt: number;
        reason: string;
      };
    };
```

The selector SHALL return `{ variant: "hidden" }` only when BOTH `lastError` and `retryState`
are undefined. Collapse is presentation state owned by the component and SHALL NOT appear in
the selector's output.

#### Scenario: Selector returns hidden for empty state

- **WHEN** `deriveBannerState({ retryState: undefined, lastError: undefined, … })` is called
- **THEN** the return SHALL be `{ variant: "hidden" }`

#### Scenario: Selector composes error + retry when both set

- **WHEN** `deriveBannerState({ retryState: { attempt: 2, maxAttempts: 3, delayMs: 4000, waiting: true, reason: "overloaded", startedAt: 0 }, lastError: { message: "overloaded_error", timestamp: 1 }, … })` is called
- **THEN** the return SHALL include `error: { kind: "error", message: "overloaded_error" }`
- **AND** the return SHALL include `retry` carrying `attempt: 2` and `waiting: true`

#### Scenario: Selector propagates the next-attempt time

- **WHEN** the state carries a `waiting: true` retry record with `nextAttemptAt`
- **THEN** the returned `retry` SHALL carry the same `nextAttemptAt`

#### Scenario: Selector never marks limit-exceeded

- **WHEN** `deriveBannerState({ retryState: undefined, lastError: { message: "quota_exceeded for org x", timestamp: 1 }, … })` is called
- **THEN** the return SHALL include `error: { kind: "error", message: "quota_exceeded for org x" }`
- **AND** the return SHALL NOT include any `limit-exceeded` kind

### Requirement: Banner mounts sticky above CommandInput

`SessionBanner` SHALL be mounted in the layout tree between `ChatView` and `CommandInput` (not inside `ChatView`). The banner SHALL NOT scroll with chat content. It SHALL occupy a single row of vertical space and SHALL collapse to zero height when in `hidden` variant.

The legacy `RetryBanner.tsx` component SHALL be removed. The inline `lastError` red-banner block previously rendered inside `ChatView.tsx` SHALL be removed. No code path SHALL render two banner components for the same session.

#### Scenario: Banner appears above CommandInput in the DOM tree
- **WHEN** the dashboard renders for a session with `retryState` set
- **THEN** the `SessionBanner` element SHALL appear in the DOM between the chat scroll container and the `CommandInput` element

#### Scenario: Banner does not scroll with chat
- **WHEN** the user scrolls through chat history
- **AND** `retryState` or `lastError` is set
- **THEN** the `SessionBanner` SHALL remain visible regardless of chat scroll position

#### Scenario: Legacy RetryBanner is removed
- **WHEN** searching for `RetryBanner` component imports across `packages/client/`
- **THEN** no production code path SHALL import or render `RetryBanner`

### Requirement: Shared error-pattern module

`USAGE_LIMIT_PATTERN` SHALL live in `packages/shared/src/error-patterns.ts` as a named export. The extension package's `usage-limit-orderer.ts` SHALL re-export the same constant for source compatibility with code that imports it from there. No duplicated regex literal SHALL exist in either the client or the extension.

The pattern source-of-truth SHALL be the version currently in `packages/extension/src/usage-limit-orderer.ts:30`:

```
/usage[_ ]limit[_ ]reached|usage_not_included|insufficient_quota|credit[_ ]balance|quota[_ ]exceeded|resource[_ ]exhausted|monthly[_ ]limit|monthly[_ ]spending[_ ]cap|hourly[_ ]limit|daily[_ ]limit|spending[_ ]cap|exceeded[^"]{0,40}(quota|cap|spending)|reset after \d+[hms]/i
```

#### Scenario: Pattern matches all documented terminal categories
- **WHEN** the pattern is tested against each of: `"usage_limit_reached"`, `"quota_exceeded"`, `"insufficient_quota"`, `"credit balance"`, `"monthly_spending_cap"`, `"resource_exhausted"`, `"reset after 12h"`
- **THEN** each test SHALL return `true`

#### Scenario: Pattern does NOT match generic retryable errors
- **WHEN** the pattern is tested against `"fetch failed"`, `"ECONNRESET"`, `"timeout"`, `"429 Too Many Requests"` (without quota suffix)
- **THEN** each test SHALL return `false`

#### Scenario: Extension re-export resolves to shared module
- **WHEN** code imports `USAGE_LIMIT_PATTERN` from `packages/extension/src/usage-limit-orderer.ts`
- **THEN** the resolved binding SHALL reference the export from `packages/shared/src/error-patterns.ts`
- **AND** the regex `.source` SHALL match the shared module's export `.source`

### Requirement: Single red surface — inline chat error card suppressed during active error-lifecycle

While the error-lifecycle surface owns a failure for a session (i.e. `deriveBannerState` returns a non-hidden state with an `error` or `retry`), the chat message stream SHALL NOT render a duplicate full red error card for that same failure. The failed attempt SHALL collapse to a compact badge (same pattern as `RetriedErrorBadge` for tool retries) or be hidden, so yellow (retry sub-status) and red (settled error) NEVER appear on two separate surfaces simultaneously for the same session.

This extends the single-surface guarantee beyond the banner selector: the invariant "exactly one red/amber surface per session failure" SHALL hold across the banner AND the inline chat stream.

#### Scenario: Inline failed-attempt card collapses while surface is active
- **GIVEN** the chat stream contains a `toolResult` / assistant row whose failure is the same one driving the active error-lifecycle surface
- **WHEN** the `SessionBanner` is rendering that failure (error and/or retry)
- **THEN** the inline chat stream SHALL NOT render a second full red error card for the same failure
- **AND** the failed attempt SHALL appear as a compact collapsible badge (or be hidden)

#### Scenario: No simultaneous yellow + red across surfaces
- **GIVEN** `retryState` is set (amber) for a session
- **WHEN** the chat stream and the banner both render
- **THEN** at most ONE surface SHALL show the failure's red/amber state at a time
- **AND** the user SHALL NOT see a yellow banner above a red inline error card for the same failure

### Requirement: Single-card error-lifecycle surface (observe-only)

The dashboard SHALL render exactly one banner component (`SessionBanner`) per selected session,
mounted sticky above the `CommandInput`. The banner is a single **error-lifecycle surface**
whose contents are derived from a single selector over `SessionState`. Two banner components
SHALL NEVER be visible simultaneously for the same session, AND the surface SHALL render as ONE
card (a single bordered element), NOT two stacked blocks. The surface SHALL be rendered via the
shared `InlineMessage` primitive with `severity="error"`, so its colors resolve from
`--severity-error-*` theme tokens (NOT raw `red-500` literals); the in-flight retry indicator
SHALL be the primitive's `animate` top accent-bar sweep.

The surface composes an optional **error anchor** (from `lastError`) with an optional **live
retry sub-line** (from `retryState`) WITHIN the same card body. There SHALL NOT be a separate
red card and a separate amber card for one failure. There SHALL be NO `limit-exceeded` surface
state.

Surface states:

- **retry pending** (one card): `retryState` set with `waiting: true`. Header shows the error
  text (or `retryState.reason`); the same card shows the waiting sub-line — bare attempt
  number, countdown or elapsed — plus Copy. The surface renders no Stop and no collapse control.
- **retry in flight** (one card): `retryState` set with `waiting: false`. As above with the
  animated indicator and an in-flight sub-line.
- **error only** (one card, settled): `lastError` set, `retryState` undefined. Shows message +
  Copy + state-clearing dismiss.
- **hidden**: neither field set → nothing rendered.

There SHALL be NO collapsed one-line pill state.

The error anchor SHALL persist while a retry runs on top of it; the surface SHALL clear only
when `lastError` clears and `retryState` is undefined.

#### Scenario: Error and retry render in a single card

- **WHEN** `SessionState.lastError = { message: "overloaded_error", timestamp: 0 }` AND
  `SessionState.retryState = { attempt: 2, waiting: false, delayMs: 4000, reason: "overloaded", startedAt: 0, maxAttempts: 3 }`
- **THEN** the surface SHALL render exactly ONE card element containing the error message
- **AND** the SAME card SHALL contain the retry sub-line for attempt 2
- **AND** the surface SHALL NOT render two separate sibling card elements

#### Scenario: Waiting sub-state renders as a pending retry

- **WHEN** `retryState.waiting` is `true`
- **THEN** the card SHALL render the waiting sub-line
- **AND** the card SHALL NOT render a Stop retrying control or a collapse control

#### Scenario: Surface uses severity tokens via InlineMessage

- **WHEN** the settled-error surface is rendered
- **THEN** its background, border, and foreground SHALL resolve from `--severity-error-*`
  tokens through the shared `InlineMessage` primitive
- **AND** the surface SHALL NOT apply raw `red-500`/`amber-500` color literals

#### Scenario: Billing error renders as an ordinary error

- **WHEN** `SessionState.lastError = { message: "usage_limit_reached", timestamp: 1 }` AND
  `retryState` is undefined
- **THEN** the surface SHALL render the ordinary settled-error card
- **AND** the surface SHALL NOT render any `limit-exceeded` variant

#### Scenario: Hidden when neither field is set

- **WHEN** `SessionState.retryState` is undefined AND `SessionState.lastError` is undefined
- **THEN** the `SessionBanner` SHALL render nothing (no DOM)

### Requirement: Banner is observe-only: no abort control, no collapse

The banner SHALL NOT render any session-abort control. The always-present session Stop (outside
the banner) is the sole abort entry point, and it ends pi's retry chain. There SHALL be NO
"Stop retrying" control in the banner.

While a `retry` sub-status is carried, the surface SHALL NOT render a dismiss control — it
offers Copy only. The surface clears only via its own lifecycle: when `retryState` clears and
`lastError` clears (a confirmed-good resume). A state-clearing dismiss (`error-banner-dismiss`,
`mdiClose`, invoking the clear-only `onDismiss`) SHALL be offered ONLY when no `retry`
sub-status is carried. There SHALL be NO collapse control and NO collapsed pill.

The settled surface SHALL NOT render a Retry control. The removed `findLastUserPrompt` →
`send_prompt` re-send SHALL NOT return, and no replacement re-drive SHALL be introduced: the
dashboard has no mechanism to re-run a settled turn without appending input.

#### Scenario: No abort control in the banner while retrying

- **GIVEN** the surface carries a `retry` sub-status
- **THEN** the banner SHALL NOT render a Stop retrying control
- **AND** the banner SHALL NOT render a dismiss control or a collapse control
- **AND** the banner SHALL render the retry status sub-line and Copy

#### Scenario: Session Stop ends a pending retry

- **GIVEN** a retry is pending
- **WHEN** the user activates the always-present session Stop (outside the banner)
- **THEN** pi's retry chain SHALL be ended

#### Scenario: Settled error offers a state-clearing dismiss

- **GIVEN** `lastError` is set AND `retryState` is undefined
- **WHEN** the user activates the dismiss control
- **THEN** `onDismiss` SHALL fire, clearing `lastError`
- **AND** NO `abort` message SHALL be dispatched


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
  text (or `retryState.reason`); the same card shows the waiting sub-line — a spinner plus the
  attempt number and a countdown or elapsed suffix — plus Copy. The surface renders no Stop.
- **retry in flight** (one card): `retryState` set with `waiting: false`. As above with the
  animated indicator; the spinner carries the in-flight signal and the suffix is omitted.
- **retry collapsed** (one compact row): the user collapsed the surface while a retry is
  pending. Shows the spinner and attempt status only, plus a control to re-expand.
- **error only** (one card, settled): `lastError` set, `retryState` undefined. Shows message +
  Copy + state-clearing dismiss.
- **hidden**: neither field set → nothing rendered.

A collapsed one-line row SHALL exist ONLY while a retry is pending, and SHALL be entered only
by explicit user action. It is component-local view state; see *Trailing control states its own
action*.

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
- **AND** the card SHALL NOT render a Stop retrying control

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

### Requirement: Banner is observe-only: no abort control

The banner SHALL NOT render a session-abort control. The always-present session Stop outside the banner is the sole abort entry point and ends pi's retry chain. A trailing state-clearing dismiss SHALL be offered only for a settled provider error. While a retry is active, the trailing control SHALL be view-only Collapse/Expand.

A settled provider error SHALL offer a one-shot Retry action through the supplied retry callback. Retry SHALL continue the session without replaying input. The banner SHALL hide after confirmed recovery or user abort.

#### Scenario: Pending retry uses external session Stop

- **GIVEN** the surface carries a retry sub-status
- **THEN** the banner SHALL not render an abort or Stop retrying control
- **AND** the external session Stop SHALL remain available

#### Scenario: Settled error actions are Retry, Copy, and Dismiss

- **GIVEN** `lastError` is set and no retry sub-status is active
- **THEN** the banner SHALL render Retry and Copy actions
- **AND** it SHALL render the state-clearing dismiss X
- **AND** no abort command SHALL be dispatched by Dismiss

#### Scenario: Missing retry callback omits Retry only

- **GIVEN** a settled provider error is rendered without a retry callback
- **THEN** Retry SHALL be absent
- **AND** Copy and the dismiss X SHALL remain available

#### Scenario: Session Stop ends a pending retry

- **GIVEN** a retry is pending
- **WHEN** the user activates the always-present session Stop (outside the banner)
- **THEN** pi's retry chain SHALL be ended

#### Scenario: Settled error offers a state-clearing dismiss

- **GIVEN** `lastError` is set AND `retryState` is undefined
- **WHEN** the user activates the dismiss control
- **THEN** `onDismiss` SHALL fire, clearing `lastError`
- **AND** NO `abort` message SHALL be dispatched

### Requirement: Trailing control states its own action

The surface's trailing control SHALL be present in every visible state, and its icon, accessible label, and test id SHALL identify the action it performs. A control that does not close the surface SHALL NOT be rendered as a close affordance.

| Phase | Icon | Label | Test id | Effect |
|---|---|---|---|---|
| retry pending, expanded | `mdiChevronUp` | Collapse | `error-banner-collapse` | collapse to the compact row |
| retry pending, collapsed | `mdiChevronDown` | Show error | `error-banner-expand` | restore the full card |
| settled provider error | `mdiClose` | Dismiss | `error-banner-dismiss` | clear the settled error surface |

While a retry is pending the trailing control SHALL collapse the surface using component-local state. It SHALL NOT invoke the dismiss callback or mutate retry/error state. The surface SHALL clear automatically when a resumed attempt produces a confirmed non-error assistant completion.

Once retrying stops with a provider error, the surface SHALL re-expand, render Retry plus the trailing dismiss X, and retain Copy. Retry SHALL disable after its first activation and remain disabled until error/retry lifecycle state changes, preventing duplicate turn requests. When the user aborts an active retry chain or the session is confirmed terminated, the entire surface SHALL hide; no X-only post-abort or post-termination card SHALL remain. Every terminal state SHALL therefore be either dismissible (provider error) or hidden (success/abort/termination); the component SHALL NOT render a terminal banner with only a retry-phase control or no closing path.

#### Scenario: Collapse control while retry is waiting

- **GIVEN** a retry sub-status is waiting
- **THEN** the surface SHALL render `error-banner-collapse`
- **AND** it SHALL not render `error-banner-dismiss` or Retry

#### Scenario: Collapse control while retry attempt is in flight

- **GIVEN** a retry sub-status is in flight
- **THEN** the surface SHALL render `error-banner-collapse`
- **AND** it SHALL not render `error-banner-dismiss` or Retry

#### Scenario: Collapsing does not change lifecycle state

- **GIVEN** a retry is pending
- **WHEN** the user activates Collapse
- **THEN** no dismiss, abort, Retry, or stop command SHALL be dispatched
- **AND** the attempt status SHALL remain available in the compact row

#### Scenario: Settled provider error shows Retry and X

- **GIVEN** `lastError` is set and no retry sub-status is active
- **THEN** the expanded surface SHALL render Retry, Copy, and `error-banner-dismiss`
- **AND** the trailing icon SHALL be `mdiClose`

#### Scenario: Successful automatic continuation removes the surface

- **GIVEN** the surface is visible for a pending retry
- **WHEN** the resumed attempt produces a confirmed non-error assistant completion
- **THEN** the surface SHALL become hidden without user action

#### Scenario: User abort removes the surface

- **GIVEN** the surface is visible for a pending retry
- **WHEN** the user activates the session Stop control
- **THEN** the surface SHALL become hidden
- **AND** it SHALL not reappear as a settled or X-only card for the cancelled chain

#### Scenario: Confirmed session termination removes the surface

- **GIVEN** the surface is visible for retry or error state
- **WHEN** the session is confirmed removed after clean shutdown or process kill
- **THEN** the surface SHALL become hidden
- **AND** no X-only post-termination card SHALL remain

#### Scenario: Terminal provider error cannot remain stuck in retry presentation

- **GIVEN** the surface was expanded or collapsed while retrying
- **WHEN** retrying stops and the provider error remains
- **THEN** the surface SHALL re-expand with Retry, Copy, and `error-banner-dismiss`
- **AND** no collapse-only terminal presentation SHALL remain

#### Scenario: Collapsed row keeps the attempt status and can be re-expanded

- **GIVEN** the surface was collapsed while retrying attempt 2
- **THEN** the collapsed row SHALL show the attempt status
- **AND** it SHALL render `error-banner-expand`
- **WHEN** a waiting signal for attempt 3 arrives
- **THEN** the row SHALL remain collapsed
- **AND** the attempt status SHALL read attempt 3

#### Scenario: Dismiss control on a settled error

- **GIVEN** `lastError` is set AND `retryState` is undefined
- **THEN** the surface SHALL render `error-banner-dismiss`
- **AND** it SHALL NOT render `error-banner-collapse`
- **WHEN** the user activates it
- **THEN** the dismiss callback SHALL be invoked

#### Scenario: A collapsed surface re-expands when retrying stops

- **GIVEN** the surface is collapsed while a retry is pending
- **WHEN** `retryState` clears while `lastError` remains
- **THEN** the surface SHALL render expanded
- **AND** it SHALL render `error-banner-dismiss`

#### Scenario: No stop-retrying affordance exists

- **WHEN** the surface is rendered in any state
- **THEN** no control labelled or acting as "stop retrying" SHALL be present

### Requirement: Retry status is a spinner plus a short label

The retry sub-line SHALL lead with an animated spinner (`mdiLoading`) coloured from
`--severity-warning-fg`, followed by a short label.

The label SHALL read `Retry {attempt}` with a countdown or elapsed suffix while waiting, and
`Retry {attempt}` with no suffix while an attempt is in flight — the spinner carries the
in-flight signal. It SHALL NOT spell out "attempt", "next attempt in" or "retrying now".

The attempt number SHALL be conveyed as text, never by motion or colour alone, so the state
survives `prefers-reduced-motion` and greyscale.

#### Scenario: Waiting shows the spinner, attempt and countdown
- **GIVEN** `retryState` is set with `waiting: true` and a `nextAttemptAt` 12 seconds away
- **THEN** the sub-line SHALL render a spinner
- **AND** it SHALL read the attempt number and a 12-second suffix

#### Scenario: In flight shows the spinner and attempt only
- **GIVEN** `retryState` is set with `waiting: false`
- **THEN** the sub-line SHALL render a spinner
- **AND** it SHALL NOT render a countdown suffix

#### Scenario: Attempt number survives without motion
- **GIVEN** the user has `prefers-reduced-motion: reduce` set
- **THEN** the attempt number SHALL remain readable as text

### Requirement: Settled-error Retry is dispatched as a typed protocol message

The settled-error **Retry** action SHALL be dispatched as a first-class
`retry_session` protocol message `{ type: "retry_session"; sessionId: string }`,
NOT by sending a `send_prompt` whose `text` is the sentinel `/__dashboard_retry`.
The message SHALL traverse three hops, each of which SHALL carry the type: the
browser→server union (`browser-protocol.ts`), the server→bridge union
(`protocol.ts` `ServerToExtensionMessage`), and the server gateway routing that
forwards a browser `retry_session` to the owning session bridge. The underlying
pi call the bridge makes SHALL remain
`pi.sendMessage({ customType: "pi-dashboard:retry", display: false },
{ triggerTurn: true })` — this change alters the transport, not the pi call.

The client SHALL preserve the pre-dispatch stale-click guard: it SHALL NOT
dispatch when `lastError` is absent, or `retryState` is set, or `retryCancelled`
is set, or `isStreaming` is true.

#### Scenario: Client dispatches retry_session, not the sentinel prompt
- **GIVEN** a session with `lastError` set, `retryState` undefined,
  `retryCancelled` false, `isStreaming` false
- **WHEN** the user activates the settled-error Retry control
- **THEN** the client SHALL send `{ type: "retry_session", sessionId }`
- **AND** it SHALL NOT send a `send_prompt` carrying `/__dashboard_retry`

#### Scenario: Stale-click guard blocks dispatch in every ineligible state
- **WHEN** Retry is activated while ANY of: `lastError` absent, `retryState`
  set, `retryCancelled` set, or `isStreaming` true
- **THEN** the client SHALL send no `retry_session` message

#### Scenario: Server forwards retry_session to the owning bridge
- **GIVEN** a browser `retry_session { sessionId }` for a live, bridged session
- **WHEN** the server gateway receives it
- **THEN** it SHALL forward a `retry_session` to that session's bridge
- **AND** it SHALL NOT drop it through the unknown-type default path

#### Scenario: Bridge re-drives the turn via the custom-message primitive
- **GIVEN** the bridge receives `retry_session` for an idle settled session
- **WHEN** it handles the message
- **THEN** it SHALL call `pi.sendMessage({ customType: "pi-dashboard:retry",
  display: false }, { triggerTurn: true })`
- **AND** a native `agent_start` for the re-driven turn SHALL follow
- **AND** no user message SHALL be appended or replayed

### Requirement: A manual retry is not mapped onto the auto-retry surface

A `retry_session`-initiated turn SHALL NOT render pi's auto-retry attempt
counter. The bridge SHALL guard against a still-armed `RetryTracker` chain
converting the manual turn's `agent_start` into a synthetic `auto_retry_start`.

#### Scenario: Armed tracker chain does not synthesize a counter for a manual retry
- **GIVEN** a `RetryTracker` chain is still armed for the session
- **WHEN** the manual `retry_session` turn emits `agent_start`
- **THEN** the bridge SHALL NOT forward a synthetic `auto_retry_start` for it
- **AND** no attempt counter SHALL render on the banner

#### Scenario: Dispatch failure surfaces as an error, not a counter
- **GIVEN** `pi.sendMessage` throws synchronously OR rejects asynchronously
- **WHEN** the bridge handles the failure
- **THEN** it SHALL forward `auto_retry_end { success: false, attempt: 0,
  finalError }`
- **AND** the banner SHALL show the error with no attempt counter

### Requirement: Undeliverable retry is negatively acked, never silently dropped

When the server or bridge cannot deliver a `retry_session` (unknown or
disconnected session, or a bridge lacking the handler), it SHALL emit a
structured `retry_session_error` to the sender (mirroring `plugin_action_error`),
never a silent drop. The client SHALL re-enable the one-shot Retry control and
surface a toast on receipt.

#### Scenario: Unknown/disconnected session yields a structured error
- **GIVEN** a `retry_session` for a session with no reachable bridge
- **WHEN** the server processes it
- **THEN** it SHALL send `retry_session_error { sessionId, error }` to the sender
- **AND** the client SHALL re-enable Retry and toast the error

### Requirement: The /__dashboard_retry sentinel remains a deprecated alias

For backward compatibility with un-upgraded clients during a version-skew
window, the bridge SHALL continue to accept a `send_prompt` whose `text` equals
`/__dashboard_retry` and route it to the same retry handler as `retry_session`.
The alias SHALL NOT be removed in this change; removal is a separate change after
clients are known upgraded.

#### Scenario: Legacy sentinel still triggers a retry
- **GIVEN** an older client sends `send_prompt { text: "/__dashboard_retry" }`
- **WHEN** the bridge parses it
- **THEN** it SHALL invoke the same retry dispatch as `retry_session`
- **AND** it SHALL NOT append or replay the sentinel as a user message


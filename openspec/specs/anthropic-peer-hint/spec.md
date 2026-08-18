# anthropic-peer-hint Specification

## Purpose
TBD - created by archiving change warn-missing-anthropic-messages-peer. Update Purpose after archive.
## Requirements
### Requirement: Missing-peer hint on the authenticated Anthropic OAuth row
The `anthropic` OAuth provider row in Provider Authentication SHALL render an inline advisory hint
naming `@blackbelt-technology/pi-anthropic-messages` with an install affordance, whenever that row
is authenticated and the bridge probe reports that peer as not resolving.

#### Scenario: Authenticated anthropic row with the peer probe failing
- **WHEN** the `anthropic` OAuth row renders with `authenticated: true` and `/api/health` reports a
  `flows-anthropic-bridge` plugin whose `lastProbe.peers["@pi/anthropic-messages"].ok` is `false`
- **THEN** the row renders a hint naming `@blackbelt-technology/pi-anthropic-messages` together
  with an install affordance

#### Scenario: Hint appears on an already-connected row at page load
- **WHEN** the providers tab loads, the `anthropic` row is already authenticated, and the probe
  reports the peer as not resolving
- **THEN** the hint renders without requiring a fresh sign-in

#### Scenario: Peer resolving
- **WHEN** `lastProbe.peers["@pi/anthropic-messages"].ok` is `true`
- **THEN** no hint is rendered

### Requirement: Probe is the sole signal and every other shape fails open
`peerMissing` SHALL be derived only from `lastProbe.peers["@pi/anthropic-messages"].ok === false`
on the `flows-anthropic-bridge` plugin row. Any other state — request not yet resolved, failed
`/api/health` request, no `flows-anthropic-bridge` row, no `lastProbe`, no such peer key — SHALL
render no hint. The bridge's overall `lastProbe.status` SHALL NOT be used as the signal.

#### Scenario: Health request still loading
- **WHEN** the `/api/health` request has not resolved
- **THEN** no hint is rendered

#### Scenario: Health request failed
- **WHEN** the `/api/health` request returned an error or a non-OK status
- **THEN** no hint is rendered

#### Scenario: Bridge plugin not installed
- **WHEN** `/api/health` reports no `flows-anthropic-bridge` plugin row
- **THEN** no hint is rendered

#### Scenario: No probe emitted yet
- **WHEN** the `flows-anthropic-bridge` row carries no `lastProbe` (no pi session has emitted
  status)
- **THEN** no hint is rendered

#### Scenario: waiting_peers caused by the other peer
- **WHEN** `lastProbe.status` is `"waiting_peers"` because `peers["pi-flows"].ok` is `false`, while
  `peers["@pi/anthropic-messages"].ok` is `true`
- **THEN** no hint is rendered

### Requirement: Hint gated on the authenticated state
The hint SHALL NOT render on a signed-out `anthropic` row.

#### Scenario: Signed-out anthropic row
- **WHEN** the `anthropic` OAuth row renders with `authenticated: false` and the probe reports the
  peer as not resolving
- **THEN** no hint is rendered

### Requirement: Hint scoped to the anthropic OAuth provider
No provider other than the `anthropic` OAuth row SHALL render the hint.

#### Scenario: Another OAuth provider
- **WHEN** an authenticated `openai-codex` or `github-copilot` OAuth row renders while the probe
  reports the peer as not resolving
- **THEN** no hint is rendered

#### Scenario: API-key row
- **WHEN** an `anthropic-api` (or any other `api_key` flow) row renders while the probe reports the
  peer as not resolving
- **THEN** no hint is rendered

### Requirement: Hint is advisory and non-blocking
The hint SHALL NOT gate any existing provider-authentication behaviour: the Connected marker, the
expiry countdown, Sign In and Sign Out SHALL remain fully available while the hint is shown, and
the hint SHALL NOT be presented as a modal.

#### Scenario: Row remains usable with the hint shown
- **WHEN** the hint is rendered on the authenticated `anthropic` row
- **THEN** the Sign Out control remains enabled and the Connected marker and expiry are unchanged

### Requirement: Install affordance enqueues the scoped package and reports its outcome
The install affordance SHALL enqueue a global install of
`npm:@blackbelt-technology/pi-anthropic-messages`, SHALL reflect the in-flight state of that
operation, and SHALL surface a failed install rather than leaving the control inert.

#### Scenario: Operator installs the peer from the hint
- **WHEN** the operator activates the install affordance
- **THEN** an install of `npm:@blackbelt-technology/pi-anthropic-messages` is enqueued in global
  scope

#### Scenario: Install in flight
- **WHEN** the enqueued operation is queued or running
- **THEN** the affordance reflects that state and cannot enqueue a duplicate operation

#### Scenario: Install fails
- **WHEN** the enqueued operation reports an error for that source
- **THEN** the hint renders the error message for that source

### Requirement: The hint clears through a fresh probe
The surface SHALL disappear when a later probe reports the peer as resolving, without a page
reload. The probe state SHALL be re-read on package-operation completion, on window focus, and on a
poll running while the section is mounted.

#### Scenario: Fresh probe reports the peer resolving
- **WHEN** a later probe reports `peers["@pi/anthropic-messages"].ok` as `true`
- **THEN** the surface is no longer rendered, with no page reload

#### Scenario: Probe re-read without a page reload
- **WHEN** a package operation completes, or the window regains focus
- **THEN** the probe state is re-read from `/api/health`

#### Scenario: First probe arrives on an open, focused tab
- **WHEN** the section is mounted and focused with no probe available, a pi session starts and emits
  the first probe reporting the peer as not resolving, and no package operation or focus change
  occurs
- **THEN** the hint appears within one poll interval

#### Scenario: Poll stops with the section
- **WHEN** the section unmounts
- **THEN** no further `/api/health` requests are issued on its behalf

### Requirement: Completed install latches an informational state until the probe catches up
A successful install SHALL switch the surface to an informational message stating the peer is
installed and applies on the next pi session start, and SHALL withdraw the install affordance. That
state SHALL persist until the probe reports the peer as resolving — it SHALL NOT be derived from the
package queue's transient success state, which auto-clears after three seconds.

#### Scenario: Install completes while the probe still reports the peer missing
- **WHEN** the install completes successfully and the probe still reports
  `peers["@pi/anthropic-messages"].ok` as `false`
- **THEN** the row renders an informational message that the peer is installed and applies on the
  next pi session start, and no longer presents the install affordance

#### Scenario: Informational state outlives the queue's success window
- **WHEN** more than the package queue's success auto-clear window has elapsed since the successful
  install and the probe still reports the peer as not resolving
- **THEN** the informational message is still rendered and the install affordance is still withdrawn

### Requirement: An import failure is reported, not offered as an install
When the probe reports the peer as not resolving with a `reason` beginning `import failed:`, the
surface SHALL report that reason and SHALL NOT offer the install affordance. Every other `ok: false`
shape SHALL keep the install affordance.

#### Scenario: Resolve succeeded but import threw
- **WHEN** `peers["@pi/anthropic-messages"]` is `{ ok: false, reason: "import failed: Unexpected
  token" }`
- **THEN** the row reports the failure reason and presents no install affordance

#### Scenario: Not-found reason keeps the install affordance
- **WHEN** `peers["@pi/anthropic-messages"]` is `{ ok: false, reason: "MODULE_NOT_FOUND" }`, or
  carries no `reason` at all
- **THEN** the install affordance is presented

#### Scenario: The bridge still emits the coupled prefix
- **WHEN** the bridge's peer probe fails at the import step
- **THEN** the emitted `reason` begins with `import failed:`


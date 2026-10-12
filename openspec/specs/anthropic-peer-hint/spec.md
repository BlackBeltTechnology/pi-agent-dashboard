# anthropic-peer-hint Specification

## Purpose
Surface, inline on the authenticated Anthropic OAuth row, when the `flows-anthropic-bridge` peer
probe reports the `@pi/anthropic-messages` peer as unresolved — with a one-click install — so an
operator who has connected Claude but is missing the bridge peer sees the remaining step instead of
silently landing in `waiting_peers`. The signal is derived strictly from the bridge probe on
`/api/health`; every other shape fails open (renders nothing).

## Requirements

### Requirement: Missing-peer hint on the authenticated Anthropic OAuth row
The `anthropic` OAuth provider row in Provider Authentication SHALL render an inline advisory hint naming `@blackbelt-technology/pi-anthropic-messages`, with an install affordance, whenever that row is authenticated and the bridge probe reports that peer as not resolving. There are two exceptions:
- While an automatic install is deciding, in progress, failed or succeeded, the automatic-install surface is rendered instead, so the row never shows two install surfaces.
- A probe reason reporting an import failure always renders the hint's import-failure form, which replaces any automatic-install state on the row.

#### Scenario: Authenticated anthropic row with the peer probe failing
- **WHEN** the `anthropic` OAuth row renders with `authenticated: true` and `/api/health` reports a
  `flows-anthropic-bridge` plugin whose `lastProbe.peers["@pi/anthropic-messages"].ok` is `false`
- **AND** no automatic-install state exists
- **THEN** the row renders a hint naming `@blackbelt-technology/pi-anthropic-messages` together
  with an install affordance

#### Scenario: Hint appears on an already-connected row at page load
- **WHEN** the providers tab loads, the `anthropic` row is already authenticated, and the probe
  reports the peer as not resolving
- **THEN** the hint renders without requiring a fresh sign-in

#### Scenario: Peer resolving
- **WHEN** `lastProbe.peers["@pi/anthropic-messages"].ok` is `true`
- **THEN** no hint is rendered

#### Scenario: Automatic install takes precedence on the row
- **GIVEN** an automatic install is deciding, in progress, failed or succeeded
- **WHEN** the probe reports the peer as not resolving without an import-failure reason
- **THEN** only the automatic-install surface is rendered on the row

#### Scenario: Import failure overrides any automatic-install state
- **GIVEN** an automatic-install state exists
- **WHEN** a probe reports the peer found but failing to import
- **THEN** the row renders the hint's import-failure form and no automatic-install surface

### Requirement: Probe is the sole signal and every other shape fails open
`peerMissing`, and therefore the missing-peer hint, SHALL be derived only from
`lastProbe.peers["@pi/anthropic-messages"].ok === false` on the `flows-anthropic-bridge` plugin row.
In any other state, the hint SHALL NOT render:
- request not yet resolved;
- failed `/api/health` request;
- no `flows-anthropic-bridge` row;
- no `lastProbe`;
- no such peer key.

The bridge's overall `lastProbe.status` SHALL NOT be used as the signal. This requirement governs the
missing-peer hint only. The automatic-install surface and its decision are governed by their own
requirements and may render without a probe.

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
The hint SHALL render only on an `anthropic` row that holds a credential. Because the providers
section lists only providers that hold a credential, a signed-out `anthropic` row is no longer
rendered at all; the gate therefore holds by construction, and the hint SHALL NOT be attached to any
surface that represents an unconfigured provider — in particular the Add-provider picker and its
panes.

#### Scenario: Signed-out anthropic row
- **WHEN** `anthropic` holds no credential and the probe reports the peer as not resolving
- **THEN** no `anthropic` row is rendered
- **AND** no hint is rendered

#### Scenario: Hint is absent from the Add-provider surfaces
- **WHEN** the operator opens the Add-provider dialog and selects Anthropic
- **THEN** no missing-peer hint is rendered in the picker or the pane

#### Scenario: Hint renders on the connected anthropic row
- **WHEN** `anthropic` holds an OAuth credential and the probe reports the peer as not resolving
- **THEN** the hint is rendered on that row

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
expiry countdown and Sign Out SHALL remain fully available while the hint is shown, and
the hint SHALL NOT be presented as a modal. Sign-in is no longer a row control — it is reached from
the Add-provider dialog — and the hint SHALL NOT gate that path either.

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

### Requirement: Peer is installed automatically on a fresh Anthropic subscription sign-in
When the `anthropic` subscription OAuth flow completes in Provider Authentication while that section is mounted, the client SHALL make one install decision for that completion. The sign-in SHALL NOT be blocked, delayed or rolled back while deciding or installing.

The install SHALL be a global install of the fixed source `npm:@blackbelt-technology/pi-anthropic-messages`, the same source and scope as the hint's install affordance. Neither SHALL be derived from any response or input.

The decision SHALL use fresh reads of the bridge probe and of the server's recommended-extension state, and the first matching rule SHALL apply:
1. the probe reports the peer (key `@pi/anthropic-messages`) as found but failing to import → no install;
2. the probe reports the peer resolving → no install;
3. the recommended-extension state cannot be read within a bounded time, or has no `pi-anthropic-messages` entry → no install;
4. the recommended-extension state reports the peer active in pi → no install;
5. an install of the peer source is already queued or running → no new operation; the automatic-install state follows that install;
6. otherwise → enqueue the install.

A later, separate completion of the same flow SHALL be decided afresh. None of the following SHALL trigger a decision:
- completions of other providers;
- API-key saves;
- custom-endpoint saves;
- page loads with an already-connected row.

#### Scenario: First run, peer not active
- **GIVEN** no pi session has emitted a bridge probe
- **AND** the recommended-extension state reports `pi-anthropic-messages` as not active in pi
- **WHEN** the `anthropic` subscription sign-in completes
- **THEN** a global install of `npm:@blackbelt-technology/pi-anthropic-messages` is enqueued without a further click

#### Scenario: Peer already active
- **WHEN** the sign-in completes and the recommended-extension state reports the peer active in pi
- **THEN** no install is enqueued

#### Scenario: Probe reports the peer resolving
- **WHEN** the sign-in completes and a fresh probe reports the peer resolving (for example through a workspace `node_modules`) while the recommended-extension state reports it not active
- **THEN** no install is enqueued

#### Scenario: Stale probe after an earlier install
- **GIVEN** the probe still reports the peer as not resolving (no pi session has started since it was installed)
- **AND** the recommended-extension state reports it active in pi
- **WHEN** the sign-in completes
- **THEN** no install is enqueued

#### Scenario: Import failure vetoes the install
- **WHEN** the sign-in completes and the probe reports the peer found but failing to import
- **THEN** no install is enqueued

#### Scenario: Recommended state unavailable
- **WHEN** the sign-in completes and the recommended-extension request fails
- **THEN** no install is enqueued and the sign-in remains successful

#### Scenario: Install already pending elsewhere
- **WHEN** the sign-in completes while an install of the peer source, started from another surface, is queued or running
- **THEN** no second operation is enqueued
- **AND** the automatic-install state shows that operation as in progress and then reflects its outcome

#### Scenario: Other credential writes never auto-install
- **WHEN** a non-`anthropic` OAuth flow completes, an `anthropic-api` key or any other API key is saved, a custom endpoint is saved, or the providers tab loads with `anthropic` already connected
- **THEN** no automatic install is enqueued

#### Scenario: Sign in again after signing out
- **GIVEN** an earlier completion already decided
- **WHEN** the operator signs out of `anthropic` and completes the sign-in again
- **THEN** the new completion is decided afresh

### Requirement: Automatic install progress and outcome are visible on the Anthropic row
From the moment a decision starts until the page reloads or `anthropic` stops being authenticated, the authenticated `anthropic` row SHALL show the automatic install's state, whether or not a bridge probe exists, except where a probe reports an import failure (the missing-peer hint's import-failure form then replaces it):
- **deciding, queued or running:** an in-progress status;
- **succeeded:** an informational message that the peer is installed and applies on the next pi session start. It SHALL remain until the page reloads, `anthropic` stops being authenticated, or a probe reports the peer resolving;
- **failed:** until the page reloads, `anthropic` stops being authenticated, or a probe reports the peer resolving: a warning whose first sentence says the install did not finish and invites a retry, mentioning the network or proxy only as a possible cause. It SHALL offer a retry install affordance, and SHALL show the raw installer output only inside a collapsed log block.

A successful install of the peer source from any surface SHALL replace a failed state with the succeeded state; a successful remove or update of that source SHALL NOT be shown as installed. `anthropic` counts as no longer authenticated only after a successful status read reports it; a failed status read SHALL leave the state unchanged. A state change after the page has lost the `anthropic` connection SHALL NOT be shown. Each state change SHALL be announced politely to assistive technology. No state SHALL disable Sign Out.

#### Scenario: Install in progress on a first run
- **GIVEN** an automatic install was enqueued and no bridge probe exists
- **WHEN** the operation is queued or running
- **THEN** the `anthropic` row shows an in-progress status naming `pi-anthropic-messages`

#### Scenario: Install succeeds while settings is closed
- **GIVEN** an automatic install was enqueued
- **WHEN** it completes successfully while the providers section is not mounted, and the operator reopens it more than three seconds later
- **THEN** the row shows the informational installed message

#### Scenario: Installed message clears on a resolving probe
- **GIVEN** the row shows the informational installed message
- **WHEN** a probe reports the peer resolving
- **THEN** the message is no longer shown

#### Scenario: Install fails
- **WHEN** the automatic install reports an error
- **THEN** the row shows the warning with the plain-language first sentence and a retry install affordance
- **AND** the raw installer output is visible only after expanding the collapsed log block
- **AND** the row remains Connected with Sign Out enabled

#### Scenario: Failed state clears on a resolving probe
- **GIVEN** the row shows the failed warning
- **WHEN** a probe reports the peer resolving
- **THEN** neither the warning nor the retry affordance is shown

#### Scenario: Retry
- **WHEN** the operator activates retry install after a failure
- **THEN** the same global install is enqueued again, unless an operation for the source is already pending, and the row returns to the in-progress status

#### Scenario: Recovered from another surface
- **GIVEN** the automatic install failed
- **WHEN** the operator installs the peer successfully from another surface
- **THEN** the row shows the informational installed message instead of the warning

#### Scenario: Removal elsewhere is not shown as installed
- **GIVEN** the automatic install failed
- **WHEN** the operator removes the peer source from another surface and that operation succeeds
- **THEN** the row does not show the installed message

#### Scenario: Status read fails
- **GIVEN** an automatic-install state exists
- **WHEN** a provider-auth status read fails (network error or non-OK response)
- **THEN** the automatic-install state is retained

#### Scenario: Losing the Anthropic connection clears the state
- **GIVEN** an automatic install is running
- **WHEN** the operator signs out of `anthropic`, or the `anthropic` row otherwise reports not authenticated, and the install later completes
- **THEN** no automatic-install state is shown on any surface

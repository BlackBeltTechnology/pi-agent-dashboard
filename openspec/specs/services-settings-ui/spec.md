# services-settings-ui Specification

## Purpose
TBD - created by archiving change add-services-settings-ui. Update Purpose after archive.

## Requirements

### Requirement: Service list page
The `services` settings page SHALL list every service from `GET /api/services`,
one row each, showing id, mode, a state pill for its state, the driver, the
endpoints, exposure, live lease count, pinned marker, and badges for
`updateAvailable` and `restartRequired`. A service in `unavailable`, `failed`,
`blocked` or `stop-failed` SHALL show its `reason` as a human-readable sentence
and its `hint`. `failed` SHALL show the time remaining until `retryAt`. When the
list reports `definitionsCorrupt` or `secretsCorrupt`, the page SHALL show an
error banner naming the backup path. An empty list SHALL show an empty state
offering the add-service flow and naming the CLI equivalent. Rows SHALL be
grouped under the headings "Needs attention" (`unavailable`, `failed`,
`blocked`, `stop-failed`), "Running" (`healthy`, `idle`, `starting`,
`stopping`) and "Stopped", in that order, each with its count; an empty group
SHALL NOT render. The Services nav item SHALL carry an indicator, with a
text alternative, while any service needs attention.

#### Scenario: Unavailable service explains itself
- **WHEN** service `docling` is `unavailable` with reason `image-absent`
- **THEN** its row SHALL state that the container image is not present and SHALL show the server's hint

#### Scenario: Failing services are listed first
- **WHEN** the list holds one `healthy` and one `failed` service
- **THEN** the `failed` service SHALL appear under "Needs attention" above the "Running" group

#### Scenario: Corrupt definitions banner
- **WHEN** the list reports `definitionsCorrupt: true` with a backup path
- **THEN** the page SHALL show an error banner containing that path

### Requirement: Service detail page
`/settings/services/<id>` SHALL show the service's status, the `tried` drivers
with their reasons, endpoints, lease holders with expiry, declared secrets with
their source and configured state, the update diff when `updateAvailable`, and
a logs panel. Actions SHALL be offered only when legal for the current state per
the design gating table, and Pin/Unpin only for services whose `mode` is
`managed`. Force stop SHALL be offered only for reason `adoption-uncertain` and
for an instance with `startedBy: "external"`, the two cases where a plain stop
is refused, and in those cases a plain Stop SHALL NOT be offered. Reset data
SHALL be offered only for services that declare named volumes, and not for
reasons `adoption-uncertain`, `duplicate-instances` or `owner-conflict`. Lease holders SHALL render as plain
text. A refused action SHALL show the server's error code and hint at the
action; a 403 `operate_required` SHALL show its reason and remedies there
instead of a toast. When the list reports `canOperate: false`, every action
SHALL be disabled and one banner SHALL explain why and offer the remedies.

#### Scenario: Try again after fixing the cause
- **WHEN** the detail of a service `unavailable` with reason `runtime-unreachable` is shown
- **THEN** a "Try again" action SHALL be offered that sends `POST /api/services/:id/start`
- **AND** it SHALL NOT be offered for reasons `adoption-uncertain`, `duplicate-instances` or `owner-conflict`

#### Scenario: Retry only when failed
- **WHEN** the detail of a `failed` service is shown
- **THEN** Retry SHALL be offered and Start SHALL NOT

#### Scenario: Force stop only where a plain stop is refused
- **WHEN** the detail of a service `unavailable` with reason `adoption-uncertain` is shown
- **THEN** a Force stop action SHALL be offered behind a confirmation that explains the safety check it overrides
- **AND** a plain Stop SHALL NOT be offered

#### Scenario: Duplicate instances can be stopped
- **WHEN** the detail of a service `unavailable` with reason `duplicate-instances` is shown
- **THEN** Stop SHALL be offered and Force stop SHALL NOT

#### Scenario: Holder name stays text
- **WHEN** a lease holder is `<img src=x onerror=alert(1)>`
- **THEN** it SHALL be shown literally and no script SHALL run

#### Scenario: Read-only caller sees disabled actions
- **WHEN** `GET /api/services` reports `canOperate: false` and the user opens a service detail
- **THEN** the actions SHALL be disabled and one banner SHALL explain why and offer the remedies

### Requirement: Live updates through refetch
The services pages SHALL refetch `GET /api/services`, after a random delay
of 100 to 400 ms, on every `services_changed` message and on WebSocket reconnect, and the open detail SHALL
render its state, lease holders and secrets from that list entry. The detail
SHALL request `GET /api/services/:id`, which re-probes the instance, only when
it opens and when the user asks to refresh. The pages SHALL NOT poll on a
timer.

#### Scenario: A notification does not re-probe
- **WHEN** a `services_changed` message arrives while a detail is open
- **THEN** the client SHALL request `GET /api/services` and SHALL NOT request `GET /api/services/:id`

#### Scenario: State change appears without reload
- **WHEN** a service shown as `starting` becomes `healthy` on the server
- **THEN** the row SHALL show `healthy` after the next `services_changed` refetch without a page reload

### Requirement: Add service with explicit review
The add flow SHALL offer two sources: a discovered offer from
`GET /api/services/offers`, or a pasted JSON definition. Either SHALL first call
`POST /api/services` with `dryRun: true` and render the review (image or recipe,
ports, volumes, binds, secrets with their sources). Only an explicit Confirm
SHALL send `dryRun: false`. Prefetch SHALL be a separate, unchecked option and
SHALL NOT be implied by Confirm. Validation errors SHALL be listed one per line.

#### Scenario: Confirm does not prefetch
- **WHEN** the user confirms adding a native offer without ticking prefetch
- **THEN** no prefetch request SHALL be sent

#### Scenario: Invalid pasted definition
- **WHEN** the pasted JSON has an unknown key
- **THEN** the dry-run errors SHALL be listed and Confirm SHALL be unavailable

### Requirement: Write-only secret entry
For each store-backed secret, the detail SHALL provide a password input that
sends `PUT /api/services/:id/secrets/:name` and then clears. The UI SHALL NOT
display, retain after submit, or request any secret value. Non-store secrets
SHALL show their reference read-only.

#### Scenario: Input clears after save
- **WHEN** the user saves a value for secret `token`
- **THEN** the input SHALL be empty and the secret SHALL show as configured

### Requirement: Destructive actions require specific confirmation
Remove SHALL list what will be removed and offer an unchecked "also delete data
volumes" option naming each volume. Reset data SHALL require typing the service
id. Prune SHALL always show the dry-run list, including runtimes that could not
be checked, before confirming; the confirm SHALL send exactly the previewed ids
and SHALL report any skipped ones.

#### Scenario: Reset requires typed id
- **WHEN** the user opens reset-data for `docling`
- **THEN** the confirm button SHALL stay disabled until `docling` is typed

#### Scenario: Remove keeps volumes by default
- **WHEN** the user confirms Remove without ticking the volumes option
- **THEN** the request SHALL NOT carry `purgeData`

### Requirement: Logs viewer
The detail SHALL show a logs panel that requests `GET /api/services/:id/logs`
with a tail length chosen from 200, 500 or 2000 and refreshes only on demand. It
SHALL render `available: false` reasons as a sentence, naming the secret and
linking to its input when the reason concerns a secret. Lines SHALL render as
text, never as HTML. Redaction markers (`«secret:<name>»`) SHALL be
visually distinguished. Output with `stale: true` SHALL be labelled as coming
from the last run. When the list reports `canOperate: false`, the panel SHALL
say that output needs operate authority, and no request SHALL be sent.

#### Scenario: Markup in output stays text
- **WHEN** a log line contains `<script>alert(1)</script>`
- **THEN** it SHALL be shown literally and no script SHALL run

#### Scenario: External service has no logs
- **WHEN** the logs route returns `available: false` with reason `external`
- **THEN** the panel SHALL explain that the dashboard does not run this service and has no output for it

### Requirement: Runtimes page
The `runtimes` page SHALL render each entry of `GET /api/services/runtimes`:
installed, version, reachable, host-VM state, and the capability values as a
matrix. The page SHALL offer no control that starts or stops a host VM or
hypervisor.

#### Scenario: Unreachable docker
- **WHEN** docker is installed but unreachable
- **THEN** the page SHALL show docker as installed and unreachable with its container capabilities `unavailable`

### Requirement: Accessible, theme-token styling
State pills SHALL convey state by text, not colour alone. Every action SHALL be
keyboard reachable with a visible focus ring. Colours SHALL come from theme
tokens; the change SHALL add no raw colour literal to client source. Text SHALL
meet WCAG 2.1 AA contrast in base dark and base light.

#### Scenario: Pill readable without colour
- **WHEN** state pills are rendered in a greyscale screenshot
- **THEN** each state SHALL still be identifiable by its text label

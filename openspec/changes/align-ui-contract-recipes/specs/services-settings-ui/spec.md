## MODIFIED Requirements

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
text. A refused action SHALL show, under the refused control, one sentence naming
what failed and what to try, with the server's error code and message
reachable through "Copy details" (they are not part of the visible
sentence); a 403 `operate_required` SHALL show its reason and remedies there
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

#### Scenario: Refused action reports a sentence with the code in details
- **WHEN** a Stop request is refused with code `stop_failed`
- **THEN** a one-sentence error SHALL appear under the Stop control without the text `stop_failed`
- **AND** "Copy details" SHALL copy `stop_failed` and the server message

### Requirement: Accessible, theme-token styling
State pills SHALL convey state by text, not colour alone. Every action SHALL be
keyboard reachable with a visible focus ring. Colours SHALL come from theme
tokens; the change SHALL add no raw colour literal to client source. Text SHALL
meet WCAG 2.1 AA contrast in base dark and base light. State pills, the operate
banner and callouts, and inline action errors SHALL be rendered by the shared
status pill, notice and inline action error.

#### Scenario: Pill readable without colour
- **WHEN** state pills are rendered in a greyscale screenshot
- **THEN** each state SHALL still be identifiable by its text label

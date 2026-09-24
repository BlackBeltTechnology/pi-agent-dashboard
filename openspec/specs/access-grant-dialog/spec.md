# access-grant-dialog Specification

## Purpose
The operator-facing dialog that asks, at the moment a guard denies access, whether
to allow it — once, always, or not at all — for any access plane, with copy that
names the exact subject and the store a persistent answer would write.

## Requirements

### Requirement: The dialog asks for a verdict, and which verdicts exist depends on the settlement mode

When a pending access request raises a prompt, the dashboard SHALL display a
dialog offering:

- on a **held** denial, exactly three answers — allow this request only, allow
  always, and deny;
- on a **deferred** denial, exactly two — allow always and deny. The allow-once
  answer SHALL be absent rather than disabled, because no request is suspended
  for it to release.

The dialog SHALL name the plane, the exact subject, and — for the allow-always
answer — the grant store that answer will write.

The dialog SHALL NOT pre-select or focus-default any answer, and in particular
SHALL NOT emphasise the allow-always answer over the others. Dismissing the
dialog without choosing SHALL be equivalent to deny.

#### Scenario: A deferred dialog offers two answers

- **WHEN** a dialog is raised for a deferred-plane denial
- **THEN** it SHALL offer exactly allow-always and deny
- **AND** no allow-once control SHALL be present in the rendered output

#### Scenario: No answer is emphasised

- **WHEN** any dialog is raised
- **THEN** no answer SHALL be pre-selected, focus-defaulted, or visually emphasised over the others

#### Scenario: The subject and its consequence are shown

- **WHEN** a dialog is raised
- **THEN** it SHALL display the plane, the subject, and where an allow-always answer would be persisted

#### Scenario: Dismissal denies

- **WHEN** the operator dismisses the dialog without choosing
- **THEN** the pending request SHALL be denied

#### Scenario: Plane-appropriate copy

- **WHEN** a dialog is raised for a network, CORS, filesystem, or working-directory subject
- **THEN** the subject SHALL be rendered in the form natural to that plane rather than as an opaque string

### Requirement: The dialog offers the denied directory's ancestor ladder

When a denial carries offered ancestors, the dialog SHALL let the operator choose
which of them the answer applies to. The denied subject itself SHALL be the
default selection, and no wider rung SHALL be selected for the operator.

The dialog SHALL state, for the currently selected rung, exactly what subtree the
answer admits. Choosing a wider rung SHALL NOT require a separate confirmation
step, but the selected subject SHALL always be visible next to the answer
controls so a widened answer cannot be given without the subject being on screen.

When a denial offers no ancestors, the dialog SHALL present the subject alone and
SHALL NOT render an empty or disabled ladder.

#### Scenario: The narrowest rung is preselected

- **WHEN** a dialog is raised for a denial carrying offered ancestors
- **THEN** the denied subject SHALL be the selected rung
- **AND** no wider rung SHALL be selected

#### Scenario: The admitted subtree tracks the selection

- **WHEN** the operator selects a wider rung
- **THEN** the dialog SHALL state that rung as the subject the answer will grant

#### Scenario: Only offered rungs are selectable

- **WHEN** a dialog renders the ladder
- **THEN** it SHALL offer exactly the rungs the denial carried
- **AND** it SHALL provide no way to enter an arbitrary directory

#### Scenario: No ancestors means no ladder

- **WHEN** a denial carries no offered ancestors
- **THEN** the dialog SHALL show the subject alone with no ladder control

### Requirement: The first answer wins across every connected client

A prompt SHALL be delivered to every connected operator client. The first
well-formed answer SHALL settle the request. Every other client SHALL be told the
prompt is settled and SHALL remove its dialog without requiring interaction.

#### Scenario: A second operator's dialog disappears

- **GIVEN** two connected clients showing the same prompt
- **WHEN** one answers
- **THEN** the other's dialog SHALL be removed
- **AND** a later answer from it SHALL have no effect on access

#### Scenario: Disconnect while prompting

- **WHEN** a client disconnects while a dialog is displayed
- **THEN** the pending request SHALL remain governed by its expiry and by any other connected client

### Requirement: A dialog conveys whether the request is waiting

The dialog SHALL distinguish a request that is suspended awaiting the verdict
from one that was already denied and whose verdict will apply to a later retry,
so the operator knows whether answering resumes something in flight.

#### Scenario: A deferred prompt says the verdict applies later

- **WHEN** a dialog is raised for a denial that was already answered
- **THEN** it SHALL state that the verdict applies to a subsequent attempt

### Requirement: Prompting is opt-in and can be disabled outright

Prompting SHALL be disabled by default and SHALL be enabled only by explicit
operator configuration. An environment variable SHALL disable prompting
regardless of configuration, for automated environments where a browser is
connected but no human is present.

Disabling prompting SHALL suppress only the prompt: existing grants SHALL remain
in force, and denials SHALL still be recorded for review.

#### Scenario: Default deployment never prompts

- **WHEN** the feature has not been enabled
- **THEN** no dialog SHALL ever be raised
- **AND** every guard SHALL behave exactly as before

#### Scenario: Automated environments suppress prompts despite a connected browser

- **GIVEN** the disabling environment variable is set and a browser is connected
- **WHEN** a prompt-eligible denial occurs
- **THEN** no dialog SHALL be raised
- **AND** the denial SHALL still be recorded

#### Scenario: Disabling does not revoke

- **WHEN** prompting is disabled after grants were created
- **THEN** those grants SHALL continue to apply

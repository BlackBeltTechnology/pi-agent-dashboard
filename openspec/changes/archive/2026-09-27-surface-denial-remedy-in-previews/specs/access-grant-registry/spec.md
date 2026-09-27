## ADDED Requirements

### Requirement: A dialog is decided and charged against the requester that raises it

An entry's capacity SHALL stay with the requester that created it: a request
joining an existing entry consumes no entry share and SHALL NOT move or refund
it. The entry's dialog SHALL have its own owner. When an eligible request joins
an entry recorded without a dialog, the decision whether to prompt SHALL apply
the dialog-scoped per-channel bounds (at most one open dialog per channel, and
the per-channel prompt rate on deferred planes) to the **joining** requester's
channel. When they pass, the dialog SHALL be charged to that channel and the
eventual grant SHALL name that requester's session as its origin. When they
fail, the entry SHALL stay unprompted, the suppression SHALL be recorded as a
per-channel flood with its reason, and the joining request SHALL be refused with
that reason.

#### Scenario: An ineligible first request does not own the dialog

- **GIVEN** a directory whose entry was recorded by a request without a prompt capability
- **WHEN** an eligible request from an operator connection joins and the entry is prompted
- **THEN** the open dialog SHALL count toward the operator connection's dialog bound
- **AND** it SHALL NOT count toward the first requester's channel
- **AND** the entry SHALL still count toward the first requester's entry share

#### Scenario: The operator's one-dialog bound applies to a joined entry

- **GIVEN** an operator connection with a dialog already open, and an unprompted entry for another directory recorded by a request without a prompt capability
- **WHEN** an eligible request from that operator connection joins that entry
- **THEN** that entry SHALL NOT be prompted
- **AND** the joining request SHALL be refused with a reason stating that a dialog is already open for it
- **AND** the suppression SHALL be recorded as a per-channel flood

#### Scenario: A joined dialog names the joiner as origin

- **GIVEN** an entry recorded by one session's ineligible request
- **WHEN** another session's eligible request joins it, the dialog is raised, and the operator allows always
- **THEN** the recorded grant SHALL name the joining session as its origin

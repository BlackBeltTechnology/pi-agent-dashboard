# concurrent-ask-user-prompts Specification

## Purpose
TBD - created by archiving change surface-concurrent-ask-user-prompts. Update Purpose after archive.
## Requirements
### Requirement: A new-id prompt SHALL never be dropped by content dedup

The client reducer `addInteractiveRequest` SHALL append a `prompt_request` to
`SessionState.interactiveRequests[]` (and push its `role:"interactiveUi"` row)
whenever the request's `requestId` is not already present in
`interactiveRequests[]`. The reducer SHALL NOT discard a request on the basis
of matching `method`, `params.title`, `params.message`, or any other content
field. The only duplicate the reducer suppresses is a request whose
`requestId` already exists (a re-send of the same prompt, e.g. reconnect
replay).

#### Scenario: Two concurrent confirms sharing a title both surface
- **GIVEN** `interactiveRequests` is `[]`
- **WHEN** a `prompt_request { promptId: "p1", type: "confirm", question: "Update global roles?", metadata.message: "Set role A" }` arrives
- **AND** a `prompt_request { promptId: "p2", type: "confirm", question: "Update global roles?", metadata.message: "Set role B" }` arrives while `p1` is still pending
- **THEN** `interactiveRequests` SHALL contain two pending entries with ids `p1` and `p2`
- **AND** two `role:"interactiveUi"` rows (`ui-p1`, `ui-p2`) SHALL exist in the message stream

#### Scenario: Two identical concurrent confirms both surface
- **GIVEN** `interactiveRequests` is `[]`
- **WHEN** two `prompt_request`s arrive with distinct ids `p1` and `p2` but byte-identical `question`, `type`, and `metadata`
- **THEN** both `p1` and `p2` SHALL be present as pending entries
- **AND** each SHALL be independently answerable

#### Scenario: Same-id re-send is still suppressed
- **GIVEN** `interactiveRequests` contains a pending entry with id `p1`
- **WHEN** a `prompt_request` with `promptId: "p1"` arrives again (reconnect replay)
- **THEN** `interactiveRequests` SHALL still contain exactly one entry for `p1`
- **AND** no second `ui-p1` row SHALL be pushed

### Requirement: Each pending ask resolves independently by requestId

Answering, dismissing, or cancelling one pending ask SHALL affect only the
entry whose `requestId` matches, and SHALL emit exactly one response for that
id. No other pending entry SHALL change status as a side effect.

#### Scenario: Answering one of two pending asks leaves the other pending
- **GIVEN** `interactiveRequests` contains pending entries `p1` and `p2`
- **WHEN** the user answers `p1`
- **THEN** a single response for `p1` SHALL be sent
- **AND** `p2` SHALL remain pending and answerable
- **AND** `p1`'s entry status SHALL become resolved while `p2`'s stays pending

#### Scenario: Cancelling one does not cancel the other
- **GIVEN** `interactiveRequests` contains pending entries `p1` and `p2`
- **WHEN** a `prompt_cancel { promptId: "p1" }` arrives
- **THEN** only `p1` SHALL transition to cancelled
- **AND** `p2` SHALL remain pending

### Requirement: Concurrently-pending free-floating asks render as one grouped panel

The client SHALL render the set of concurrently-pending asks that carry no
`toolCallId` inside a single grouped multi-ask panel. The panel SHALL be a
vertical stack of independently-answerable cards (one per pending ask), reusing
the existing per-type renderers (confirm / select / input / multiselect). An
ask that carries a `toolCallId` SHALL keep its existing inline placement paired
with its tool row and SHALL NOT be pulled into the panel. An ask with
`method:"batch"` SHALL render as its atomic BatchRenderer wizard occupying one
slot in the stack.

#### Scenario: Two free-floating confirms group into one panel
- **GIVEN** two pending free-floating confirms `p1` and `p2`
- **THEN** a single grouped panel SHALL render containing two answerable cards
- **AND** each card SHALL answer its own `requestId` independently

#### Scenario: A tool-paired ask stays inline
- **GIVEN** a pending ask `p3` whose `interactiveUi` row carries a `toolCallId`
- **AND** a pending free-floating ask `p1`
- **THEN** `p3` SHALL render inline next to its tool row
- **AND** only `p1` SHALL appear in the grouped panel

#### Scenario: Late arrival appends; resolution removes; empty hides
- **GIVEN** the grouped panel is open with pending `p1`
- **WHEN** a new free-floating `p2` arrives
- **THEN** `p2` SHALL append to the panel stack
- **WHEN** `p1` and `p2` are both answered or cancelled
- **THEN** the grouped panel SHALL no longer render


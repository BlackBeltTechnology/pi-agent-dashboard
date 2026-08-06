## ADDED Requirements

### Requirement: Images SHALL be fitted for display before an event is stored

Each image content block SHALL be resized to a bounded display size before the event is
stored or broadcast, so that no attachment can push an event past the per-event ceiling.

Fitting SHALL be applied on every path that admits an image into the store, including
events reconstructed on replay.

#### Scenario: A large paste is fitted and its event stays bounded

- **WHEN** a message carrying a 10 MB image is ingested
- **THEN** the stored event SHALL carry a fitted derivative rather than the original bytes
- **AND** the stored event SHALL be within the per-event ceiling

#### Scenario: An already-small image is not enlarged

- **WHEN** an image is already within the display bound
- **THEN** it SHALL NOT be upscaled
- **AND** it SHALL remain visually unchanged

#### Scenario: The message survives at any fittable attachment size

- **WHEN** a message carries an attachment INSIDE the two-phase boundary, at any size
- **THEN** the stored event SHALL retain `data.message` with the user's text
- **AND** it SHALL NOT be replaced by the truncation placeholder
- **AND** the transcript SHALL render a row for that message

This guarantee is scoped to blocks the fit admits, because only those have their bytes
removed from the row. A block OUTSIDE the boundary keeps its bytes inline and stays
subject to the per-event ceiling, so an oversized one can still collapse the event to
the truncation placeholder and take the row with it — reachable today via an animated
GIF over the ceiling (exempt from fitting by D11) or a non-fittable MIME type. Bounding
that path is tracked as issue #424; it is NOT claimed here.

#### Scenario: Replayed sessions are fitted too

- **WHEN** a session persisted with full-resolution inline bytes is replayed
- **THEN** its events SHALL be fitted through the same path
- **AND** the resulting events SHALL be within the ceiling

### Requirement: A message SHALL render before its image is ready

The message row SHALL render as soon as the message is known, without waiting for
fitting to complete. A placeholder SHALL occupy the attachment's position and SHALL be
replaced by the fitted image when it becomes available.

A fitting failure SHALL resolve to an explicit failed-attachment state. It SHALL NOT
leave an indefinite placeholder, an empty row, or a missing row.

#### Scenario: Row appears immediately on send

- **WHEN** a user sends a message with a large attachment
- **THEN** the message row SHALL render without waiting for fitting
- **AND** a placeholder SHALL occupy the attachment's position

#### Scenario: The image replaces its placeholder

- **WHEN** fitting completes for a pending attachment
- **THEN** the fitted image SHALL replace the placeholder in that position
- **AND** the surrounding message SHALL be unchanged

#### Scenario: A fitting failure is honest

- **WHEN** fitting fails, for example on an unsupported or corrupt input
- **THEN** the attachment SHALL resolve to an explicit failed state
- **AND** the message row SHALL still render
- **AND** the placeholder SHALL NOT remain pending indefinitely

### Requirement: Fitting SHALL NOT block the server

Image fitting SHALL run off the main event loop. Ingesting an attachment SHALL NOT stall
event processing for other sessions.

#### Scenario: A large paste does not stall the event loop

- **WHEN** a 10 MB attachment is ingested
- **THEN** event-loop responsiveness SHALL remain within its budget for the duration
- **AND** other sessions' events SHALL continue to be processed

#### Scenario: Concurrent pastes queue without stalling

- **WHEN** several large attachments are ingested in quick succession
- **THEN** they SHALL be processed without blocking unrelated event traffic

### Requirement: The full-resolution original SHALL remain reachable

The original bytes SHALL be retrievable on demand for viewing at full resolution, scoped
to the owning session and subject to the same authorisation as other session data.

This path SHALL NOT be required for the message or its fitted image to render: a failure
to retrieve an original SHALL degrade only the full-resolution view.

#### Scenario: The original opens at full resolution

- **WHEN** a user opens a rendered attachment for a closer look
- **THEN** the full-resolution original SHALL be served
- **AND** it SHALL match the bytes the user attached

#### Scenario: An unauthorised caller is refused

- **WHEN** a caller not authorised for the owning session requests an original
- **THEN** the request SHALL be refused
- **AND** the bytes SHALL NOT be returned

#### Scenario: Losing the original does not affect the transcript

- **WHEN** an original cannot be retrieved
- **THEN** the fitted image SHALL still render in the transcript
- **AND** only the full-resolution view SHALL degrade

#### Scenario: Served bytes are typed from an allow-list

- **WHEN** original bytes are served
- **THEN** the declared content type SHALL come from the supported-image allow-list
- **AND** the response SHALL NOT be interpretable as active content

### Requirement: Originals SHALL be recovered from the session transcript

The transcript already holds the full-resolution bytes and is authoritative (D7).
Recovery SHALL stream it rather than loading it entirely into memory.

There is NO originals cache. D10 dropped the 2 GB LRU blob cache along with the
fitted-derivative cache, on the evidence that recovery measured under 50 MB RSS against
a ~40 MB transcript and that the click-to-original path is explicitly not load-bearing.
The transcript is therefore the ONLY source, and no eviction behaviour is specified
because nothing evicts.

#### Scenario: An original is recovered from the transcript

- **WHEN** an original is requested
- **THEN** it SHALL be located by scanning that session's transcript
- **AND** recovery SHALL NOT require holding the whole transcript in memory

#### Scenario: An unrecoverable original degrades only the zoom

- **WHEN** the transcript no longer holds the requested original
- **THEN** the endpoint SHALL answer 404
- **AND** the transcript row and its fitted thumbnail SHALL be unaffected

### Requirement: The boot safety assert SHALL be armed with the raised ceiling

`deriveTranscriptCapBytes` SHALL receive the same effective per-field cap the event store
uses, so it cannot skip its check while the store runs a nonzero cap. Arming and raising
SHALL land together, and the shipped ceiling SHALL satisfy the assert.

#### Scenario: The assert sees the store's effective cap

- **WHEN** the per-field cap is unset and the store falls back to its default
- **THEN** the assert SHALL evaluate against that same default
- **AND** it SHALL NOT skip its check via a substituted zero

#### Scenario: Startup succeeds with the raised ceiling

- **WHEN** the armed assert runs against the ceiling shipped in this change
- **THEN** startup SHALL succeed

#### Scenario: An unsafe combination fails loudly

- **WHEN** a ceiling is configured that is unsafe for the effective per-field cap
- **THEN** startup SHALL fail rather than proceed

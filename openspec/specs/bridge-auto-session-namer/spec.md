# bridge-auto-session-namer Specification

## Purpose

After each terminal agent turn, the bridge asks the `@fast` model for a short topic title for the session and applies it once via `pi.setSessionName`. The first successful name ends the loop permanently for that session; an external rename locks naming out permanently. All model work runs in-process and tolerates failure without crashing or looping.

## Requirements

### Requirement: Terminal-turn naming trigger

The bridge SHALL attempt to auto-name the session on each terminal agent turn while the global auto-name toggle is enabled, until the first successful name or a permanent lockout.

#### Scenario: Attempt on terminal turn

- **WHEN** the bridge observes an `agent_end` event and the auto-name toggle is enabled
- **THEN** the bridge observes the current `pi.getSessionName()` for external-rename classification
- **AND** the bridge runs one naming attempt (`maybeName`)

#### Scenario: Toggle disabled

- **WHEN** an `agent_end` event fires and the auto-name toggle is disabled
- **THEN** the bridge performs no naming attempt and no model call

#### Scenario: Concurrency and stop guards

- **WHEN** a naming attempt is already in flight, or the session is hard-stopped
- **THEN** the bridge returns without starting another attempt

### Requirement: Eligibility and pre-filter gating

The bridge SHALL attempt naming only for an eligible, un-named session, and SHALL skip trivial openers without any model call.

#### Scenario: Eligibility gate

- **WHEN** a naming attempt runs and any of these hold: the toggle is off, the name source is `user`, or an auto-name was already applied
- **THEN** the bridge does not call the model

#### Scenario: Trivial-opener pre-filter

- **WHEN** the first user message is a pure greeting (e.g. `hi`, `test`, `thanks`), shorter than 15 characters after trimming, or a bare slash-command
- **THEN** the bridge skips the attempt with no model call

### Requirement: In-process `@fast` title generation

The bridge SHALL generate the title by calling the `@fast` model in-process using pi-ai's `streamSimple` and the model registry's credential resolution, with a bounded transcript window and a short output cap.

#### Scenario: Resolve the fast model role

- **WHEN** a naming attempt proceeds past the pre-filter
- **THEN** the bridge resolves the model reference via `lookupRole("@fast")`

#### Scenario: Bounded transcript window

- **WHEN** the bridge builds the model input
- **THEN** it sends only the first substantive user message plus the first assistant reply, each truncated to 2000 characters, never the full history

#### Scenario: Model invocation

- **WHEN** credentials resolve for the `@fast` model reference
- **THEN** the bridge calls `streamSimple` with the summarizer system prompt, the transcript as a single user message, and a max output of 16 tokens
- **AND** it accumulates the raw title from streamed `text_delta` events

#### Scenario: Done-event text fallback

- **WHEN** the stream reaches the `done` event and no `text_delta` text has accumulated
- **THEN** the bridge collects the title from the final message's text content parts (`collectText(ev.message)`)

### Requirement: Title parsing and one-shot application

The bridge SHALL accept only a well-formed title, apply it once via `pi.setSessionName`, mirror it to the dashboard with provenance `auto`, and then stop naming for the session; otherwise it SHALL wait and retry on a later turn.

#### Scenario: Apply a valid title

- **WHEN** the model returns a non-empty title that is not the `NULL` sentinel, is at most 40 characters, and is at most 6 words
- **THEN** the bridge records the applied title, marks the session auto-named with source `auto`, and then calls `applyName(title)` which runs `pi.setSessionName(title)` and sends a `session_name_update` with `nameSource: "auto"`

#### Scenario: Wait for a nameable topic

- **WHEN** the model returns the `NULL` sentinel, an empty response, a title over 40 characters, or a title over 6 words
- **THEN** the bridge applies no name and retries on a later terminal turn

#### Scenario: First success is permanent

- **WHEN** an auto-name has already been applied for the session
- **THEN** the bridge attempts no further naming

### Requirement: External-rename lockout and provenance seeding

The bridge SHALL treat any observed session name other than its own last self-applied title as an external rename, permanently lock out auto-naming, report provenance `user`, and honor provenance restored on reconnect.

#### Scenario: External rename detected

- **WHEN** the observed session name differs from the bridge's last self-applied title
- **THEN** the bridge sets the name source to `user`, permanently stops naming, and sends a `session_name_update` with `nameSource: "user"`

#### Scenario: Self-applied name ignored

- **WHEN** the observed session name equals the bridge's last self-applied title
- **THEN** the bridge takes no action and continues in its post-success stopped state

#### Scenario: Seed provenance on reconnect

- **WHEN** provenance restored from persisted metadata is `user`
- **THEN** the bridge marks the name source `user` and stays permanently stopped
- **AND WHEN** the restored provenance is `auto`, the bridge marks the session already auto-named and does not attempt naming again

### Requirement: Failure tolerance

The bridge SHALL never crash or tight-loop on naming failures: hard errors stop the session permanently and emit a one-shot error; soft errors stay silent and retry on the next terminal turn.

#### Scenario: Hard error stops permanently

- **WHEN** the `@fast` role is unconfigured, the model reference is malformed or not found in the registry, or credentials cannot be resolved (e.g. OAuth-only provider)
- **THEN** the bridge permanently stops naming and emits a single `auto_name_error` with the reason

#### Scenario: Soft error retries

- **WHEN** the model call fails transiently (network or provider error)
- **THEN** the bridge applies no name, emits no error, and retries on the next terminal turn

#### Scenario: Dependencies not ready

- **WHEN** the model registry is not yet captured or pi-ai's `streamSimple` is not yet loadable
- **THEN** the bridge defers the attempt without treating it as an error and retries later

#### Scenario: One-shot guard set before application

- **WHEN** a valid title is applied
- **THEN** the session is marked auto-named (`hasAutoName`, source `auto`) before `applyName` runs, so if `applyName` throws the error propagates out of `maybeName` and the one-shot guard still holds — no further attempt re-applies a name (only the `inFlight` flag resets in `finally`)

## ADDED Requirements

### Requirement: An imported session SHALL be rehydrated as a local session

Importing SHALL reconstruct the transcript from its segments, expand path
placeholders to local paths, rewrite the metadata `cwd` to the target project
root **plus the session's recorded root-relative offset**, and write the session
into the local session store under the target machine's slug directory, so that
existing session discovery finds it. Materialisation SHALL occur on open or
resume, not on listing. The expanded cwd SHALL be checked for existence before
materialisation.

#### Scenario: A session whose expanded cwd does not exist is not materialised

- **GIVEN** a session recorded in a worktree beneath the project root that does
  not exist on the target machine
- **WHEN** it is opened
- **THEN** it is readable and marked non-resumable
- **AND** it is not materialised into a state that discovery reports as having a
  missing cwd

#### Scenario: An imported session is discoverable locally

- **WHEN** a remote session is imported
- **THEN** a transcript and metadata sidecar exist in the local slug directory
  for the target project root
- **AND** the metadata `cwd` is the local project root
- **AND** the session appears in the local session list after discovery
- **AND** discovery does not report the session as having a missing cwd

#### Scenario: Import is idempotent

- **WHEN** the same session is imported twice
- **THEN** exactly one local session exists and no duplicate is created

#### Scenario: An incomplete session imports up to its last sealed segment

- **GIVEN** a remote session with sealed segments and an unpublished tail
- **WHEN** it is imported
- **THEN** the local transcript contains exactly the sealed content
- **AND** the session is presented as incomplete

### Requirement: Resuming an imported session SHALL require a model preflight

Before resuming an imported session, the system SHALL verify that the session's
recorded model is available locally. When it is not, the system SHALL warn and
require the user to choose a model. The system SHALL NOT substitute a model
silently. Capacity SHALL be evaluated against the `contextWindow` recorded in
the archive, never against a locally inferred value.

#### Scenario: Capacity uses the archived context window

- **GIVEN** an imported session recording `contextTokens` 269644 and
  `contextWindow` 1000000
- **WHEN** the preflight evaluates the recorded model
- **THEN** the archived `contextWindow` is used
- **AND** the session is not refused on the basis of a locally inferred window

#### Scenario: A missing model prompts the user to choose

- **GIVEN** an imported session recorded against a model not configured locally
- **WHEN** the user resumes it
- **THEN** the user is warned and asked to choose a model
- **AND** no resume proceeds until a choice is made

#### Scenario: A model whose context window cannot hold the session is refused

- **GIVEN** an imported session with `contextTokens` of 147679
- **WHEN** the user selects a model whose context window is smaller than that
- **THEN** the selection is refused with an explicit capacity error

#### Scenario: An available model resumes without prompting

- **WHEN** the session's recorded model is available locally and its window is
  sufficient
- **THEN** the session resumes without a model prompt

#### Scenario: A resume acquires a claim first

- **WHEN** a user resumes an imported session
- **THEN** an exclusive claim is acquired before the session is started
- **AND** a refused claim blocks the resume with the holding machine reported

#### Scenario: A resumed import publishes against the canonical form

- **GIVEN** an imported session that has been materialised with local paths
- **WHEN** it is resumed, appended to, and a new segment seals
- **THEN** the new segment continues the archived segment sequence
- **AND** no divergence is reported against the previously published segments

### Requirement: Imported sessions SHALL carry a provenance record

An imported session SHALL have a provenance sidecar recording its origin machine
and import time. The record SHALL travel with the session and SHALL NOT be
written into the pi-owned metadata sidecar.

#### Scenario: Provenance is recorded on import

- **WHEN** a session is imported
- **THEN** a provenance record exists naming the origin machine and the import
  time

#### Scenario: Provenance survives a metadata rewrite

- **WHEN** the pi-owned metadata sidecar is rewritten by normal session activity
- **THEN** the provenance record is unchanged

#### Scenario: A locally created session has no provenance record

- **WHEN** a session is created locally
- **THEN** no provenance record is written for it

### Requirement: The session card SHALL indicate imported provenance

A session with a provenance record SHALL be visually marked as imported and
SHALL identify its origin machine.

#### Scenario: An imported session is marked on its card

- **WHEN** a session with a provenance record is listed
- **THEN** its card shows an imported indicator naming the origin machine

#### Scenario: A locally created session is not marked

- **WHEN** a session without a provenance record is listed
- **THEN** its card shows no imported indicator

#### Scenario: A substituted model is disclosed on the card

- **WHEN** an imported session was resumed with a model other than its recorded
  one
- **THEN** its card discloses that the model was substituted

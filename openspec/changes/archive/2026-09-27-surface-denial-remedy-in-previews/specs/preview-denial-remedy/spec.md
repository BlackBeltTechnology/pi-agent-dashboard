## Purpose

Makes a refused file preview reach the access-grant dialog when the operator
opened it, and explain itself honestly when no dialog can be raised.

## ADDED Requirements

### Requirement: Click-opened image previews SHALL request their bytes in a prompt-eligible way

Image previews (editor tab, the file preview overlay, and the lightbox when its
source is the file route) opened by an operator action SHALL request their bytes
through the mechanism that carries the prompt capability, so a denial of
such a request can raise the access-grant dialog. A preview SHALL NOT fetch or
revoke an image source it did not create, and a lightbox source that is not the
file route SHALL load as before.

#### Scenario: A refused image raises the dialog

- **GIVEN** prompting is enabled, the host gate enforces, and no other access question is open for this client
- **WHEN** the operator opens an image outside every containment layer
- **THEN** the access-grant dialog SHALL be raised for its directory
- **AND** after an allowing answer the image SHALL render

#### Scenario: A lightbox image raises the dialog

- **GIVEN** prompting is enabled, the host gate enforces, and no other access question is open for this client
- **WHEN** the operator opens a local image outside every containment layer in the full-size lightbox
- **THEN** the access-grant dialog SHALL be raised

#### Scenario: A cross-origin API base keeps loading images as before

- **GIVEN** a client whose API base is on another origin
- **WHEN** an image preview renders
- **THEN** it SHALL load the image as it did before this change
- **AND** a failure SHALL be reported as an image that could not be loaded, without a reason and without offering to ask

#### Scenario: A foreign lightbox source is unaffected

- **WHEN** the lightbox opens an image whose source is not the file route (a remote URL, a data URL, or an attachment URL)
- **THEN** it SHALL load the image as before, including its fallback source

### Requirement: Auto-opened previews SHALL never raise the dialog

A preview SHALL be treated as operator-opened only where a surface declares it:
the editor pane for a tab whose last activating action was the operator's, and
the file preview overlay and full-size lightbox, which open on an operator
click. Every other preview, including one emitted into the chat transcript by an
agent and any surface that makes no declaration, SHALL be treated as
auto-opened. An auto-opened preview SHALL NOT raise the dialog, whatever
component requests the file; every request it issues that can carry a
declaration SHALL be declared ineligible.

The notice SHALL offer to ask for access when the refused request was declared
ineligible by the client and the client can carry a prompt capability, unless a
disclosed outcome states that no eligible request could change the refusal. A
withheld outcome SHALL NOT prevent the offer. Asking SHALL re-issue the request
as eligible, once, and only on the operator's click.

#### Scenario: An auto-opened file does not prompt

- **GIVEN** prompting is enabled and the host gate enforces
- **WHEN** a file outside every containment layer is opened without a user action
- **THEN** no dialog SHALL be raised, whichever component requests the file, including any size check made before the viewer mounts

#### Scenario: An agent-emitted preview card does not prompt

- **GIVEN** prompting is enabled and the host gate enforces
- **WHEN** an agent emits a preview of a file outside every containment layer into the chat transcript
- **THEN** no dialog SHALL be raised

#### Scenario: An undeclared surface does not prompt

- **GIVEN** prompting is enabled and the host gate enforces
- **WHEN** a preview renders on a surface that declares no provenance
- **THEN** its requests SHALL be declared ineligible

#### Scenario: A user tap is not an auto-open

- **WHEN** the operator taps the canvas file chip to open a file
- **THEN** the preview SHALL be treated as operator-opened

#### Scenario: An operator open of an auto-opened file makes it operator-opened

- **GIVEN** a file open as auto-opened
- **WHEN** the operator opens the same file explicitly, selects its tab, or closes the tab before it so that it becomes active
- **THEN** the preview SHALL be treated as operator-opened and its next request SHALL be eligible

#### Scenario: An auto-open that activates an operator-opened file does not prompt

- **GIVEN** prompting is enabled, the host gate enforces, and a file outside every containment layer open as operator-opened but not active
- **WHEN** it is auto-opened again and becomes the active preview
- **THEN** no dialog SHALL be raised

#### Scenario: An auto-open of the active file changes nothing

- **GIVEN** the active preview is operator-opened
- **WHEN** the same file is auto-opened again
- **THEN** the preview SHALL remain operator-opened
- **AND** no new request SHALL be issued

#### Scenario: Provenance survives a reload

- **GIVEN** an auto-opened file tab
- **WHEN** the page is reloaded and the tab is restored from storage without an explicit open
- **THEN** the preview SHALL still be treated as auto-opened

#### Scenario: A lightbox opened from an auto-opened document is click-opened

- **GIVEN** prompting is enabled, the host gate enforces, and an auto-opened markdown document embedding a local image outside every containment layer
- **WHEN** the operator clicks the image open in the full-size lightbox
- **THEN** the access-grant dialog SHALL be raised

#### Scenario: A click turns an auto-opened refusal into a question

- **GIVEN** an auto-opened preview showing an ineligible refusal, and a client that can carry a prompt capability
- **WHEN** the operator chooses to ask for access
- **THEN** the request SHALL be re-issued as eligible
- **AND** the dialog SHALL be raised

#### Scenario: Asking does not depend on a disclosed outcome

- **GIVEN** an auto-opened preview refused with a body that carries no prompt outcome, and a client that can carry a prompt capability
- **WHEN** the notice renders
- **THEN** it SHALL offer to ask for access

#### Scenario: Asking is not offered when it cannot work

- **GIVEN** a client that cannot carry a prompt capability to the file route
- **WHEN** an ineligible refusal notice renders
- **THEN** it SHALL NOT offer to ask for access
- **AND** it SHALL point to the access settings

#### Scenario: A failed ask does not loop

- **GIVEN** an operator asked for access and the re-issued request was refused without raising a dialog
- **WHEN** the notice renders
- **THEN** it SHALL NOT offer to ask again
- **AND** it SHALL point to the access settings

### Requirement: Multi-request media SHALL keep ranged loading and never prompt without a click

Video, audio and PDF previews SHALL continue to load over ranged requests, and
none of their requests SHALL raise the dialog by itself, whoever opened them. On a
load failure they SHALL issue at most one declared-ineligible diagnostic
request of at most one byte per load attempt, whose response is used only to
classify the refusal. Their notice SHALL state, before the operator asks, that a
one-time answer admits only a check and not the stream or document. It SHALL state that fact
without recommending a verdict.

#### Scenario: An operator-opened PDF does not prompt by itself

- **GIVEN** prompting is enabled, the host gate enforces, and a PDF outside every containment layer
- **WHEN** the operator opens it
- **THEN** no dialog SHALL be raised until the operator asks from the notice

#### Scenario: Seek is preserved

- **WHEN** a video preview loads successfully
- **THEN** its bytes SHALL be requested over a ranged stream

#### Scenario: A failed stream is diagnosed without a prompt

- **GIVEN** a video preview whose stream is refused
- **WHEN** the client determines the cause
- **THEN** it SHALL issue exactly one additional request asking for at most one byte
- **AND** that request SHALL NOT raise the dialog

#### Scenario: Asking for a stream warns first and retries after

- **GIVEN** a refused video notice
- **WHEN** it renders
- **THEN** it SHALL state that only a lasting answer admits a stream
- **AND WHEN** the operator asks and the answer admits the request
- **THEN** the stream SHALL be retried

#### Scenario: A stream still refused after asking is explained

- **GIVEN** the operator asked for a stream and the answer admitted only the diagnostic request
- **WHEN** the retried stream is refused
- **THEN** the notice SHALL state that a one-time answer cannot admit a stream
- **AND** it SHALL NOT offer to ask again
- **AND** it SHALL point to the access settings
- **AND** no further diagnostic request SHALL be issued

### Requirement: A refused preview SHALL explain why no dialog appeared

A refusal notice SHALL render the prompt outcome the server reported, SHALL name
the directory exactly as the server named it, and SHALL NOT collapse distinct
outcomes into one message. It SHALL offer a re-request only for outcomes a
re-request can change, and it SHALL NOT create a grant.

#### Scenario: Prompting is off

- **GIVEN** a refusal whose prompt outcome is `off`
- **WHEN** the notice renders
- **THEN** it SHALL state that access prompts are off
- **AND** it SHALL NOT offer to ask again

#### Scenario: The host gate does not enforce

- **GIVEN** a refusal whose prompt outcome is `not-enforced`
- **WHEN** the notice renders
- **THEN** it SHALL state that prompts require the host gate to enforce
- **AND** it SHALL NOT state that prompts are off

#### Scenario: Too many questions are pending

- **GIVEN** a refusal whose prompt outcome is `throttled`
- **WHEN** the notice renders
- **THEN** it SHALL state that too many access questions are pending
- **AND** it SHALL NOT state that another question is open
- **AND** it SHALL NOT offer to ask again

#### Scenario: Another question is open

- **GIVEN** a refusal whose prompt outcome is `busy`
- **WHEN** the notice renders
- **THEN** it SHALL state that another access question is open
- **AND** it SHALL offer to ask again

#### Scenario: A one-time answer admitted a different file

- **GIVEN** a refusal whose prompt outcome is `allowed-elsewhere`
- **WHEN** the notice renders
- **THEN** it SHALL state that a one-time answer admitted another file in this directory
- **AND** it SHALL NOT state that access was refused by the operator

#### Scenario: An allowing answer did not admit the read

- **GIVEN** a refusal whose prompt outcome is `allowed-but-refused`
- **WHEN** the notice renders
- **THEN** it SHALL state that access was allowed but the file still could not be read

#### Scenario: The route can never ask

- **GIVEN** a refusal whose prompt outcome is `cannot-ask`
- **WHEN** the notice renders
- **THEN** it SHALL NOT offer to ask again

#### Scenario: The directory can never be granted

- **GIVEN** a refusal whose prompt outcome is `ungrantable`
- **WHEN** the notice renders
- **THEN** it SHALL state that the directory cannot be granted
- **AND** it SHALL NOT offer to ask again

#### Scenario: No outcome was disclosed

- **GIVEN** a refusal body carrying remedy fields but no prompt outcome, for a request the client did not declare ineligible
- **WHEN** the notice renders
- **THEN** it SHALL report the refusal without a reason
- **AND** it SHALL NOT offer to ask again

#### Scenario: An outcome no ask can change suppresses the offer to ask

- **GIVEN** an auto-opened preview refused with a disclosed outcome of `off`, and a client that can carry a prompt capability
- **WHEN** the notice renders
- **THEN** it SHALL NOT offer to ask for access

#### Scenario: A refusal without remedy fields is reported as itself

- **WHEN** a preview request is refused without a denial identifier
- **THEN** the view SHALL show the server's error text
- **AND** it SHALL NOT mention prompting or granting

#### Scenario: A missing file is not a refusal

- **WHEN** a preview request returns not-found
- **THEN** the view SHALL report the file as not found

#### Scenario: The notice never grants

- **WHEN** any refusal notice renders
- **THEN** none of its controls SHALL create a grant

### Requirement: Inline previews SHALL remain silent

The inline preview variant used in chat transcripts and in the expanded preview
route, and images rendered inline inside markdown, SHALL NOT render a refusal
notice. Opening such an image in the
full-size lightbox is an operator action and follows the click-opened
requirement above.

#### Scenario: An inline card shows no notice

- **GIVEN** an inline image preview whose file is refused
- **WHEN** the card renders
- **THEN** no refusal notice SHALL appear

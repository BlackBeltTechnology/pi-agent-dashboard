## ADDED Requirements

### Requirement: Per-prompt answer draft persistence
The partial answer of an unanswered ask-user prompt (`select`/`multiselect` checks and Other, `input` text, `batch` step and answers) SHALL be restored after switching session and back and after a page reload. Every surface mounting the same prompt SHALL share its text and selections, including the latest edit; no other session or prompt SHALL show it.

#### Scenario: Other text survives session switch
- **WHEN** the user activates "Other" on a pending `select` in session A, types `"foo"`, switches to session B and back
- **THEN** the "Other" row SHALL be active with text `"foo"`

#### Scenario: Multiselect and input restored
- **WHEN** the user checks options on a pending `multiselect`, or types in a pending `input`, and navigates away and back
- **THEN** the same options SHALL be checked, or the same text SHALL be shown

#### Scenario: Batch step and answers restored
- **WHEN** the user answers steps 1–2 of a pending `batch` and is on step 3, then reloads the page
- **THEN** the wizard SHALL open on step 3 with steps 1–2 answered

#### Scenario: Shared across surfaces
- **WHEN** the user types an Other text on the chat card and opens the same question in the question dialog
- **THEN** the dialog SHALL show the same text

#### Scenario: Switch inside the write delay
- **WHEN** the user types in a pending `input` and switches session within 300 ms of the last keystroke, then reloads
- **THEN** the full typed text SHALL be restored

#### Scenario: Images are not restored in the question dialog
- **WHEN** the user pastes an image into a pending `input` on the chat card and opens the same question in the question dialog
- **THEN** the dialog SHALL show the text but SHALL NOT show the image, because the dialog's answer road is text-only

#### Scenario: Prompt change re-initialises
- **WHEN** one mounted renderer element receives a different prompt id
- **THEN** it SHALL show that prompt's draft (or empty), not the previous prompt's

#### Scenario: Prompt without id is not persisted
- **WHEN** a prompt reaches a surface without a prompt id (e.g. a question row from an older server)
- **THEN** no draft SHALL be stored or restored for it, and two such prompts SHALL NOT share a draft

#### Scenario: No leak
- **WHEN** session B has its own pending prompt while session A has a draft
- **THEN** B's prompt SHALL show no content from A's draft

### Requirement: Prompt draft storage and lifecycle
Prompt drafts SHALL live in an in-memory store, mirrored debounced and size-capped to `sessionStorage` (per tab) under `ask-draft:<sessionId>:<promptId>` and flushed on unmount and page hide. Invalid entries SHALL be ignored. Pasted images SHALL stay in memory, scoped per session, prompt and step, never serialised. A draft SHALL be deleted when its prompt is no longer pending (from session state, mounted or not) or is older than 24 hours.

#### Scenario: Key naming
- **WHEN** a draft exists for session `s1`, prompt `p1`
- **THEN** it SHALL be stored under `ask-draft:s1:p1`

#### Scenario: Cleared when answered or cancelled
- **WHEN** the user submits or cancels the prompt and its request leaves `pending`
- **THEN** its `ask-draft:` entry, memory copy and in-memory images SHALL be removed and a later unmount SHALL NOT re-create it

#### Scenario: Kept when delivery fails
- **WHEN** a submit from the question dialog fails and the prompt stays pending
- **THEN** its draft SHALL remain

#### Scenario: Cleared when no longer pending, renderer unmounted
- **WHEN** the prompt becomes resolved, cancelled or dismissed (including answered in the terminal) while its session is not the selected one
- **THEN** its entry SHALL be removed without the renderer being mounted

#### Scenario: Old entry swept
- **WHEN** the store hydrates and an entry is older than 24 hours
- **THEN** that entry SHALL be removed

#### Scenario: Per-tab storage
- **WHEN** a draft is written and the page is reloaded in the same tab, or a second tab opens the same session
- **THEN** the reloaded tab SHALL restore it, the second tab SHALL NOT see it, and nothing SHALL be written to `localStorage`

#### Scenario: Corrupt or stale entry
- **WHEN** an entry is invalid JSON, or a batch draft's step exceeds the question count
- **THEN** the renderer SHALL start empty and the entry SHALL be discarded

#### Scenario: Images are memory-only
- **WHEN** the user pastes an image into a pending `input` on the chat card and navigates away and back without reloading
- **THEN** the image SHALL still show; after a reload it SHALL NOT, while the text SHALL

#### Scenario: Images do not cross sessions
- **WHEN** sessions A and B each have a pending prompt with the same prompt id and A has a pasted image
- **THEN** B's prompt SHALL NOT show A's image

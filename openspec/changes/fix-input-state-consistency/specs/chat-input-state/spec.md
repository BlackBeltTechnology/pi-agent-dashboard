## ADDED Requirements

### Requirement: Per-prompt answer draft persistence
The partial answer of an unanswered ask-user prompt SHALL be restored as left after switching session and back, and after a page reload. It covers `select`/`multiselect` (checked options, Other active + text), `input` text and `batch` (step, per-step answers and Other). Every surface mounting the same prompt SHALL share it; no other session or prompt SHALL show it.

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

#### Scenario: No leak
- **WHEN** session B has its own pending prompt while session A has a draft
- **THEN** B's prompt SHALL show no content from A's draft

### Requirement: Prompt draft storage and lifecycle
Prompt drafts SHALL be stored in `localStorage` under `ask-draft:<sessionId>:<promptId>` with a version and save time, written debounced and capped in size. An unparsable, wrong-version, oversize or shape-mismatched entry SHALL be ignored. Pasted images SHALL be kept in memory only. A draft SHALL be deleted when the prompt is answered, cancelled, or no longer pending, when its session is removed, and when older than 7 days.

#### Scenario: Key naming
- **WHEN** a draft exists for session `s1`, prompt `p1`
- **THEN** it SHALL be stored under `ask-draft:s1:p1`

#### Scenario: Cleared on answer
- **WHEN** the user submits or cancels the prompt
- **THEN** its `ask-draft:` entry SHALL be removed

#### Scenario: Cleared when no longer pending
- **WHEN** the prompt becomes resolved, cancelled or dismissed (including answered in the terminal)
- **THEN** its entry SHALL be removed

#### Scenario: Corrupt or stale entry
- **WHEN** an entry is invalid JSON, or a batch draft's step exceeds the question count
- **THEN** the renderer SHALL start empty and the entry SHALL be discarded

#### Scenario: Images are memory-only
- **WHEN** the user pastes an image into a pending `input` and navigates away and back without reloading
- **THEN** the image SHALL still show; after a reload it SHALL NOT, while the text SHALL

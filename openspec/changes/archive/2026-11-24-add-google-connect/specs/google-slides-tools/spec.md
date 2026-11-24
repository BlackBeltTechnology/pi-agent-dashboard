## Purpose

Agent tools that read, create and edit text in Google Slides presentations of a connected account through Google Connect leases, with confirmed and revision-guarded edits.

## ADDED Requirements

### Requirement: Slides read tool
The plugin SHALL provide `gslides_get` taking a presentation id or URL, returning title, revision id and, per slide, its id, the text of each shape and the speaker notes.

#### Scenario: Outline of a deck
- **WHEN** the agent calls `gslides_get` on a 12-slide deck
- **THEN** 12 slide entries are returned with their texts and notes

### Requirement: Slides write tools
The plugin SHALL provide `gslides_create`, `gslides_add_slide` (layout, title and body text) and `gslides_replace_text` (replace all matches). Each SHALL require Slides at level write and ask the user to confirm with account, presentation title and a text preview or match count. Edits carrying a stale revision id SHALL fail with `revision_changed`. No interactive UI, denial, dismissal or timeout SHALL leave the presentation unchanged.

#### Scenario: Stale revision
- **WHEN** the deck changed after `gslides_get` and the agent calls `gslides_replace_text` with the old revision id
- **THEN** the tool fails with `revision_changed`

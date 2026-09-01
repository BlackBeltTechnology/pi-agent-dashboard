## MODIFIED Requirements

### Requirement: Corrections panel above the composer

The client SHALL render a corrections panel directly above the chat composer (the same
region used by the mid-turn prompt queue panel) whenever the feature is enabled and a check
has produced at least one suggestion. The panel SHALL display, for the checked draft: each
suggestion as a **word-level inline diff** of the correction — unchanged words rendered
neutral and only the changed words **highlighted** (removed text struck through /
error-colored, replacement text success-colored) so the fix is scannable even in a long
sentence — a one-line grammar **summary**, and, per suggestion, its `message`.

#### Scenario: Panel appears after a check with suggestions
- **WHEN** a check returns one or more suggestions
- **THEN** the panel SHALL appear above the composer showing highlighted corrections and the
  summary

#### Scenario: No issues found
- **WHEN** a check returns zero suggestions
- **THEN** the panel SHALL either stay hidden or show a transient "no issues found" state,
  and SHALL NOT block or alter the draft

#### Scenario: Panel is dismissible
- **WHEN** the user closes the panel
- **THEN** the panel SHALL hide and the draft SHALL be unchanged

#### Scenario: Long-sentence correction highlights only the delta
- **WHEN** a suggestion changes only part of a long `original` (e.g. one word, or a word with
  fused punctuation such as `work.` → `works.`)
- **THEN** the panel SHALL render the unchanged words neutral and highlight only the changed
  words, NOT the entire original and replacement

## ADDED Requirements

### Requirement: Empty composer clears the corrections panel

When the composer draft becomes empty — after the prompt is sent (Send resets the draft to
empty) or after a manual clear — the client SHALL clear the corrections panel and abort any
in-flight check, so no stale suggestions from a previous draft remain visible.

#### Scenario: Sending the prompt clears the panel
- **WHEN** the corrections panel is showing suggestions and the user sends the prompt (draft
  resets to empty)
- **THEN** the panel SHALL clear and show no suggestions

#### Scenario: In-flight check aborted when the draft empties
- **WHEN** a check is in flight and the draft becomes empty
- **THEN** the in-flight check SHALL be aborted and SHALL NOT re-open the panel when it
  resolves

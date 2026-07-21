# composer-grammar-check Specification

## Purpose
TBD - created by archiving change add-composer-grammar-check. Update Purpose after archive.
## Requirements
### Requirement: Feature is opt-in and off by default

The composer grammar-check UI SHALL render nothing and add no behaviour when
`config.grammar.enabled` is `false`. No Check button, no panel, and no auto-check timers
SHALL be active while disabled.

#### Scenario: Disabled — composer unchanged
- **WHEN** `grammar.enabled` is `false`
- **THEN** the composer SHALL render exactly as it does today (no Check button, no panel)
- **AND** no request to `/api/grammar/check` SHALL be made

### Requirement: Corrections panel above the composer

The client SHALL render a corrections panel directly above the chat composer (the same
region used by the mid-turn prompt queue panel) whenever the feature is enabled and a check
has produced at least one suggestion. The panel SHALL display, for the checked draft: the
corrected sentences with the changed spans **highlighted** (removed text struck through /
error-colored, replacement text success-colored), a one-line grammar **summary**, and, per
suggestion, its `message`.

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

### Requirement: Manual check trigger

The composer SHALL provide a manual **Check** control (a toolbar button and a keyboard
shortcut) that runs a grammar check on the current draft on demand, regardless of the
auto-check setting, whenever the draft is non-empty.

#### Scenario: Manual check via button
- **WHEN** the user clicks the Check button with a non-empty draft
- **THEN** the client SHALL POST the draft to `/api/grammar/check` and render the result

#### Scenario: Manual check while auto-check is off
- **WHEN** `grammar.autoCheck` is `false` and the user triggers a manual check
- **THEN** the check SHALL still run

### Requirement: Debounced automatic check

When `grammar.autoCheck` is `true`, the client SHALL run a check automatically
`grammar.debounceMs` after the last draft change, only when the draft length is at least
`grammar.minChars`. A new draft change SHALL reset the timer and abort any in-flight check.
Auto-check SHALL be skipped while the session is `streaming` and when the draft is a slash
command (`/…`) or a bare `!`/`!!` shell input.

#### Scenario: Auto-check fires after typing stops
- **WHEN** auto-check is on and the user stops typing for `debounceMs` with a draft ≥
  `minChars`
- **THEN** exactly one check SHALL run for that idle draft

#### Scenario: New keystroke cancels in-flight check
- **WHEN** an auto-check request is in flight and the user types another character
- **THEN** the in-flight request SHALL be aborted and the debounce timer SHALL reset

#### Scenario: Draft too short
- **WHEN** the draft length is below `minChars`
- **THEN** no auto-check SHALL run

#### Scenario: Skipped while streaming
- **WHEN** the session status is `streaming`
- **THEN** auto-check SHALL NOT run

#### Scenario: Skipped for command / shell drafts
- **WHEN** the draft starts with `/`, `!`, or `!!`
- **THEN** auto-check SHALL NOT run

### Requirement: Apply-all rewrites the draft

The panel SHALL provide an **Apply all** action that replaces the composer draft with the
result's `correctedText` via the controlled `onDraftChange`, then clears the panel.

#### Scenario: Apply all corrects the draft
- **WHEN** the user clicks Apply all
- **THEN** the composer draft SHALL become `correctedText`
- **AND** the panel SHALL clear

### Requirement: Per-suggestion accept and dismiss

Each suggestion SHALL offer **Accept** and **Dismiss**. Accept SHALL apply only that
suggestion's `replacement` to the draft; Dismiss SHALL remove the suggestion from the panel
without changing the draft. Accept SHALL locate the suggestion's `original` span in the
current draft; if the span no longer matches because the user edited the draft, the client
SHALL either re-find the nearest occurrence of `original` or mark the suggestion stale and
disable Accept for it — it SHALL NOT corrupt the draft by applying at a wrong offset.

#### Scenario: Accept one suggestion
- **WHEN** the user clicks Accept on a suggestion whose `original` still matches the draft
- **THEN** only that span SHALL be replaced with `replacement` in the draft

#### Scenario: Dismiss one suggestion
- **WHEN** the user clicks Dismiss
- **THEN** the suggestion SHALL be removed from the panel and the draft SHALL be unchanged

#### Scenario: Stale suggestion after manual edit
- **WHEN** the user edited the draft so a suggestion's `original` span no longer matches at
  its offset and cannot be re-found
- **THEN** the client SHALL mark that suggestion stale and SHALL NOT apply it at a wrong
  position

### Requirement: Corrections edit only the draft

All accept / apply-all mutations SHALL go through the existing controlled `draft` /
`onDraftChange` path. The feature SHALL NOT auto-send, SHALL NOT modify other sessions'
drafts, and SHALL NOT alter pending image attachments.

#### Scenario: No auto-send
- **WHEN** any correction is applied
- **THEN** the prompt SHALL NOT be sent automatically; the user still presses Send

#### Scenario: Session switch clears state
- **WHEN** the user switches sessions
- **THEN** any in-flight check SHALL be aborted and the panel SHALL hide

### Requirement: Localized strings

All user-facing strings introduced by this feature SHALL be added to the i18n catalog
(`i18n.tsx`) and translated in the Hungarian catalog (`i18n-hu.ts`). No hard-coded English
strings SHALL be rendered.

#### Scenario: Strings resolve via i18n
- **WHEN** the UI renders the Check button, panel labels, summary label, and action buttons
- **THEN** each SHALL resolve through the i18n catalog with a Hungarian translation present


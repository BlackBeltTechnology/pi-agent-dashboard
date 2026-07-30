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

The client SHALL render a corrections panel directly above the chat composer (the same region
used by the mid-turn prompt queue panel) whenever the feature is enabled and a check has
produced at least one suggestion. The panel SHALL display a one-line grammar **summary** and,
for each suggestion, its change (`original` → `replacement`), rendered in one of two
presentations governed by the `correctionView` setting: the default **inline redline** (the
whole draft on one line with each change shown in place) or the **list** (aligned before→after
rows). In every presentation the composer itself SHALL remain a plain `<textarea>` — all
highlighting lives in the panel — and the panel SHALL NOT block or alter the draft until the
user applies a correction.

#### Scenario: Panel appears after a check with suggestions
- **WHEN** a check returns one or more suggestions
- **THEN** the panel SHALL appear above the composer showing the summary and each change in the
  presentation selected by `correctionView`

#### Scenario: No issues found
- **WHEN** a check returns zero suggestions
- **THEN** the panel SHALL either stay hidden or show a transient "no issues found" state, and
  SHALL NOT block or alter the draft

#### Scenario: Panel is dismissible
- **WHEN** the user closes the panel
- **THEN** the panel SHALL hide and the draft SHALL be unchanged

#### Scenario: Presentation follows correctionView
- **WHEN** `correctionView` is `redline` (or unset)
- **THEN** the panel SHALL render the inline redline presentation
- **WHEN** `correctionView` is `list`
- **THEN** the panel SHALL render the list presentation

#### Scenario: Long-sentence correction highlights only the delta
- **WHEN** a suggestion changes only part of a long draft
- **THEN** the inline redline SHALL render the surrounding words neutral and highlight only the
  changed span in place (its `original` plus the `replacement`), NOT the entire draft

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

### Requirement: Correction view is selectable and defaults to redline

The panel presentation SHALL be governed by `plugins.grammar.correctionView`, a value of
`"redline"` or `"list"` defaulting to `"redline"`. The client SHALL receive this value from
`GET /api/grammar/health` alongside the other non-secret config, so the composer selects the
presentation from the single health fetch it already makes. When the value is absent or
unrecognised the client SHALL use `redline`.

#### Scenario: Default is redline when unset
- **WHEN** `plugins.grammar.correctionView` has never been set
- **THEN** `GET /api/grammar/health` SHALL report `correctionView: "redline"`
- **AND** the composer SHALL render the inline redline presentation

#### Scenario: List when configured
- **WHEN** `plugins.grammar.correctionView` is `"list"`
- **THEN** the health response SHALL report `correctionView: "list"`
- **AND** the composer SHALL render the list presentation

### Requirement: Inline redline presentation with a remembered mode

The inline redline SHALL render the checked draft as one flowing line, locating each active
suggestion's `original` span in the current draft (preferring the recorded `offset`, falling
back to a forward search for `original`) and splicing it in place; a suggestion whose span can
no longer be located SHALL be dropped from the redline rather than rendered at a wrong position.
It SHALL offer four **modes** — `redline`, `compact`, `original`, `corrected` — via a segmented
toggle, and SHALL remember the last chosen mode across reloads in client storage
(`localStorage` key `grammar.correctionMode`), defaulting to `redline` and falling back to
`redline` for any unrecognised stored value.

- **redline** (default): unchanged words neutral; each change shows `original`
  dotted-underlined in its kind colour plus the `replacement` inline as a success-coloured
  ghost; activating a change applies only that change.
- **compact**: each change shows `original` with a wavy kind-coloured underline; focusing or
  hovering a change reveals a popover with **Apply** and **Ignore**.
- **original**: read-only — each change's `original` tinted with the error colour, no apply.
- **corrected**: read-only — each change's `replacement` tinted with the success colour, no apply.

#### Scenario: Redline mode shows the fix in place
- **WHEN** the panel is in `redline` mode with locatable suggestions
- **THEN** each change SHALL render `original` (kind-coloured, dotted) followed by an inline
  ghost of `replacement`, with the surrounding words neutral

#### Scenario: Compact mode reveals Apply / Ignore
- **WHEN** the panel is in `compact` mode and the user focuses or hovers a change
- **THEN** a popover SHALL offer **Apply** (applies that change) and **Ignore** (removes it
  without changing the draft)

#### Scenario: Original and Corrected are read-only previews
- **WHEN** the panel is in `original` or `corrected` mode
- **THEN** it SHALL show the plain before / after text (changed spans tinted) and SHALL NOT
  apply anything on click

#### Scenario: Chosen mode is remembered
- **WHEN** the user selects a mode and the panel is later re-created (reload / new check)
- **THEN** the panel SHALL reopen in the last chosen mode read from `localStorage`

#### Scenario: Unrecognised stored mode falls back
- **WHEN** `localStorage["grammar.correctionMode"]` holds a value that is not one of the four
  modes
- **THEN** the panel SHALL render in `redline` mode

### Requirement: Per-change apply in the redline is offset-safe

Applying a single change from the inline redline (`redline` click / `compact` Apply) SHALL
replace only that suggestion's located span with its `replacement` via the controlled
`onDraftChange`, using the same offset-first / `indexOf`-fallback location as single-suggestion
accept, and SHALL NOT corrupt the draft when a span is stale. The redline SHALL also provide an
**Apply all** action that replaces the draft with `correctedText`, and applying a change SHALL
NOT auto-send the prompt.

#### Scenario: Apply one change in the redline
- **WHEN** the user activates a single change whose `original` still locates in the draft
- **THEN** only that span SHALL be replaced with `replacement`
- **AND** the prompt SHALL NOT be sent

#### Scenario: Apply all from the redline
- **WHEN** the user clicks Apply all
- **THEN** the draft SHALL become `correctedText` and the panel SHALL clear

#### Scenario: Stale change is not misapplied
- **WHEN** a change's span can no longer be located because the draft was edited
- **THEN** that change SHALL be dropped from the redline and SHALL NOT be applied at a wrong
  offset

### Requirement: List presentation shows before → after with kind and message

When `correctionView` is `list`, the panel SHALL render each suggestion as an aligned
**before → after** row — `original` (struck / error-coloured) and `replacement`
(success-coloured) in columns — with the suggestion's `kind` shown as a coloured pill and its
`message` on its own line. It SHALL retain per-row **Accept** and **Dismiss** and the
panel-level **Apply all** with the existing offset-safe behaviour.

#### Scenario: Columns carry every field
- **WHEN** the list presentation renders a suggestion
- **THEN** it SHALL show `original` → `replacement`, a `kind` pill, and the `message`

#### Scenario: Per-row accept still applies one
- **WHEN** the user clicks Accept on a list row whose `original` still matches
- **THEN** only that span SHALL be replaced with `replacement`

#### Scenario: Per-row dismiss removes without editing
- **WHEN** the user clicks Dismiss on a list row
- **THEN** the row SHALL be removed and the draft SHALL be unchanged

### Requirement: Suggestion kind is shown by colour but never as the sole channel

Every presentation SHALL map a suggestion's `kind` to a colour (`spelling` → error/red,
`grammar` → info/blue, `punctuation` → warning/orange, `style` → accent/purple, from the
existing theme tokens) for quick scanning, but colour SHALL NOT be the only way a change is
conveyed: the change SHALL also be encoded by its underline/strike treatment, its position in
the sentence (redline) or column (list), and an accessible label naming the `kind`, `original`,
`replacement`, and `message` (WCAG 1.4.1). Each change SHALL be keyboard-focusable with a
visible focus indicator.

#### Scenario: Kind colour is applied per kind
- **WHEN** a suggestion of a given `kind` renders
- **THEN** its change SHALL use that kind's colour token

#### Scenario: A change is conveyed without relying on colour
- **WHEN** colour is unavailable (e.g. a screen reader, or monochrome rendering)
- **THEN** the change SHALL still be conveyed by its underline/strike + position + an
  accessible label naming `kind`, `original`, `replacement`, and `message`

#### Scenario: Changes are keyboard reachable
- **WHEN** the user tabs through the panel
- **THEN** each change SHALL be focusable with a visible focus indicator, and an actionable
  change SHALL be applicable from the keyboard


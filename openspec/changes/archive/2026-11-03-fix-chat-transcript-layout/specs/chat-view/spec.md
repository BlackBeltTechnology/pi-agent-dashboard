## MODIFIED Requirements

### Requirement: Running bursts group live, auto-expanded, with an honest count

While a group contains a member whose `toolStatus` is `running`, the group SHALL form INCLUDING that running member (overriding the identical-call rule that never groups running tools) and SHALL render in the EXPANDED state so the live tool stays visible, UNLESS the group has more than 8 visible members (then it SHALL render COLLAPSED with its live header and stop control; see the size bound below). The header SHALL show an animated indeterminate spinner, the title `Working`, a `"N done"` count of COMPLETED visible members only, and the summary of the currently-running member. The header SHALL render an **indeterminate** shimmer/pulse animation to signal liveness. The header SHALL NOT display a total-count denominator or a determinate progress bar. When `prefers-reduced-motion: reduce` is set, animation SHALL be suppressed while the static `Working` / `N done` / live-command text remains.

The automatic expansion of a running group SHALL be bounded by size: a group with more than 8 visible members (counting the running member) SHALL NOT auto-expand when a member starts running, so a large collapsed group is never mounted in full by a new tool call. A user's manual toggle SHALL still expand it.

When the group boundary is reached and no member is running, the group SHALL render in the COLLAPSED state. A SINGLE-member group SHALL show a completion check, the member's tool icon, the member's one-line summary, and its duration (NOT the literal text `"1 tool calls"`). A MULTI-member group SHALL show a completion check, `"N tool calls"`, a per-tool-kind icon+count breakdown, and an aggregate duration. When any member has `toolStatus: "error"`, the completed header SHALL additionally render a `"N failed"` badge in the error color. A user's manual toggle of a specific group instance SHALL override the automatic expanded/collapsed default for that instance.

#### Scenario: Running group is expanded with an animated header
- **GIVEN** a group of 5 completed members followed by a 6th member with `toolStatus: "running"`
- **WHEN** the chat renders
- **THEN** the group SHALL render expanded, the header SHALL read `Working` with `5 done` and the running member's summary, an indeterminate animation SHALL play, and no total denominator SHALL appear

#### Scenario: Running group at the cap stays expanded
- **GIVEN** a group of 7 completed members followed by an 8th with `toolStatus: "running"` (8 visible members including the running one)
- **WHEN** the chat renders
- **THEN** the group SHALL render expanded

#### Scenario: Large running group stays collapsed
- **GIVEN** a collapsed group of 47 completed members, and a new tool call joins it with `toolStatus: "running"`
- **WHEN** the chat renders
- **THEN** the group SHALL stay collapsed, no historical member row SHALL mount, and the header SHALL read `Working` with `47 done`, the running member's summary and the stop control

#### Scenario: Manual toggle expands a large running group
- **GIVEN** a running group of 47 visible members rendered collapsed
- **WHEN** the user clicks the group header
- **THEN** the group SHALL expand and stay expanded until toggled again

#### Scenario: Reduced motion suppresses animation
- **GIVEN** a running group and `prefers-reduced-motion: reduce`
- **WHEN** the chat renders
- **THEN** no shimmer/pulse animation SHALL play, and the `Working` / `N done` / live-command text SHALL still render

#### Scenario: Single completed group shows its own summary
- **GIVEN** a single completed `Read` group bounded by HARD rows
- **WHEN** the chat renders
- **THEN** the collapsed header SHALL show the `Read` icon and the file summary and duration, NOT the text `"1 tool calls"`

#### Scenario: Multi completed group shows an icon breakdown
- **GIVEN** a completed group of 9 members (`3× grep`, `5× Read`, `1× git`)
- **WHEN** the chat renders
- **THEN** the collapsed header SHALL show `"9 tool calls"`, a per-kind icon+count breakdown, and an aggregate duration

#### Scenario: Failed member surfaces an error badge
- **GIVEN** a completed group where 1 of 6 members has `toolStatus: "error"`
- **WHEN** the chat renders
- **THEN** the collapsed header SHALL render a `"1 failed"` badge in the error color

#### Scenario: Count excludes the running member
- **GIVEN** a group with 5 completed members and 1 running member
- **THEN** the header count SHALL read `5 done`, not `6`

### Requirement: A display preference controls the tool-group default collapse state

The chat view SHALL expose a `toolGroupDefaultCollapsed` display preference (boolean, default `false`). It SHALL be settable at TWO scopes through the existing display-prefs plumbing: (1) a GLOBAL default, set in the `SettingsPanel` chat-display section (same surface as `reasoning` / `keepReasoningOpenUntilTurnEnds`), persisted to `~/.pi/dashboard/preferences.json#displayPrefs` and inherited by every session; and (2) a per-session OVERRIDE, toggleable from the `ChatViewMenu` "View" popover, persisted to `<session>.meta.json#displayPrefsOverride`. Effective value = `mergeDisplayPrefs(global, override)`. When `false` (default, unchanged behavior), a group's automatic open state follows run status — expanded while any member runs and the group has at most 8 visible members, collapsed otherwise (`expanded = override ?? (isRunning && visibleMembers <= 8)`). When `true`, a group SHALL default to COLLAPSED in every automatic state, INCLUDING while a member is running (`expanded = override ?? false`); the live/running animation and header remain, but the body starts closed. A user's per-instance manual toggle SHALL still override the preference for that instance. Legacy `displayPrefs` files lacking the field SHALL backfill to `false` at load. The `DISPLAY_PRESETS` (`simple`/`standard`/`everything`) SHALL each define the field. The preference SHALL NOT affect reasoning-block collapse (governed by `reasoningAutoCollapseMs` / `keepReasoningOpenUntilTurnEnds`), nor the nested `×N` `CollapsedToolGroup` (always manual, starts closed).

#### Scenario: Default off keeps status-following behavior
- **GIVEN** `toolGroupDefaultCollapsed` is false and a group of at most 8 visible members has a running member
- **WHEN** the chat renders
- **THEN** the group SHALL render expanded (unchanged)

#### Scenario: On keeps a running group collapsed
- **GIVEN** `toolGroupDefaultCollapsed` is true and a group has a running member
- **WHEN** the chat renders
- **THEN** the group SHALL render collapsed with its running header/animation, and its body SHALL be closed until clicked

#### Scenario: On keeps a completed group collapsed
- **GIVEN** `toolGroupDefaultCollapsed` is true and a completed group
- **WHEN** the chat renders
- **THEN** the group SHALL render collapsed (same as default-off completed behavior)

#### Scenario: Manual toggle still overrides the preference
- **GIVEN** `toolGroupDefaultCollapsed` is true and a running group rendered collapsed
- **WHEN** the user clicks the group header to expand it
- **THEN** that instance SHALL stay expanded regardless of the preference until toggled again

#### Scenario: Global default applies to sessions without an override
- **GIVEN** the global `toolGroupDefaultCollapsed` is set true in `SettingsPanel` and a session has NO per-session override for the field
- **WHEN** that session's chat renders
- **THEN** its groups SHALL default to collapsed (the global value is inherited)

#### Scenario: Per-session override beats the global default
- **GIVEN** the global `toolGroupDefaultCollapsed` is true and a session sets its per-session override to false in the View popover
- **WHEN** that session's chat renders
- **THEN** its groups SHALL follow run status (override wins over the global default)

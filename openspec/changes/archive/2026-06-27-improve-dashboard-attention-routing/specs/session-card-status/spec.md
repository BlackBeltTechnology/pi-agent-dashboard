# session-card-status — delta

## ADDED Requirements

### Requirement: ask_user state has dedicated rail and dot color

The session card SHALL render the chat-routed `ask_user` (blocked-on-you) state with a dedicated `--status-needs-you` color in its left-gutter rail (`deriveRailBgColor`) and status dot (`deriveDotColorWithFlags`), NOT the `active`/`idle` (green) color, when the prompt is NOT widget-bar-placed (per `useHasWidgetBarPrompt`). The source-icon tint (`deriveIconStatusColor`) SHALL mirror it so dot, rail, and
icon agree — restoring the documented "dot, source-icon tint, and rail always
agree" invariant.

Color precedence across dot, rail, and icon-tint SHALL be, highest to lowest:
`hasError` → `ask_user` (chat-routed) → `resuming`/`isRetrying` →
`streaming`/`currentTool` → `active`/`idle` → `ended`.

#### Scenario: Chat-routed ask_user rail and dot are needs-you, not green

- **WHEN** `session.currentTool === "ask_user"`
- **AND** the pending prompt is NOT widget-bar-placed
- **THEN** `deriveRailBgColor` SHALL return the `--status-needs-you` rail color
- **AND** `deriveDotColorWithFlags` SHALL return the `--status-needs-you` dot color
- **AND** neither SHALL return the `active`/`idle` green color

#### Scenario: Widget-bar ask_user keeps prior behavior

- **WHEN** `session.currentTool === "ask_user"`
- **AND** the pending prompt IS widget-bar-placed
- **THEN** rail and dot SHALL fall through to the `streaming`/`active` color (unchanged)

#### Scenario: Error outranks ask_user

- **WHEN** a session is both `ask_user` and `hasError`
- **THEN** rail and dot SHALL use the `--status-error` color

### Requirement: Status color is sourced from semantic tokens

The status helpers in `session-status-visuals.ts` SHALL source color from the
semantic tokens `--status-needs-you`, `--status-working`, `--status-idle`, and
`--status-error` rather than hardcoded palette literals (`purple-400`,
`green-500`, `amber-500`, `red-500`). Each token SHALL be defined for all themes
in `themes.ts` (base, dracula, nord, github, catppuccin, tokyo-night, rose-pine,
solarized, gruvbox), derived from that theme's existing accent tokens.

#### Scenario: No hardcoded status literals in helpers

- **WHEN** static analysis inspects `session-status-visuals.ts`
- **THEN** dot/rail/icon color derivation SHALL reference `--status-*` tokens
- **AND** SHALL NOT emit raw `purple-400`/`green-500`/`amber-500`/`red-500` for status state

#### Scenario: Tokens defined per theme

- **WHEN** any theme is active
- **THEN** all four `--status-*` tokens SHALL resolve to a defined value

### Requirement: Status dot encodes state by shape, not color alone

The session-card status dot SHALL differentiate state by **shape** in addition
to color: needs-you = filled, working = pulsing/half, idle = ring/outline,
error = cross. The shape distinction SHALL be present even when
`prefers-reduced-motion: reduce` is set.

#### Scenario: Shape differs per state under reduced motion

- **WHEN** `prefers-reduced-motion: reduce` is set
- **AND** two cards are in `ask_user` and `idle` states respectively
- **THEN** their dots SHALL be visually distinguishable by shape (filled vs ring)
- **AND** the distinction SHALL NOT depend on color alone

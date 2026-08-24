# token-stats-bar Specification

## Purpose

Visualises token usage per turn and against the context window. Defines the per-turn butterfly bar chart and context progress bar, their independent visibility gating and independent normalization, token counters and cost, the stats panel with scale labels, and the interaction and layout rules: click-to-scroll to a turn, cursor feedback on clickable bars, solid input bars, a fixed bar width cap, and a turn index carried on both `TurnStat` and messages.

## Requirements

### Requirement: Per-turn bar chart
The token stats bar SHALL display a mini bar chart showing token usage for each turn. Each bar SHALL be a stacked vertical bar with segments for cache read tokens (orange, `bg-orange-400`), cache write tokens (yellow, `bg-yellow-400`), input tokens (blue, `bg-blue-500`), and output tokens (purple, `bg-purple-500`). Bars SHALL be scaled relative to the maximum token count across all displayed turns.

#### Scenario: Multiple turns completed
- **WHEN** the session has completed 5 turns with varying token counts
- **THEN** the bar chart SHALL show 5 stacked bars, scaled so the tallest bar fills the chart height

#### Scenario: First turn
- **WHEN** the session completes its first turn
- **THEN** the bar chart SHALL show a single bar at full height

#### Scenario: Session with no turns
- **WHEN** the session has no completed turns
- **THEN** the bar chart area SHALL be empty (no bars rendered)

#### Scenario: Bar chart cap
- **WHEN** the session has more than 50 turns
- **THEN** the bar chart SHALL display only the most recent 50 turns

#### Scenario: Color coding per segment
- **WHEN** a turn bar is rendered with cacheRead=4100, cacheWrite=600, input=1100, output=800
- **THEN** the bar SHALL show orange (4100), yellow (600), blue (1100), purple (800) segments stacked bottom to top

### Requirement: Context window progress bar
The token stats bar SHALL display a stacked horizontal progress bar showing current context window usage, segmented by token category. The segments SHALL use the same color scheme as vertical bars: orange (cache read), yellow (cache write), blue (input), purple (output). The remaining unused context SHALL be dark gray. Labels SHALL show used tokens (left) and total context window (right).

The progress bar's value SHALL derive from the same shared session context-usage source the session card uses: the live event-reducer `contextUsage`, else the server-persisted `contextTokens` + `contextWindow` for that session. The content header and the session card SHALL therefore show the same context usage for the same session. When the value comes from the persisted fallback (no latest-turn breakdown), the bar SHALL render as a single proportioned fill rather than per-category segments.

The progress bar's visibility SHALL be gated by the `showContextBar` prop (default `true`), independent of the stats sections. The desktop content header SHALL drive `showContextBar` from the effective `contextUsageBar` display pref. When `showContextBar` is `false`, the progress bar SHALL NOT render even when context usage data is available.

#### Scenario: Context usage available
- **WHEN** context usage data is available with tokens=19100 and contextWindow=256000
- **THEN** the progress bar SHALL show approximately 7.5% filled with color segments proportioned by the latest turn's token breakdown, with labels "19.1k" and "256.0k"

#### Scenario: Persisted usage without live turn data
- **WHEN** the session has no live event-reducer `contextUsage` but carries persisted `contextTokens` and `contextWindow`
- **THEN** the progress bar SHALL render filled to the persisted percentage as a single segment, matching the session card for that session

#### Scenario: Context usage unavailable
- **WHEN** neither live nor persisted context usage data is available
- **THEN** the progress bar SHALL show as empty with no labels or a placeholder

#### Scenario: Context near capacity (>80%)
- **WHEN** context usage exceeds 80% of the context window
- **THEN** the progress bar fill color SHALL change to yellow warning

#### Scenario: Context critical (>90%)
- **WHEN** context usage exceeds 90% of the context window
- **THEN** the progress bar fill color SHALL change to red (`bg-red-500`) to indicate critical usage

#### Scenario: Progress bar suppressed by pref
- **GIVEN** `showContextBar = false`
- **WHEN** the token stats bar renders with context usage data present
- **THEN** the context-window progress bar SHALL NOT render

### Requirement: Independent visibility gating

The TokenStatsBar SHALL gate its two regions independently via two boolean props, each defaulting to `true`:

- `showStats` gates the butterfly chart, the stats panel, and the no-turns fallback stats line.
- `showContextBar` gates the context-window progress bar.

The desktop content header SHALL map the effective `tokenStatsBar` display pref to `showStats` and the effective `contextUsageBar` display pref to `showContextBar`, where each effective value is `sessionOverride ?? global ?? true`. The header SHALL mount the TokenStatsBar when either `showStats` or `showContextBar` is enabled, and SHALL render nothing when both are disabled.

#### Scenario: Stats off, context bar on
- **GIVEN** effective `tokenStatsBar = false` and `contextUsageBar = true`
- **WHEN** the content header renders for a session with context usage data
- **THEN** the butterfly chart and stats panel SHALL NOT render
- **AND** the context-window progress bar SHALL render

#### Scenario: Stats on, context bar off
- **GIVEN** effective `tokenStatsBar = true` and `contextUsageBar = false`
- **WHEN** the content header renders for a session with turn data
- **THEN** the butterfly chart and stats panel SHALL render
- **AND** the context-window progress bar SHALL NOT render

#### Scenario: Both off
- **GIVEN** effective `tokenStatsBar = false` and `contextUsageBar = false`
- **WHEN** the content header renders
- **THEN** no TokenStatsBar SHALL be mounted

#### Scenario: Both on
- **GIVEN** effective `tokenStatsBar = true` and `contextUsageBar = true`
- **WHEN** the content header renders for a session with turn and context data
- **THEN** both the butterfly chart + stats panel and the context-window progress bar SHALL render

### Requirement: Token counters and cost
The token stats bar SHALL display accumulated input token count, output token count, and total cost. Below the counters, a color-coded legend SHALL show per-category token counts from the latest turn: orange label for cache read, yellow label for cache write, blue label for input, purple label for output.

#### Scenario: Stats display with legend
- **WHEN** the session has accumulated 45200 input tokens, 12100 output tokens, $0.23 cost, and the latest turn has cacheRead=4100, cacheWrite=600, input=1100, output=800
- **THEN** the stats bar SHALL display "↓45.2k ↑12.1k $0.23" and a legend row "🟠 4.1k read  🟡 0.6k write  🔵 1.1k in  🟣 0.8k out"

#### Scenario: Zero stats
- **WHEN** the session has no token usage yet
- **THEN** the counters SHALL display "↓0" "↑0", cost SHALL be hidden, and no legend SHALL be shown

### Requirement: Stats bar layout
The token stats bar SHALL render between the `SessionHeader` and `ChatView` in the session panel. It SHALL be a compact horizontal strip. Its stats sections SHALL be gated by the `showStats` prop (default `true`), driven by the effective `tokenStatsBar` display pref; its context-window progress bar SHALL be gated by `showContextBar` (see "Context window progress bar"). The strip SHALL mount only when at least one of `showStats` or `showContextBar` is enabled.

#### Scenario: Session selected with stats enabled
- **WHEN** a session is selected and `showStats` is enabled
- **THEN** the stats bar SHALL be visible showing that session's token data

#### Scenario: No session selected
- **WHEN** no session is selected
- **THEN** the stats bar SHALL not be rendered

#### Scenario: Both regions disabled
- **WHEN** a session is selected but both `showStats` and `showContextBar` are disabled
- **THEN** the stats bar SHALL not be rendered

### Requirement: Token stats bar styling
The token stats bar SHALL use theme-aware CSS variables for all background, text, and border colors instead of hardcoded Tailwind dark-mode classes.

#### Scenario: Token stats bar adapts to theme
- **WHEN** the theme changes between light and dark
- **THEN** the token stats bar backgrounds, text colors, and borders update to match the active theme

### Requirement: Butterfly chart layout
The TokenStatsBar SHALL render a mirrored butterfly chart with input bars growing upward and output bars growing downward, separated by a center axis.

#### Scenario: Two-half rendering
- **WHEN** turnStats contains entries
- **THEN** the chart renders an upper half for input and a lower half for output, each 13px tall

#### Scenario: Center axis visible
- **WHEN** turnStats contains at least one entry
- **THEN** a 1px border separates the upper and lower halves

### Requirement: Independent normalization
Each half of the butterfly chart SHALL be normalized independently to its own maximum value.

#### Scenario: Input normalization
- **WHEN** turnStats contains turns with varying input+cacheRead totals
- **THEN** the tallest input bar fills 100% of the upper half height, and other bars scale proportionally to `max(input + cacheRead)`

#### Scenario: Output normalization
- **WHEN** turnStats contains turns with varying output totals
- **THEN** the tallest output bar fills 100% of the lower half height, and other bars scale proportionally to `max(output)`

#### Scenario: Asymmetric data is readable
- **WHEN** total input tokens are 50× larger than total output tokens
- **THEN** both halves show meaningful bar height variations (not one side squished)

### Requirement: Solid input bars
Input bars SHALL render as solid blue using `input + cacheRead` for height calculation. No visual distinction between cached and new input tokens in the bars.

#### Scenario: Bar height includes cache
- **WHEN** a turn has both cacheRead > 0 and input > 0
- **THEN** the input bar height is proportional to `(input + cacheRead) / maxInput`

#### Scenario: Solid color
- **WHEN** any turn is rendered
- **THEN** the input bar is solid `bg-blue-500` with no sub-segments

### Requirement: Stats panel with scale labels
The stats panel on the left SHALL display max-value scale labels with colored dots, cumulative totals, cache R/W, and cost.

#### Scenario: Scale labels displayed
- **WHEN** turnStats is non-empty
- **THEN** the stats panel shows `● ↓{maxInput}` (blue dot) and `● ↑{maxOutput}` (purple dot)

#### Scenario: Cumulative totals
- **WHEN** turnStats is non-empty
- **THEN** the stats panel shows `↓{tokensIn + cacheRead}` and `↑{tokensOut}`

#### Scenario: Cache and cost on one line
- **WHEN** cacheRead > 0 or cacheWrite > 0 or cost > 0
- **THEN** they appear on a single line: `R{cacheRead} W{cacheWrite} ${cost}`

#### Scenario: Label formatting
- **WHEN** values are displayed
- **THEN** values use `formatTokens` formatting (k/M suffixes)

### Requirement: Click-to-scroll
Clicking a bar with `turnIndex >= 0` SHALL scroll the ChatView to the corresponding turn's user message.

#### Scenario: Bar click triggers scroll
- **WHEN** user clicks on a bar with `turn.turnIndex >= 0`
- **THEN** the `onTurnClick` callback is called with `turn.turnIndex`

#### Scenario: Tool-only bars not clickable
- **WHEN** a bar has `turn.turnIndex === -1` (tool-only turn)
- **THEN** no click handler is attached and no cursor-pointer is shown

#### Scenario: ChatView scrolls to turn
- **WHEN** `scrollToTurn(turnIndex)` is called on ChatView
- **THEN** the scroll container scrolls instantly to the element with `data-turn="${turnIndex}"`

#### Scenario: Scroll does not fight auto-scroll
- **WHEN** `scrollToTurn` is called during streaming
- **THEN** a programmatic scroll guard suppresses auto-scroll for 200ms

### Requirement: Cursor feedback on clickable bars
Bars with `turnIndex >= 0` SHALL indicate clickability.

#### Scenario: Hover cursor
- **WHEN** user hovers over a bar with `turnIndex >= 0`
- **THEN** the cursor changes to pointer

#### Scenario: No cursor on tool-only bars
- **WHEN** user hovers over a bar with `turnIndex === -1`
- **THEN** the cursor remains default

### Requirement: Fixed bar width cap
Bars SHALL use `flex-1` with a max-width of `1/50th` when fewer than 50 bars are present.

#### Scenario: Few bars capped
- **WHEN** turnStats has fewer than 50 entries
- **THEN** each bar has `maxWidth: 2%` to match the width they'd have at 50 bars

#### Scenario: Full chart fills naturally
- **WHEN** turnStats has 50 entries
- **THEN** bars use `flex-1` without a max-width cap

### Requirement: Turn index on TurnStat and messages
The event reducer SHALL assign a `turnIndex` to both `TurnStat` and user messages for scroll targeting.

#### Scenario: Turn index assignment
- **WHEN** a `stats_update` event with `turnUsage` is processed and the last user message has no `turnIndex`
- **THEN** the user message gets `turnIndex = turnCount`, `turnCount` increments, and the `TurnStat` gets the same `turnIndex`

#### Scenario: Tool-only turn
- **WHEN** a `stats_update` event is processed but the last user message already has a `turnIndex`
- **THEN** `turnCount` does NOT increment and the `TurnStat` gets `turnIndex = -1`

#### Scenario: ChatView data attributes
- **WHEN** ChatView renders a user message with a `turnIndex`
- **THEN** the DOM element has a `data-turn` attribute set to that index

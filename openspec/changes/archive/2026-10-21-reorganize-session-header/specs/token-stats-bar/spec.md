## REMOVED Requirements

### Requirement: Context window progress bar
**Reason**: Replaced by the context ring in the session header (see the `session-header` capability). Two context indicators repeated each other and the bar row cost vertical space on every width.
**Migration**: The ring reads the same shared session context-usage source (live `contextUsage`, else persisted `contextTokens` + `contextWindow`), so the header and the session card still agree. The `contextUsageBar` display preference keeps its key and default and now gates the ring. The `showContextBar` prop on `TokenStatsBar` is removed.

## MODIFIED Requirements

### Requirement: Independent visibility gating

Two display preferences SHALL gate two separate surfaces, each effective value being `sessionOverride ?? global ?? true`:

- `tokenStatsBar` gates the stats chart and panel in the TokenStatsBar. `TokenStatsBar` takes a `showStats` prop (default `true`) that gates the butterfly chart, the stats panel, and the no-turns fallback stats line.
- `contextUsageBar` gates the context ring in the session header.

The desktop content header SHALL map the effective `tokenStatsBar` value to `showStats` and SHALL mount the TokenStatsBar only when `showStats` is enabled. The effective `contextUsageBar` value SHALL decide whether the header renders the context ring. Neither preference SHALL affect the other surface.

#### Scenario: Stats off, context bar on
- **GIVEN** effective `tokenStatsBar = false` and `contextUsageBar = true`
- **WHEN** the content header renders for a session with context usage data
- **THEN** the butterfly chart and stats panel SHALL NOT render
- **AND** the context ring in the session header SHALL render

#### Scenario: Stats on, context bar off
- **GIVEN** effective `tokenStatsBar = true` and `contextUsageBar = false`
- **WHEN** the content header renders for a session with turn data
- **THEN** the butterfly chart and stats panel SHALL render
- **AND** the context ring in the session header SHALL NOT render

#### Scenario: Both off
- **GIVEN** effective `tokenStatsBar = false` and `contextUsageBar = false`
- **WHEN** the content header renders
- **THEN** no TokenStatsBar SHALL be mounted
- **AND** no context ring SHALL render in the session header

#### Scenario: Both on
- **GIVEN** effective `tokenStatsBar = true` and `contextUsageBar = true`
- **WHEN** the content header renders for a session with turn and context data
- **THEN** both the butterfly chart + stats panel and the context ring in the session header SHALL render

### Requirement: Stats bar layout
The token stats bar SHALL render between the `SessionHeader` and `ChatView` in the session panel. It SHALL be a compact horizontal strip. Its stats sections SHALL be gated by the `showStats` prop (default `true`), driven by the effective `tokenStatsBar` display pref. The strip SHALL mount only when `showStats` is enabled. It SHALL NOT render a context-window progress bar; context usage is shown by the context ring in the session header.

#### Scenario: Session selected with stats enabled
- **WHEN** a session is selected and `showStats` is enabled
- **THEN** the stats bar SHALL be visible showing that session's token data

#### Scenario: No session selected
- **WHEN** no session is selected
- **THEN** the stats bar SHALL not be rendered

#### Scenario: Both regions disabled
- **WHEN** a session is selected but `showStats` is disabled
- **THEN** the stats bar SHALL not be rendered
- **AND** the header context ring remains governed only by the `contextUsageBar` preference

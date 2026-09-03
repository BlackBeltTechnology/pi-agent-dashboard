## ADDED Requirements

### Requirement: Inline-flow rendering mode for reasoning bodies
The system SHALL support an inline-flow rendering mode for reasoning blocks, controlled by the `reasoningInlineFlow` display preference (default `false`). When enabled, an expanded reasoning block's body SHALL render with no height cap and no inner vertical scrollbar, flowing down the chat transcript like any other row. When disabled, the body SHALL render with today's bounded height and inner scroll. The preference SHALL govern the body's HEIGHT ONLY and SHALL be orthogonal to all open/closed collapse behavior: the auto-collapse timer, the turn-scoped hold, manual toggling, and the live/replayed mount defaults SHALL behave identically in both modes.

#### Scenario: Default keeps the bounded scrollbox
- **WHEN** `reasoningInlineFlow` is `false` (including all preset defaults and legacy preferences without the field)
- **THEN** an expanded reasoning body SHALL render with the existing bounded height and inner vertical scrollbar

#### Scenario: Inline flow removes the height cap
- **WHEN** `reasoningInlineFlow` is `true` and a reasoning block is expanded
- **THEN** the body SHALL render at its natural height with no vertical height cap and no inner vertical scrollbar
- **AND** the body SHALL remain clipped horizontally only (long lines scroll horizontally, not wrap-forced)

#### Scenario: Orthogonal to collapse behavior
- **WHEN** `reasoningInlineFlow` is `true`
- **THEN** live blocks SHALL still mount expanded and auto-collapse per `reasoningAutoCollapseMs` unless `keepReasoningOpenUntilTurnEnds` holds them
- **AND** replayed blocks SHALL still mount collapsed
- **AND** manual toggling SHALL still pin the block's open/closed state

#### Scenario: Applies to every first-party reasoning mount site
- **WHEN** a reasoning block renders in a first-party surface — in the ChatView message list, as the live streaming-thinking tail, or as an absorbed thinking block inside a tool-call group
- **THEN** the same `reasoningInlineFlow` preference SHALL govern its body height
- **AND** plugin-rendered thinking blocks (the `ThinkingBlockPrimitive` ui-primitive registration, which has no prefs access) SHALL keep today's bounded body — out of scope for this change

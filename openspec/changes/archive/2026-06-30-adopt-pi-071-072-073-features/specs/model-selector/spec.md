## ADDED Requirements

### Requirement: Thinking-level selector filters per model

`ModelInfo` SHALL carry an optional `supportedThinkingLevels?: string[]` field populated by the bridge from pi 0.72+'s per-model `thinkingLevelMap`. The bridge SHALL include only the keys whose value is non-null (a `null` value in `thinkingLevelMap` means "this pi level is not supported by this model" and SHALL NOT be surfaced).

The dashboard's `ThinkingLevelSelector` SHALL render only the levels in `supportedThinkingLevels` when the array is non-empty, preserving the canonical ordering `off, minimal, low, medium, high, xhigh`. When the field is undefined or empty (pre-0.72 pi or models without a declared map), the selector SHALL render all six levels — preserving today's behavior as a fallback.

#### Scenario: Anthropic model exposes a subset
- **WHEN** an Anthropic model has `thinkingLevelMap: { medium: "medium", high: "high", xhigh: null }`
- **THEN** `ModelInfo.supportedThinkingLevels` SHALL be `["medium", "high"]`
- **AND** the selector SHALL render exactly two options: medium and high

#### Scenario: Pre-0.72 model with no map
- **WHEN** the model object has no `thinkingLevelMap` field
- **THEN** `ModelInfo.supportedThinkingLevels` SHALL be undefined
- **AND** the selector SHALL render all six levels (today's fallback)

#### Scenario: Model selector dropdown unaffected
- **WHEN** the user opens the model selector
- **THEN** all available models SHALL still appear regardless of their `supportedThinkingLevels` (filtering applies only to the thinking-level selector)

# model-selector — spec delta

## MODIFIED Requirements

### Requirement: Thinking-level selector filters per model

`ModelInfo` SHALL carry an optional `supportedThinkingLevels?: string[]` field
populated by the bridge using a projection that reproduces pi's canonical
`getSupportedThinkingLevels` rule verbatim — the same rule pi core uses to clamp
thinking level — so the dashboard and pi agree. (The rule is inlined in the
bridge rather than imported from `@earendil-works/pi-ai`, whose shipped `.d.ts`
re-exports via `.ts` extensions that the repo tsconfig cannot resolve; the
contract is pinned below.)

`thinkingLevelMap` is a **sparse override table**, NOT an allowlist. The bridge
SHALL derive supported levels by pi's rule, not by enumerating declared keys:

- If the model is not a reasoning model (`reasoning !== true`), supported levels
  SHALL be `["off"]`.
- Otherwise, for each canonical level in order `off, minimal, low, medium, high,
  xhigh`: the level SHALL be included UNLESS `thinkingLevelMap[level] === null`
  (explicitly disabled), EXCEPT `xhigh`, which SHALL be included only when
  `thinkingLevelMap["xhigh"] !== undefined` (declared with any non-null value).
- A level whose key is **absent** from `thinkingLevelMap` SHALL be treated as
  supported (default), not excluded.

The bridge SHALL emit `supportedThinkingLevels` only when the model exposes
thinking metadata (a `reasoning` flag or a `thinkingLevelMap`). When the model
carries neither (pre-0.72 pi), the field SHALL be `undefined`.

The dashboard's `ThinkingLevelSelector` SHALL render only the levels in
`supportedThinkingLevels` when the array is non-empty, preserving the canonical
ordering `off, minimal, low, medium, high, xhigh`. When the field is undefined or
empty, the selector SHALL render all six levels as a fallback.

#### Scenario: Sparse reasoning map surfaces all non-disabled levels

- **WHEN** a reasoning model has `thinkingLevelMap: { xhigh: "xhigh" }` (e.g.
  `claude-opus-4-8`, `reasoning: true`)
- **THEN** `ModelInfo.supportedThinkingLevels` SHALL be
  `["off", "minimal", "low", "medium", "high", "xhigh"]`
- **AND** a session whose current level is `high` SHALL find `high` present in
  the dropdown (no orphaned, non-selectable trigger value)

#### Scenario: Dense map with a disabled level drops only that level

- **WHEN** a reasoning model has
  `thinkingLevelMap: { medium: "medium", high: "high", xhigh: null }`
- **THEN** `ModelInfo.supportedThinkingLevels` SHALL be
  `["off", "minimal", "low", "medium", "high"]` (`xhigh` excluded because it is
  `null`; unmentioned lower levels remain supported)

#### Scenario: Non-reasoning model supports only off

- **WHEN** a model has `reasoning: false`
- **THEN** `ModelInfo.supportedThinkingLevels` SHALL be `["off"]`

#### Scenario: Reasoning model with no map supports all levels except xhigh

- **WHEN** a model has `reasoning: true` and no `thinkingLevelMap`
- **THEN** `ModelInfo.supportedThinkingLevels` SHALL be
  `["off", "minimal", "low", "medium", "high"]` (`xhigh` excluded because it is
  supported only when declared with an explicit non-null `thinkingLevelMap`
  entry)

#### Scenario: Model without thinking metadata falls back to all six

- **WHEN** the model object has neither a `reasoning` flag nor a
  `thinkingLevelMap` (pre-0.72 pi)
- **THEN** `ModelInfo.supportedThinkingLevels` SHALL be undefined
- **AND** the `ThinkingLevelSelector` SHALL render all six canonical levels

#### Scenario: Filtering never removes models from the model list

- **WHEN** models carry differing `supportedThinkingLevels`
- **THEN** all available models SHALL still appear in the model selector
  regardless of their `supportedThinkingLevels` (the filter applies only to the
  thinking-level dropdown, never to the model list)

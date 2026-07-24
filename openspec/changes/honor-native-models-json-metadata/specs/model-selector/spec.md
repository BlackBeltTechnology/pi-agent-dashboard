# model-selector — delta

## MODIFIED Requirements

### Requirement: Thinking-level selector filters per model

`ModelInfo` SHALL carry an optional `supportedThinkingLevels?: string[]` field
populated by a projection that reproduces pi's canonical `getSupportedThinkingLevels`
rule verbatim — the same rule pi core uses to clamp thinking level — so the dashboard and
pi agree. (The rule is inlined rather than imported from `@earendil-works/pi-ai`, whose
shipped `.d.ts` re-exports via `.ts` extensions that the repo tsconfig cannot resolve;
the contract is pinned below.)

`thinkingLevelMap` is a **sparse override table**, NOT an allowlist. Supported levels
SHALL be derived by pi's rule, not by enumerating declared keys:

- If the model is not a reasoning model (`reasoning !== true`), supported levels SHALL be
  `["off"]`.
- Otherwise, for each canonical level in order `off, minimal, low, medium, high, xhigh,
  max`: the level SHALL be included UNLESS `thinkingLevelMap[level] === null` (explicitly
  disabled), EXCEPT the opt-in high tiers `xhigh` and `max`, each of which SHALL be
  included only when its `thinkingLevelMap` entry is declared with a non-null value. The
  derivation MUST implement an explicit `max` branch (`if (level === "max") return
  maxSupported && map.max != null`) — simply appending `max` to the canonical list without
  this branch would fail OPEN (`undefined !== null` is true), advertising `max` for every
  reasoning model. `maxSupported` SHALL be passed into the derivation (not read from a
  hardcoded constant).
- **`max` is additionally runtime-capability-gated.** `max` SHALL be included ONLY when
  the **session's** pi runtime (the runtime inside which the bridge executes — the reachable
  place for `max`, e.g. pi 0.80.10) advertises `max` in its canonical thinking-level set
  AND `thinkingLevelMap["max"]` is declared non-null. When the runtime does NOT advertise
  `max`, `max` SHALL never be surfaced, regardless of `thinkingLevelMap`. The dashboard
  server's own introspection derivation (pinned pi-ai without `max`) SHALL never emit `max`.
- A level whose key is **absent** from `thinkingLevelMap` SHALL be treated as supported
  (default), not excluded.

The projection SHALL emit `supportedThinkingLevels` only when the model exposes thinking
metadata (a `reasoning` flag or a `thinkingLevelMap`). When the model carries neither
(pre-0.72 pi), the field SHALL be `undefined`.

There SHALL be exactly ONE authored `supportedThinkingLevels` derivation (in the bridge
extension), parameterized by `maxSupported`. The dashboard server SHALL NOT derive this
list — its `/api/models` route passes through the raw `thinkingLevelMap` for agent
consumers.

The dashboard's `ThinkingLevelSelector` SHALL render only the levels in
`supportedThinkingLevels` when the array is non-empty, preserving the canonical ordering
`off, minimal, low, medium, high, xhigh, max`. When the field is undefined or empty, the
selector SHALL render the default six levels (`off, minimal, low, medium, high, xhigh`)
as a fallback; `max` SHALL never appear in the fallback set.

#### Scenario: Native map opting into max on a max-capable runtime

- **GIVEN** the installed runtime advertises `max` in its canonical thinking-level set
- **WHEN** a reasoning model has `thinkingLevelMap: { minimal: null, low: null, medium: null, high: null, xhigh: null, max: "max" }`
- **THEN** `supportedThinkingLevels` SHALL be `["off", "max"]`
- **AND** the selector SHALL render `off` and `max` only

#### Scenario: max is suppressed on a runtime without max

- **GIVEN** the installed runtime's canonical set is `off, minimal, low, medium, high, xhigh` (no `max`)
- **WHEN** a reasoning model has `thinkingLevelMap: { max: "max" }`
- **THEN** `max` SHALL NOT appear in `supportedThinkingLevels`
- **AND** the selector SHALL NOT render a `max` option

#### Scenario: Sparse reasoning map surfaces all non-disabled levels

- **WHEN** a reasoning model has `thinkingLevelMap: { xhigh: "xhigh" }` (e.g. `claude-opus-4-8`, `reasoning: true`) on a runtime without `max`
- **THEN** `supportedThinkingLevels` SHALL be `["off", "minimal", "low", "medium", "high", "xhigh"]`
- **AND** a session whose current level is `high` SHALL find `high` present in the dropdown (no orphaned, non-selectable trigger value)

#### Scenario: Dense map with a disabled level drops only that level

- **WHEN** a reasoning model has `thinkingLevelMap: { medium: "medium", high: "high", xhigh: null }`
- **THEN** `supportedThinkingLevels` SHALL be `["off", "minimal", "low", "medium", "high"]` (`xhigh` excluded because it is `null`; unmentioned lower levels remain supported)

#### Scenario: Non-reasoning model supports only off

- **WHEN** a model has `reasoning: false`
- **THEN** `supportedThinkingLevels` SHALL be `["off"]`

#### Scenario: Reasoning model with no map supports all levels except xhigh and max

- **WHEN** a model has `reasoning: true` and no `thinkingLevelMap`
- **THEN** `supportedThinkingLevels` SHALL be `["off", "minimal", "low", "medium", "high"]` (`xhigh` and `max` excluded because each is supported only when declared with an explicit non-null `thinkingLevelMap` entry)

#### Scenario: Model without thinking metadata falls back to all six

- **WHEN** the model object has neither a `reasoning` flag nor a `thinkingLevelMap` (pre-0.72 pi)
- **THEN** `supportedThinkingLevels` SHALL be undefined
- **AND** the `ThinkingLevelSelector` SHALL render the default six canonical levels (no `max`)

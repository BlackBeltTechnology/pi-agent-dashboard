## ADDED Requirements

### Requirement: Chain slots render role refs and notices through the shared recipes
A role-bound chain entry's summary SHALL render its ref through the shared role-ref display (`data-testid="blackhole-chain-<worker>-entry-<i>-role"` kept on the role token) and its binding status per `role-model-bindings` "Binding status reads the same everywhere" (`…-role-status` + `data-status` kept). The level-drop notice (`blackhole-chain-<worker>-<i>-level-drop`) SHALL be a warning-severity callout with an icon and no emoji, reading "Thinking level <level> isn't supported by <model>, so the level was dropped." (the base requirement "Model fallback chains are editable as ordered lists" requires the notice to state that the level was dropped). The `RoleRef` model in a slot summary SHALL be the concrete value currently in `pi-blackhole-config.json`, so a detached or dangling slot still shows that value (base scenario "Slot shows binding status"). Severity tokens in `BlackholeSettings.tsx` SHALL be referenced without hex fallbacks (`var(--severity-error-border)`, not `var(--severity-error-border,#ef4444)`).

#### Scenario: Level drop uses the shared notice
- **WHEN** a chain entry's model is changed to one that does not support its thinking level `high`
- **THEN** the level-drop element is a warning callout whose text contains "high" and "so the level was dropped", and contains no emoji

#### Scenario: No hex fallbacks remain
- **WHEN** `BlackholeSettings.tsx` is scanned
- **THEN** no `var(--severity-*,#…)` fallback form remains

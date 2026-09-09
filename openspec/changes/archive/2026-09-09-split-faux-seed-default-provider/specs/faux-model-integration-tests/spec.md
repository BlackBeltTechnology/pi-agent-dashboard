# faux-model-integration-tests Delta

## ADDED Requirements

### Requirement: Deterministic faux default-model seed in the docker harness

The docker harness settings-seed step in `docker/test-entrypoint.sh` SHALL pin the faux model as pi's deterministic startup default using pi-0.84's split settings shape: it SHALL write `defaultProvider: "faux"` and `defaultModel: "faux-1"` (bare model id) into `~/.pi/agent/settings.json`, NOT the combined `"faux/faux-1"` string in `defaultModel` alone. The seed SHALL be a JSON-aware idempotent merge whose entire mutation is gated on the absence of `defaultProvider`: when `defaultProvider` is already present the seed SHALL make no change. When `defaultProvider` is absent, the seed SHALL normalize an existing combined `defaultModel` (one containing `/`) by splitting it into a `defaultProvider` prefix and a bare-id `defaultModel` suffix; otherwise it SHALL set `defaultProvider: "faux"` and, only when `defaultModel` is absent, `defaultModel: "faux-1"`. It SHALL write only when a change occurred. When the settings file exists but is not valid JSON, the seed SHALL leave it untouched rather than overwrite it.

#### Scenario: Fresh harness boot seeds the split shape

- **WHEN** the harness boots under `PI_E2E_SEED` with no prior `~/.pi/agent/settings.json`
- **THEN** the seeded `settings.json` contains `defaultProvider: "faux"` and `defaultModel: "faux-1"`
- **AND** it does NOT contain a combined `"faux/faux-1"` value in `defaultModel`

#### Scenario: pi selects faux as the startup default from the seed

- **WHEN** a pi session starts in the harness reading the seeded `settings.json`
- **THEN** pi's startup model resolution selects `faux/faux-1` via the saved-default path (`defaultProvider` + `defaultModel`), not via the "first available model" fallback

#### Scenario: Pre-split settings file is normalized and repaired

- **WHEN** the seed runs against an existing `settings.json` that has `defaultModel: "faux/faux-1"` and no `defaultProvider`
- **THEN** the seed sets `defaultProvider: "faux"` AND rewrites `defaultModel` to the bare `"faux-1"`
- **AND** the resulting file contains no combined `"faux/faux-1"` value

#### Scenario: Correct split file is a no-op

- **WHEN** the seed runs against a `settings.json` that already has `defaultProvider: "faux"` and `defaultModel: "faux-1"`
- **THEN** the seed makes no change and does not rewrite the file

#### Scenario: Existing provider with a slash-bearing bare model is not mangled

- **WHEN** the seed runs against a `settings.json` that has `defaultProvider: "openrouter"` and `defaultModel: "anthropic/claude-3.5"`
- **THEN** the seed makes no change (the `defaultProvider` gate skips the whole block)
- **AND** the slash-bearing bare `defaultModel` is preserved intact, not split

#### Scenario: Unparseable settings file is left untouched

- **WHEN** the seed runs against an existing `settings.json` whose contents are not valid JSON
- **THEN** the seed does not overwrite the file
- **AND** the seed exits without error

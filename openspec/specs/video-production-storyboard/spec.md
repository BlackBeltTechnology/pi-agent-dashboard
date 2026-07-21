# video-production-storyboard Specification

## Purpose

Generate the per-shot first-frame storyboard sketch images (and the master world anchor) for a shot package. Each sketch is a PNG produced from a text prompt via the nano-banana batch generator, and these PNGs are later fed to the renderer as image-to-video starting frames. Prompts are read from `<package>/storyboard/sketch_prompts.json`, and one PNG is written per prompt key into the same `storyboard/` directory.

## Requirements

### Requirement: Prompt source resolution and validation

The system SHALL read storyboard prompts from the shot package's `storyboard/sketch_prompts.json` file, which maps each sketch key to its generation prompt.

#### Scenario: Missing prompts file

- **WHEN** `generateStoryboard` runs and `<package>/storyboard/sketch_prompts.json` does not exist
- **THEN** it throws an error whose message is the resolved prompts file path followed by `not found`
- **AND** no sketches are generated

#### Scenario: Missing API key

- **WHEN** the prompts file exists but no GEMINI/VEO API key can be resolved from the CLI key, environment, project `.env`, or package `.env`
- **THEN** it throws an error `no GEMINI/VEO API key (env, project .env, or package .env)`

#### Scenario: Valid prompts file

- **WHEN** `storyboard/sketch_prompts.json` exists and parses to an object of `{ "<key>": "<prompt>" }` entries
- **THEN** each key (e.g. `shot_01`, `00_world_anchor`) becomes one generation job
- **AND** the returned run reports the `storyboardDir`, the resolved key `keySource`, and the batch `results` (`BatchResult[]`)

### Requirement: One PNG per shot key

The system SHALL generate one PNG per selected prompt key, named `<key>.png`, written into the package `storyboard/` directory.

#### Scenario: Output path per key

- **WHEN** a prompt key `shot_01` is generated
- **THEN** its output file is `<package>/storyboard/shot_01.png`

#### Scenario: Explicit jobs array

- **WHEN** the (filtered) prompt entries are prepared for generation
- **THEN** an explicit jobs array is built where each entry is `{ name, prompt, output }` with `output` set to `<package>/storyboard/<name>.png`, and that array is passed to `batchGenerate`

#### Scenario: Storyboard directory creation

- **WHEN** `generateStoryboard` runs
- **THEN** it creates the `storyboard/` directory (recursively) before generating

#### Scenario: Empty prompt set

- **WHEN** the (possibly filtered) prompt set contains no keys
- **THEN** no generation jobs run and the run returns an empty results list (`[]`)

### Requirement: Optional key-subset regeneration

The system SHALL support regenerating only a subset of sketch keys via the `only` option, ignoring all other keys in the prompts file.

#### Scenario: Subset filter applied

- **WHEN** `only` is provided with one or more keys (e.g. `["shot_01", "00_world_anchor"]`)
- **THEN** only prompt entries whose key is in that set are turned into jobs
- **AND** all other keys in `sketch_prompts.json` are skipped entirely

#### Scenario: No subset provided

- **WHEN** `only` is absent or empty
- **THEN** every key in `sketch_prompts.json` is generated

### Requirement: Bounded-concurrency batch generation

The system SHALL generate sketches through the nano-banana `batchGenerate`, forwarding a concurrency value that defaults to 3 when unspecified.

#### Scenario: Default concurrency

- **WHEN** `workers` is not specified
- **THEN** generation runs with concurrency 3

#### Scenario: Custom concurrency

- **WHEN** `workers` is specified
- **THEN** that value is forwarded as-is to `batchGenerate` as the `concurrency` argument

#### Scenario: Per-job progress

- **WHEN** an `onResult` callback is provided
- **THEN** it is forwarded to `batchGenerate` and invoked once per job with that job's `BatchResult` as generation completes

### Requirement: Force flag forwarding

The system SHALL forward the `force` flag to the nano-banana `batchGenerate`, which owns any skip/overwrite semantics; this module does not itself inspect existing PNGs.

#### Scenario: Force flag passed through

- **WHEN** `force` is set (or unset) on the options
- **THEN** that value is forwarded unchanged as the `force` argument to `batchGenerate`
- **AND** whether an existing PNG is skipped or regenerated is decided by `batchGenerate`, not by this module

# kb-config-and-init Specification

## Purpose
Provide a layered `knowledge_base.json` configuration for the KB — built-in defaults overridden by a global file, then by a project file, with deep-merge fill-in of nested option groups and shape validation. Scaffold and gitignore that config on `kb init`.

## Requirements

### Requirement: Layered configuration resolution
The KB SHALL resolve its effective configuration by layering three sources in precedence order: built-in defaults (lowest), the global file `~/.pi/dashboard/knowledge_base.json`, then the project file `.pi/dashboard/knowledge_base.json` (highest). The resolved config SHALL record its origin as `project`, `global`, or `defaults` based on the highest layer that supplied a file.

#### Scenario: No config files present
- **WHEN** neither the project file nor the global file exists
- **THEN** the effective config equals the built-in defaults
- **AND** the origin is `defaults`

#### Scenario: Only global file present
- **WHEN** the global file exists but the project file does not
- **THEN** fields from the global file override defaults and absent fields fall back to defaults
- **AND** the origin is `global`

#### Scenario: Project file present
- **WHEN** the project file exists
- **THEN** its fields take precedence over the global file and defaults
- **AND** the origin is `project`

#### Scenario: Explicit config path override
- **WHEN** an explicit config path is supplied
- **THEN** that file is read as the project layer instead of `.pi/dashboard/knowledge_base.json`

### Requirement: Deep-merge of nested option groups
The KB SHALL merge layers left-to-right, and for the known nested option groups (`chunking`, `dedup`, `graph`, `directoryLevelAgents`, `ranking`, `expand`, `rerank`, `queryExpansion`) SHALL fill in fields one level deep rather than replacing the whole group. All other keys SHALL be replaced wholesale by a later layer.

#### Scenario: Partial nested group keeps sibling defaults
- **WHEN** a layer sets only `ranking.proximityBoost` to false
- **THEN** the resolved `ranking` retains the default `fieldWeights` and `diversity` values while `proximityBoost` is false

#### Scenario: Non-nested key replaced wholesale
- **WHEN** a later layer supplies a top-level array or scalar key (e.g. `exclude`)
- **THEN** that value replaces the earlier layer's value entirely rather than merging

### Requirement: Configuration validation
The KB SHALL validate the merged configuration shape and throw a precise error when a constraint is violated. The validated constraints SHALL be: `sources` is an array; each source has a string `ref`; each source `kind` is one of `filesystem`, `npm`, `git`, `https` (defaulting to `filesystem` when omitted); `maxFileCount` is a number or null; `dbPath` is a non-empty string; and `queryExpansion.mode` is one of `off`, `prf`, `synonym`, `agent`.

#### Scenario: Source missing ref
- **WHEN** a source entry lacks a string `ref`
- **THEN** validation throws an error indicating each source needs a string `ref`

#### Scenario: Unknown source kind
- **WHEN** a source declares a `kind` outside the allowed set
- **THEN** validation throws an error naming the unknown kind

#### Scenario: Unknown query-expansion mode
- **WHEN** `queryExpansion.mode` is a value outside `off`/`prf`/`synonym`/`agent`
- **THEN** validation throws an error naming the unknown mode

#### Scenario: Malformed JSON in a config file
- **WHEN** a config file exists but contains invalid JSON
- **THEN** loading throws an error identifying the offending file path

### Requirement: Source resolution
The KB SHALL derive filesystem sources from both the legacy `roots[]` alias and the `sources[]` list, resolving each relative `ref` against the working directory, applying any `subdir`, and defaulting priority to 0. It SHALL also resolve `dbPath` and `sourceCacheDir` to absolute paths, expanding a leading `~/` in the cache dir to the home directory.

#### Scenario: Legacy roots aliased to filesystem sources
- **WHEN** the config contains `roots[]` entries
- **THEN** each root is treated as a `filesystem` source preserving its path and priority

#### Scenario: Relative dbPath resolved to absolute
- **WHEN** `dbPath` is the default relative `.pi/dashboard/kb/index.db`
- **THEN** it is resolved to an absolute path against the working directory

### Requirement: Config scaffolding on init
`kb init` SHALL write a `knowledge_base.json` seeded with the documented defaults plus any supplied filesystem sources, validate it before writing, and never overwrite an existing file unless `--force` is given. With `--global` it SHALL write `~/.pi/dashboard/knowledge_base.json`; otherwise it SHALL write the project file. With `--dry-run` it SHALL print the planned config and write nothing.

#### Scenario: Fresh project init
- **WHEN** `kb init` runs and no config file exists
- **THEN** it writes the project `.pi/dashboard/knowledge_base.json` with defaults and reports the write

#### Scenario: Existing config without force
- **WHEN** the target config file already exists and `--force` is not given
- **THEN** init throws an error stating the file exists and to pass `--force`

#### Scenario: Dry run
- **WHEN** `kb init` runs with `--dry-run`
- **THEN** it prints the planned config and writes no files

#### Scenario: Global init
- **WHEN** `kb init` runs with `--global`
- **THEN** it writes `~/.pi/dashboard/knowledge_base.json` and adds no gitignore entry

### Requirement: Gitignoring the index database
For a project (non-global) init, `kb init` SHALL add the resolved `dbPath` to the project `.gitignore`, unless the database path lies outside the working directory or the entry is already present.

#### Scenario: DB path added to gitignore
- **WHEN** a project init resolves `dbPath` inside the working directory and no matching entry exists
- **THEN** the project `.gitignore` gains a rooted entry for the DB path under a comment

#### Scenario: Entry already present
- **WHEN** the `.gitignore` already contains the DB entry
- **THEN** no duplicate entry is added

#### Scenario: DB outside project
- **WHEN** the resolved `dbPath` is outside the working directory
- **THEN** no project gitignore entry is added

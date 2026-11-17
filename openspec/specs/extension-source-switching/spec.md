# extension-source-switching Specification

## Purpose
Defines how the developer source-switching tool moves a monorepo pi package between its published npm build and its local working tree. It changes the global and project pi settings without ever leaving a settings shape that disables extensions belonging to another package. A repo check stops such a shape from being committed.

## Requirements

### Requirement: A switch SHALL leave exactly one source per package

Before adding the target form, a switch SHALL remove the package's `npm:<npmName>` entry and working-tree entries (its directory or any path under it) from the global `packages` list, matching both string entries and object entries by their `source`. It SHALL remove the package's `+packages/<dir>/…` paths from the `extensions` array of project object entries. `npm` then adds `npm:<npmName>`; `local` adds the package's absolute working-tree directory.

#### Scenario: Object and malformed entries do not break a switch
- **WHEN** the global list holds an object entry `{ "source": "npm:other-pkg", "skills": ["-x"] }`, and the project list holds `null` and an object without a string `source`
- **THEN** `status`, `local` and `npm` complete without error, and those entries are written back unchanged

#### Scenario: Local to npm replaces the working-tree entry
- **WHEN** the global list contains `<repo>/packages/kb-extension` and the user switches `kb-extension` to `npm`
- **THEN** the global list contains `npm:@blackbelt-technology/pi-dashboard-kb-extension`
- **AND** it no longer contains `<repo>/packages/kb-extension` or any path under it

#### Scenario: Npm to local replaces the npm entry
- **WHEN** the global list contains `npm:@blackbelt-technology/pi-dashboard-kb-extension` and the user switches `kb-extension` to `local`
- **THEN** the global list contains `<repo>/packages/kb-extension` and no `npm:` entry for that package

### Requirement: Removing a package from a project entry SHALL NOT leave an empty filter

During every switch, the tool SHALL repair each project `packages` object entry that lacks `autoload: false` and either held a path this switch removed or has a string `source` that resolves, against the project settings directory, to the repo root. Repair deletes every empty `extensions`, `skills`, `prompts` or `themes` array, then deletes the entry if that removed its last such key. An empty `packages` list SHALL be deleted.

#### Scenario: Last overlay path removed drops the entry and the list
- **WHEN** project settings hold `packages: [{ "source": "..", "extensions": ["+packages/kb-extension/src/index.ts"] }]` plus other top-level keys, and the user switches `kb-extension` to `local`
- **THEN** the written project settings file has no `packages` key
- **AND** every other top-level key is unchanged

#### Scenario: Entry with remaining paths is kept
- **WHEN** a project entry's `extensions` holds the switched package's path and one other path
- **THEN** the entry stays, and its `extensions` holds only the other path

#### Scenario: A leftover empty repo-root entry is repaired
- **WHEN** project settings already hold `packages: [{ "source": "..", "extensions": [] }]` and the user switches any package to `local` or `npm`
- **THEN** the written project settings file has no `packages` key

#### Scenario: Entry with another resource filter is kept
- **WHEN** a project entry holds only the switched package's path in `extensions` and also has `skills: ["some/skill"]`
- **THEN** the entry stays with its `skills` unchanged and no `extensions` key, so pi's default (load all manifest extensions) applies

#### Scenario: Every empty array on a repo-root entry is removed
- **WHEN** project settings hold `{ "source": "..", "extensions": ["+packages/kb-extension/src/index.ts"], "skills": [] }` and the user switches `kb-extension`
- **THEN** the written project settings file has no `packages` key

#### Scenario: An empty packages list is removed
- **WHEN** project settings hold `packages: []` and the user switches any package
- **THEN** the written project settings file has no `packages` key

#### Scenario: No written repo-root entry carries an empty resource filter
- **WHEN** any switch completes
- **THEN** no project entry whose `source` resolves to the repo root, and that lacks `autoload: false`, has an empty `extensions`, `skills`, `prompts` or `themes` array

### Requirement: The repair SHALL leave everything else unchanged

The tool SHALL write back unchanged every project entry it does not repair, every key of a repaired entry other than `extensions`, and every top-level key other than `packages`.

#### Scenario: Delta, other-package and non-empty entries are untouched
- **WHEN** project settings hold an `autoload: false` entry with `extensions: []`, a `{ "source": "npm:other-pkg", "extensions": [] }` entry, a bare-string entry, a `{ "source": ".." }` entry with no filter keys, and a repo-root entry whose `extensions` holds only another package's path
- **THEN** all five entries are written back unchanged

#### Scenario: An unchanged project file is not rewritten
- **WHEN** a switch changes nothing in the project settings
- **THEN** the project settings file is not rewritten and no project backup is created

### Requirement: The tool SHALL NOT offer a project-overlay local mode

The tool SHALL NOT write a new project `packages` entry. A `local` switch SHALL always use the global working-tree directory form. Asking for the removed `--overlay` mode SHALL exit non-zero, change no files, and name plain `local` as the replacement.

#### Scenario: Overlay flag is rejected
- **WHEN** the user runs `local kb-extension --overlay`
- **THEN** the tool exits non-zero with a message naming plain `local`
- **AND** neither settings file is modified and no backup is created

#### Scenario: Leftover overlay entries still report and clean up
- **WHEN** project settings hold `{ "source": "..", "extensions": ["+packages/kb-extension/src/index.ts"] }` and the user runs `status`, then `npm kb-extension`
- **THEN** `status` reports `kb-extension` as `local (project overlay)`
- **AND** after the switch the global list holds the `npm:` entry and the project settings file has no `packages` key

### Requirement: A switch SHALL succeed when the project settings file is absent

When the repo has no project settings file, a switch SHALL update the global settings and SHALL NOT create, back up or fail on the project file.

#### Scenario: No project settings file
- **WHEN** the project settings file does not exist and the user switches a package to `local`
- **THEN** the global list is updated, the tool exits zero, and no project settings file or backup is created

### Requirement: Every edited settings file SHALL be backed up and stay valid JSON

Before overwriting a settings file, the tool SHALL write a timestamped `*.bak-switch-*` copy of it. Each file it writes SHALL parse as JSON.

#### Scenario: Backup precedes the write
- **WHEN** a switch edits the global settings file
- **THEN** a `settings.json.bak-switch-<timestamp>` copy holding the previous contents exists next to it, and the new file parses as JSON

### Requirement: The repo check SHALL reject a committed empty resource filter

The repo's settings check, which CI runs on the checked-out commit, SHALL fail when an object entry in the `packages` list of the project `.pi/settings.json` has an empty `extensions`, `skills`, `prompts` or `themes` array and does not set `autoload: false`. Its existing rejection of machine-specific absolute `source` paths SHALL keep working.

#### Scenario: Empty extensions filter fails the check
- **WHEN** the committed project settings hold `packages: [{ "source": "..", "extensions": [] }]`
- **THEN** the check exits non-zero

#### Scenario: Empty array in a delta entry passes
- **WHEN** an entry has `autoload: false` and an empty `skills` array
- **THEN** the check reports no violation for that entry

#### Scenario: Non-empty filters and string entries pass
- **WHEN** the project `packages` list holds only bare-string entries and object entries whose filter arrays are all non-empty
- **THEN** the check exits zero

#### Scenario: Absolute source still fails
- **WHEN** an entry's `source` is `/Users/someone/repo` and its filters are non-empty
- **THEN** the check exits non-zero and reports the absolute path, as before

### Requirement: Repo check findings SHALL say what to fix

Each empty-filter finding SHALL name the file, the entry's `source` and the empty key, with the hint "remove the empty key or the entry". The relative-source correction (`"source": ".."`) and the `pi install` note SHALL print only when an absolute-path finding exists. An unparseable file SHALL produce exactly one finding and no hint.

#### Scenario: Empty-filter finding names the entry and its own hint
- **WHEN** the committed project settings hold `packages: [{ "source": "..", "extensions": [] }]`
- **THEN** the output names `..` and `extensions` with the remove hint, and prints neither the relative-source correction nor the `pi install` note

#### Scenario: Absolute-path finding keeps its hints
- **WHEN** an entry's `source` is `/Users/someone/repo`
- **THEN** the output prints the relative-source correction and the `pi install` note, as before

#### Scenario: Unparseable settings are reported once
- **WHEN** the committed project settings file is not valid JSON
- **THEN** the check exits non-zero with exactly one parse-error finding

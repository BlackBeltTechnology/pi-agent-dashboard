# codegraph-code-plane — delta

## ADDED Requirements

### Requirement: Standalone package family, kb untouched

The code plane SHALL ship as its own package family — `codegraph-driver` (pure
CLI adapter, no pi imports), `codegraph-extension` (pi extension), and
`codegraph-plugin` (dashboard UI) — mirroring kb's core/extension/plugin shape.
Neither `packages/kb` nor `packages/kb-extension` is modified, and the family
has no dependency on the kb packages.

#### Scenario: kb packages are not modified

- **WHEN** this change is implemented
- **THEN** `packages/kb` and `packages/kb-extension` gain no new code, no new
  dependency, and no new tool or hook
- **AND** the new `codegraph-*` packages do not depend on `packages/kb` or
  `packages/kb-extension`

#### Scenario: Pure driver is testable without pi

- **WHEN** the `codegraph-driver` package is tested
- **THEN** its spawn/parse/presence logic runs with no pi runtime imports, and
  is consumed by both `codegraph-extension` and the `codegraph-plugin` server
  API

### Requirement: Code-plane passthrough tool

`codegraph-extension` SHALL register a native tool `codegraph_explore` that
answers code-structure queries by shelling out to the local CodeGraph CLI (via
`codegraph-driver`) and passing its result through.

#### Scenario: Code-structure query returns CodeGraph result

- **WHEN** an agent calls `codegraph_explore` with a query and the `codegraph`
  binary is on PATH and the cwd has a `.codegraph/` index
- **THEN** the driver spawns the CodeGraph CLI in JSON mode, and the tool
  returns its code-plane result (verbatim source, call flow, blast radius)
- **AND** the kb store and kb tools are not invoked

#### Scenario: Query text cannot inject shell

- **WHEN** a query contains shell metacharacters
- **THEN** the CLI is spawned with an argument vector (no shell interpolation)
  so the query text cannot alter the executed command

### Requirement: Lazy per-worktree lifecycle, no daemon

`codegraph-extension` SHALL manage a per-cwd CodeGraph index in pull mode with
CodeGraph's watcher daemon disabled, mirroring kb's lazy reindex model rather
than running a background process.

#### Scenario: Cold-start builds the index on first explore

- **WHEN** `codegraph_explore` is called in a cwd that has no `.codegraph/`
  index and the binary is present
- **THEN** the extension runs `codegraph init <cwd>` once to build that
  worktree's index, then serves the query

#### Scenario: Source-file write triggers a debounced sync

- **WHEN** a source file (non-`.md`) is written in the cwd
- **THEN** `codegraph-extension`'s own `tool_result` write-hook schedules a
  debounced `codegraph sync <cwd>` for that cwd
- **AND** `packages/kb-extension`'s markdown reindex hook is unchanged

#### Scenario: Watcher daemon is not spawned

- **WHEN** the extension invokes CodeGraph
- **THEN** it runs with the watcher disabled (`CODEGRAPH_NO_DAEMON=1`) so no
  background process is created; freshness comes from cold-start init,
  write-hook sync, and per-query reconciliation

#### Scenario: Each worktree owns its index

- **WHEN** two worktrees of the same repo are used
- **THEN** each has its own `.codegraph/` index keyed by its path, and
  `.codegraph/` is gitignored

### Requirement: Binary resolution ladder and fallback install

`codegraph-driver` SHALL resolve the `codegraph` binary through an ordered
ladder so one driver works bundled, on PATH, or self-installed. When no binary is
resolved, the plugin SHALL offer an actionable install (rung 4).

#### Scenario: Bundled binary preferred in Electron

- **WHEN** the app is packaged and a binary exists at
  `<resourcesPath>/codegraph/`
- **THEN** the driver resolves that bundled binary (after an explicit
  `CODEGRAPH_BIN` override, before a PATH lookup)

#### Scenario: PATH binary used when unbundled

- **WHEN** no override and no bundled binary exist but `codegraph` is on `PATH`
- **THEN** the driver resolves the PATH binary

#### Scenario: Install action when no binary resolves

- **WHEN** the resolution ladder finds no binary and the user triggers the
  panel's install action
- **THEN** the server runs `npm install -g @colbymchenry/codegraph@<pin>` and
  re-probes presence, and the panel reflects the new state

### Requirement: Electron bundles the binary where a prebuilt exists

The Electron build SHALL bundle a per-arch `codegraph` binary as an
`extraResource` for targets where CodeGraph publishes a prebuilt, resolved and
sha256-verified at build time; other targets ship no bundle and rely on the
fallback install.

#### Scenario: Per-arch bundle included

- **WHEN** the Electron build runs for a target with a published CodeGraph
  prebuilt
- **THEN** `download-codegraph.mjs` fetches + sha256-verifies the arch-matching
  binary into `resources/codegraph/`, and `forge.config.ts` includes it as an
  `extraResource`

#### Scenario: Unsupported target ships no bundle

- **WHEN** the Electron build runs for a target with no published prebuilt
- **THEN** no `codegraph` binary is bundled and the app relies on the resolution
  ladder's PATH / fallback-install rungs at runtime

### Requirement: Graceful degradation when CodeGraph is absent

The family SHALL never introduce a hard dependency. When CodeGraph is
unavailable the passthrough tool returns guidance to use built-in tools and
performs no code-plane lookup.

#### Scenario: Binary not installed

- **WHEN** `codegraph_explore` is called and the `codegraph` binary is not on
  PATH
- **THEN** the tool returns a clean message telling the agent to use built-in
  tools (grep/Read), and does not error

#### Scenario: No index for this cwd

- **WHEN** `codegraph_explore` is called and the cwd has no `.codegraph/` index
- **THEN** the tool returns guidance to use built-in tools, and does not error

### Requirement: Docs-first routing guidance

The root `AGENTS.md` docs-first gate SHALL carry a row routing code-structure
questions to `codegraph_explore`, symmetric with the existing `kb_search` rows,
so the "one surface" is guidance rather than a routing classifier.

#### Scenario: Guidance row present

- **WHEN** the docs-first gate table is read
- **THEN** it contains a row directing code-structure / "who calls X" / blast
  radius questions to `codegraph_explore`, and docs / "where is X documented"
  questions to `kb_search`

### Requirement: Dashboard settings and health UI

`codegraph-plugin` SHALL provide a dashboard settings/health panel mirroring
`kb-plugin`, backed by the shared `codegraph-driver` through a server API.

#### Scenario: Panel shows presence and per-worktree freshness

- **WHEN** the CodeGraph settings panel is opened for a project
- **THEN** it shows whether the `codegraph` binary is installed, the selected
  worktree's index health/freshness (from `codegraph status`), and a control to
  force a reindex (`codegraph index`/`sync`)

#### Scenario: Panel degrades when binary absent

- **WHEN** the panel is opened and the `codegraph` binary is not installed
- **THEN** it shows an install hint instead of erroring, consistent with the
  tool's graceful degradation

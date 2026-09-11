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
  binary resolves on any ladder rung and the cwd has a ready `.codegraph/` index
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

#### Scenario: Cold-start starts a background index build

- **WHEN** `codegraph_explore` is called in a cwd with no ready `.codegraph/`
  index (absent, or left incomplete by an interrupted build) and the binary
  resolves
- **THEN** the tool returns built-in-tools guidance immediately AND schedules
  `codegraph init <cwd>` once as a background job
- **AND** the tool call never blocks on the full-repo parse

#### Scenario: Concurrent explores do not start duplicate builds

- **WHEN** `codegraph_explore` is called again in a cwd whose background `init`
  is still running
- **THEN** no second `init` is spawned for that cwd and the call returns
  guidance, so two builds can never race the same SQLite index

#### Scenario: Source-file write triggers a debounced sync

- **WHEN** a source file (non-`.md`) is written in the cwd
- **THEN** `codegraph-extension`'s own `tool_result` write-hook schedules a
  debounced `codegraph sync <cwd>` for that cwd
- **AND** `packages/kb-extension`'s markdown reindex hook is unchanged

#### Scenario: Index and machine-generated writes never retrigger a sync

- **WHEN** a write lands under `.codegraph/`, `.git/`, `node_modules/`, or a
  build-output directory in the cwd
- **THEN** the write-hook ignores it and schedules no `sync`, so CodeGraph's own
  database writes cannot feed back into the hook that produced them

#### Scenario: Watcher daemon is not spawned

- **WHEN** the extension invokes CodeGraph
- **THEN** it runs with the watcher disabled (`CODEGRAPH_NO_DAEMON=1`) so no
  background process is created; freshness comes from cold-start init,
  write-hook sync, and per-query reconciliation

#### Scenario: Each worktree owns its index

- **WHEN** two worktrees of the same repo are used
- **THEN** each has its own `.codegraph/` index keyed by its path, and
  `.codegraph/` is gitignored

#### Scenario: Writers for one worktree are serialized

- **WHEN** a `sync` or freshness reconcile is requested for a cwd whose `init`
  is still running
- **THEN** it waits or coalesces rather than spawning a second concurrent
  writer, because the no-daemon mode permits only one writer per project
- **AND** writers for different cwds still proceed concurrently

#### Scenario: A stale writer lock is recovered, not fatal

- **WHEN** an operation finds a writer lock left behind by an interrupted run
- **THEN** the driver detects it and recovers, so the worktree is usable again
  instead of failing every later operation

#### Scenario: An interrupted build is not served as a complete index

- **WHEN** `init` is interrupted, leaving `.codegraph/` present but incomplete
- **THEN** readiness is judged by `codegraph status` rather than directory
  existence, and the partial index is reported not-ready

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

#### Scenario: A resolved binary is validated before it is trusted

- **WHEN** the ladder resolves a candidate on any rung
- **THEN** the driver verifies it is really CodeGraph (a bounded `version`
  probe) before use, and a candidate that fails the probe is skipped in favour
  of the next rung rather than executed for queries

#### Scenario: Install action when no binary resolves

- **WHEN** the resolution ladder finds no binary and the user triggers the
  global settings surface's install action
- **THEN** the server runs `npm install -g @colbymchenry/codegraph@<pin>` and
  re-probes presence, and the surface reflects the new state

#### Scenario: A failed install reports why, and never half-succeeds

- **WHEN** the install cannot complete — npm is absent, the global prefix is not
  writable (`EACCES`), or the newly installed bin directory is not on the
  expected npm-prefix location, so the rung-4 re-probe still fails
- **THEN** the action surfaces the specific reason and the state stays
  "not installed"; it never reports success on an unresolvable binary

#### Scenario: Packaged app does not mutate its own bundle

- **WHEN** the install action runs inside a packaged Electron app
- **THEN** it installs to a writable user-scoped prefix and never writes inside
  the signed application bundle

### Requirement: Electron bundles the binary where a prebuilt exists

The Electron build SHALL bundle a per-arch `codegraph` binary as an
`extraResource` for targets where CodeGraph publishes a prebuilt, resolved and
sha256-verified at build time; other targets ship no bundle and rely on the
fallback install.

#### Scenario: Per-arch bundle included

- **WHEN** the Electron build runs for a target with a published CodeGraph
  prebuilt
- **THEN** `packages/electron/scripts/download-codegraph.mjs` fetches +
  sha256-verifies the arch-matching binary into
  `packages/electron/resources/codegraph/`, and
  `packages/electron/forge.config.ts` includes it as an `extraResource`; the step
  is spawned from `bundle-server.mjs` and a non-zero exit fails the build

#### Scenario: Unsupported target ships no bundle

- **WHEN** the Electron build runs for a target with no published prebuilt
- **THEN** no `codegraph` binary is bundled and the app relies on the resolution
  ladder's PATH / fallback-install rungs at runtime

### Requirement: A failed run is reported as failure, not absence

The driver SHALL distinguish "no binary resolved" from "the binary ran and
failed", so a real failure is never reported as CodeGraph being uninstalled.

#### Scenario: A ran-and-failed command is not reported as absence

- **WHEN** a resolved binary exits non-zero (malformed query, writer lock held,
  corrupt index)
- **THEN** the driver returns a typed error distinct from "unavailable", and the
  agent is not told to fall back as though CodeGraph were not installed
- **AND** it still does not throw into agent context

### Requirement: Graceful degradation when CodeGraph is absent

The family SHALL never introduce a hard dependency. When CodeGraph is
unavailable the passthrough tool returns guidance to use built-in tools and
performs no code-plane lookup.

#### Scenario: Binary not installed

- **WHEN** `codegraph_explore` is called and no binary resolves on any ladder
  rung (not merely absent from `PATH` — a bundled, overridden or self-installed
  binary resolves with `PATH` empty)
- **THEN** the tool returns a clean message telling the agent to use built-in
  tools (grep/Read), and does not error

#### Scenario: No index for this cwd

- **WHEN** `codegraph_explore` is called and the cwd has no ready `.codegraph/`
  index
- **THEN** the tool returns guidance to use built-in tools and does not error
- **AND** once the background `init` for that cwd completes, a later query is
  served from the index

### Requirement: Opt-in Docker carry with telemetry disabled

The Docker image SHALL default to no CodeGraph and carry a pinned binary only
when built with the opt-in build-arg, with telemetry disabled.

#### Scenario: Default image carries no CodeGraph

- **WHEN** the image is built without the opt-in build-arg
- **THEN** no `codegraph` binary is installed and the plane is a clean no-op

#### Scenario: Opt-in image carries a pinned binary with telemetry off

- **WHEN** the image is built with the opt-in build-arg
- **THEN** a pinned `codegraph` version is installed, resolves on the ladder's
  PATH rung, and emits no outbound telemetry

### Requirement: Docs-first routing guidance

The root `AGENTS.md` docs-first gate SHALL carry a row routing code-structure
questions to `codegraph_explore`, symmetric with the existing `kb_search` rows,
so the "one surface" is guidance rather than a routing classifier.

#### Scenario: Guidance row present

- **WHEN** the docs-first gate table is read
- **THEN** it contains a row directing code-structure / "who calls X" / blast
  radius questions to `codegraph_explore`, and docs / "where is X documented"
  questions to `kb_search`

### Requirement: Dashboard settings and health UI, split by scope

`codegraph-plugin` SHALL render host-global binary facts on the global plugin
settings surface and per-worktree index facts on the folder surface, backed by
the shared `codegraph-driver` through a server API. The folder surface MAY state
the binary *outcome* read-only — it has to explain why its own actions are
disabled — but MUST NOT render the ladder, the resolved path/version, or the
install action; those are global-only. The global surface renders no
per-worktree state.

#### Scenario: Global surface owns the binary

- **WHEN** `/settings/plugins/codegraph` is opened
- **THEN** it shows the resolution ladder, the resolved binary path and version,
  and the install action
- **AND** it shows no per-worktree index state

#### Scenario: Folder surface owns the index

- **WHEN** the folder CodeGraph dialog is opened for a worktree
- **THEN** it shows that worktree's index health/freshness (from `codegraph
  status`), a force-reindex control, a ONE-LINE binary outcome, and a
  `Manage in Settings →` deep link
- **AND** it does not render the resolution ladder

#### Scenario: Folder surface blocks when no binary resolves

- **WHEN** the folder dialog is opened and no binary resolves on any rung
- **THEN** the index section is replaced by a blocker whose only action is the
  global one, the folder's own actions are disabled, and no install action is
  offered on the folder surface

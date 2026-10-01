## Purpose

Decides which vitest test files CI runs for a given diff. Selection follows the real module graph, fails safe to a full run whenever it cannot justify a narrower one, and leaves an auditable record of what it skipped.

## ADDED Requirements

### Requirement: Selection is computed from a base ref and yields a mode, a reason, and shard assignments
The selector SHALL take a git base ref and the checked-out tree. It SHALL collect test files from the root vitest config **and** the real-process config. It SHALL produce:
- a mode, `full` or `affected`;
- a human-readable reason;
- the selected test files, split into the parallel phase and the real-process phase;
- the parallel-phase files assigned to a fixed number of shards;
- a flag for whether the packaging scenarios are required.

The diff SHALL be computed without rename detection, so that both the old and new path of a rename, and every deleted path, count as changed. Given the same tree, the same frozen-lockfile install, and the same base ref, the output SHALL be identical.

#### Scenario: Deterministic output
- **WHEN** the selector runs twice on the same tree and install against the same base ref
- **THEN** both runs SHALL produce identical mode, reason, file sets and shard assignments

#### Scenario: Real-process files are routed to their own phase
- **WHEN** a diff touches a module reached by `packages/server/src/rpc-keeper/__tests__/keeper.test.ts`, a real-process test collected only by the real-process config
- **THEN** that file SHALL be listed in the real-process set and in no parallel shard

#### Scenario: Rename counts both sides
- **WHEN** the diff renames `packages/p/src/a.ts` to `packages/p/src/b.ts`
- **THEN** both paths SHALL be treated as changed

### Requirement: Global inputs force a full run
The selector SHALL choose `full` when the diff touches any global input. Global inputs are:
- the lockfile;
- the root `package.json`;
- any vitest config file;
- the shared worker-target module;
- any `tsconfig*.json`;
- any file a vitest project declares as `setupFiles` or `globalSetup`;
- the selector itself;
- the selection data files that decide selection (trigger map, covered-elsewhere list, slow-tier manifest).

The shard timing data SHALL NOT be a global input, because it affects only shard balance and never which files run.

#### Scenario: Lockfile change
- **WHEN** the diff contains `pnpm-lock.yaml`
- **THEN** the mode SHALL be `full` and the reason SHALL name `pnpm-lock.yaml`

#### Scenario: Project setup file change
- **WHEN** the diff contains a file listed in any vitest project's `setupFiles`
- **THEN** the mode SHALL be `full`

#### Scenario: Timing data change
- **WHEN** the diff touches only the shard timing data file
- **THEN** the mode SHALL NOT be forced to `full` by that file

### Requirement: A test file is selected when it or any local module it reaches changed
In `affected` mode a test file SHALL be selected when:
- the test file itself is in the diff; or
- any module reachable from it through static or dynamic imports is in the diff.

Modules under `node_modules` are not followed. Cross-package imports that resolve to a workspace package's source SHALL be followed.

#### Scenario: Direct source change
- **WHEN** the diff contains `packages/client/src/components/editor-pane/EditorFileTree.tsx`
- **THEN** `packages/client/src/components/editor-pane/__tests__/EditorFileTree.test.tsx` SHALL be selected

#### Scenario: Cross-package reach
- **WHEN** the diff contains a module under `packages/shared/src/` that a client test imports transitively
- **THEN** that client test SHALL be selected

#### Scenario: Unrelated test is not selected
- **WHEN** a test file with local dependencies reaches no changed module, is itself unchanged, and no other layer selects it
- **THEN** that test file SHALL NOT be selected

### Requirement: A module that fails to transform does not hide its importers
When a module in a test file's graph cannot be transformed or resolved, the selector SHALL treat that module as a leaf and SHALL keep walking the rest of the graph. It SHALL record the module and its error in the audit output. It SHALL NOT abort the selection, and SHALL NOT drop the test file's other dependencies.

#### Scenario: Unresolvable third-party entry
- **WHEN** `packages/client/src/components/editor-pane/monaco-setup.ts` fails to transform because `monaco-editor` has no resolvable entry
- **THEN** a test that reaches `SettingsPanel.tsx` through a graph that also contains `monaco-setup.ts` SHALL still be selected when `SettingsPanel.tsx` changes
- **AND** the audit output SHALL list `monaco-setup.ts` as a leaf error

### Requirement: Modules with non-literal dynamic imports widen selection to their package
When a module in a test file's graph contains a dynamic import whose specifier is not a string literal, the selector SHALL treat that module as an open edge. In `affected` mode, that test file SHALL be selected whenever any file under the open-edge module's package changes. Open-edge modules SHALL be listed in the audit output.

#### Scenario: Computed import
- **WHEN** a test's graph contains `packages/p/src/loader.ts`, which calls `import(someVariable)`, and the diff touches any file under `packages/p/`
- **THEN** that test SHALL be selected

### Requirement: Tests without local dependencies run on every diff
In `affected` mode, every test file whose graph contains no local module SHALL be selected, whatever the diff contains, including documentation-only and OpenSpec-only diffs. The set SHALL be computed from the graph, not hand-listed. There SHALL be no mode that runs zero unit tests.

#### Scenario: Bundle budget test runs on an unrelated client change
- **WHEN** the diff touches only `packages/quota-plugin/src/client.tsx`
- **THEN** `packages/client/src/__tests__/mdi-chunk-size.test.ts` SHALL be selected

#### Scenario: OpenSpec-only diff still runs the always-run set
- **WHEN** the diff touches only files under `openspec/changes/`
- **THEN** the mode SHALL be `affected` and every test file with no local dependencies SHALL be selected

### Requirement: Tests that name a changed location by path literal are selected
A location is either a top-level repository entry, such as `openspec` or `.github`, or a workspace package directory, such as `packages/server`. A literal that equals a top-level entry name counts as naming it, so a path built as `path.join(root, "openspec")` counts.

The selector SHALL scan every test file's source for string literals that equal a location or begin with `<location>/`. In `affected` mode, a test file SHALL be selected when any changed file lies within a location that its source names this way. The selector SHALL treat this scan as a heuristic that adds tests and SHALL NOT use it to remove any.

#### Scenario: Cross-package reader
- **WHEN** a test under `packages/client/` contains the literal `"packages/server/src/cli.ts"` and the diff touches `packages/server/src/cli.ts`
- **THEN** that test SHALL be selected

#### Scenario: Import-bearing reader of OpenSpec content
- **WHEN** `scripts/__tests__/check-conventions.test.mjs` contains a literal beginning `openspec/` and the diff touches only `openspec/changes/x/proposal.md`
- **THEN** that test SHALL be selected

### Requirement: Files inside a package that no test graph reaches fall back to their package
No path under `packages/` SHALL be ignorable. When a changed file lives under `packages/<p>/` and no test graph reaches it, the selector SHALL select two sets:
- every test file under `packages/<p>/`;
- every test file whose graph contains any module under `packages/<p>/`.

Examples of such files are a stylesheet, a JSON data file, Markdown read by a test, a fixture, a module loaded at runtime by path, or a type-only module. A change to `packages/<p>/package.json` SHALL select the same set and SHALL NOT force a full run.

#### Scenario: Stylesheet change
- **WHEN** the diff touches only `packages/client/src/index.css`
- **THEN** every test file under `packages/client/` SHALL be selected

#### Scenario: Markdown inside a package
- **WHEN** the diff touches only a `SKILL.md` under `packages/extension/`
- **THEN** every test file under `packages/extension/` SHALL be selected

#### Scenario: Package manifest is scoped
- **WHEN** the diff touches `packages/roles-plugin/package.json` and no global input
- **THEN** the mode SHALL be `affected`, not `full`
- **AND** the tests of `packages/roles-plugin/` and every test whose graph enters it SHALL be selected

### Requirement: Files outside packages are classified by checked-in data, and unknown files force a full run
Two checked-in files classify changed files that are outside `packages/`, that no test graph reaches, and that are not test files:
- a **trigger map**: path globs mapped to test-file globs. A match selects those tests.
- a **covered-elsewhere list**: top-level locations only (e.g. `docs`, `openspec`, `.github`), whose vitest readers are all selected by the always-run or path-literal layers. A match contributes nothing further. Because entries are whole top-level locations, the path-literal layer matches any reader that names the location as a string literal, including as a separate path segment.

A file matching neither SHALL force `full`.

#### Scenario: Unmapped root data file
- **WHEN** the diff touches a root-level file that is in no graph, not in the trigger map, and not in the covered-elsewhere list
- **THEN** the mode SHALL be `full` and the reason SHALL name the file

#### Scenario: Mapped file selects its tests
- **WHEN** the diff touches `scripts/z-layer-baseline.json` and the trigger map maps it to the z-layer tests
- **THEN** those tests SHALL be selected and that file SHALL NOT force `full`

### Requirement: Slow-tier tests are a deliberate, visible deselection
A checked-in manifest SHALL list slow-tier test files. In `affected` mode, removing slow-tier files SHALL be the last step: a slow-tier file SHALL be selected only when the file itself is in the diff. This applies even when the graph, open-edge, path-literal, package-fallback or trigger-map layer would select it. In `full` mode every slow-tier file SHALL be selected. Every slow-tier file deselected this way SHALL be listed in the audit output. A manifest entry naming a non-existent test file SHALL fail the selector's contract test.

#### Scenario: Mutation harness deselected on a server change it reaches
- **WHEN** the diff touches a server module that `scripts/__tests__/async-semantics-mutation.test.mjs` reaches or names, and the manifest lists that file
- **THEN** that file SHALL NOT be selected in `affected` mode
- **AND** the audit output SHALL list it under slow-tier deselections

#### Scenario: Stale manifest entry
- **WHEN** the slow-tier manifest names a test file that does not exist
- **THEN** the selector's contract test SHALL fail naming the entry

### Requirement: Packaging scenarios run on every diff that is not OpenSpec-only
The selector SHALL require the packaging scenarios unless every changed file lies under `openspec/`. Shipped files include root documentation that the root package publishes, so any other diff can change a packed file set.

The packaging scenarios are the test files gated on `RUN_CI_SCENARIOS`, located by scanning test sources. They SHALL run only in the packaging-scenarios job, under `RUN_CI_SCENARIOS=1`. They SHALL NOT be assigned to a unit shard or the real-process job, where their gated assertions would skip. On pull requests and pushes, only those files SHALL run in that job, not the whole `scripts` project.

#### Scenario: Source-only diff still runs packaging scenarios
- **WHEN** the diff touches only `packages/client/src/App.tsx`
- **THEN** the packaging-scenarios flag SHALL be true

#### Scenario: Root documentation diff runs them
- **WHEN** the diff touches only the root `AGENTS.md`
- **THEN** the packaging-scenarios flag SHALL be true

#### Scenario: OpenSpec-only diff skips them
- **WHEN** the diff touches only files under `openspec/`
- **THEN** the packaging-scenarios flag SHALL be false

#### Scenario: Gated files never land in a unit shard
- **WHEN** another layer selects `scripts/__tests__/root-packaging.test.mjs`
- **THEN** it SHALL be assigned only to the packaging-scenarios job

### Requirement: Selector failure means a full run
When the selector cannot compute a selection, the result SHALL be mode `full` with a reason naming the failure. Causes include an unreachable base ref, an all-zero push `before` SHA, a `before` SHA that is not an ancestor of the head, a vitest startup error, or an internal exception. It SHALL NOT exit in a way that lets CI run fewer tests.

#### Scenario: New branch push
- **WHEN** the base ref is the all-zero SHA
- **THEN** the mode SHALL be `full`

#### Scenario: Force-push
- **WHEN** the push `before` SHA is not an ancestor of the pushed head
- **THEN** the mode SHALL be `full`

#### Scenario: Base ref missing
- **WHEN** the base ref cannot be resolved in the checkout
- **THEN** the mode SHALL be `full` and the reason SHALL name the ref

### Requirement: Every shard proves it ran what it was assigned
Each unit shard, the real-process job, and the packaging-scenarios job SHALL compare the test files its vitest run actually executed against the files the selector assigned to it. It SHALL fail when any assigned file did not execute. A shard with no assigned files SHALL skip vitest and succeed.

#### Scenario: Path mismatch is caught
- **WHEN** an assigned file does not match vitest's collected file (e.g. a path-form mismatch)
- **THEN** the shard SHALL fail naming the unexecuted file

#### Scenario: Empty shard
- **WHEN** the selector assigns no files to a shard
- **THEN** that shard SHALL run no vitest and SHALL succeed

### Requirement: Maintainers can force a full run
A pull request carrying the label `ci:full` when a commit is pushed to it SHALL run in `full` mode. A `workflow_dispatch` run of the CI workflow SHALL always run in `full` mode.

#### Scenario: Label forces full on the next push
- **WHEN** a pull request has the `ci:full` label and receives a new commit
- **THEN** CI SHALL run the full unit suite including the slow tier

#### Scenario: Dispatch is full
- **WHEN** a maintainer dispatches the CI workflow on any branch
- **THEN** the mode SHALL be `full`

### Requirement: Every selection is auditable
Each selector run in CI SHALL write the following to the job summary:
- mode and reason;
- counts per selection layer (global, graph, open edge, always-run, path literal, package fallback, trigger map, slow-tier deselections);
- the unmapped, leaf-error and open-edge files;
- the share of selected files with no timing data.

It SHALL upload the full selection, including every selected file, the layer that selected it, and the shard assignments, as a workflow artifact.

#### Scenario: Summary on an affected run
- **WHEN** CI runs in `affected` mode
- **THEN** the job summary SHALL show the mode, reason and per-layer counts
- **AND** an artifact containing the selection JSON SHALL be attached to the run

### Requirement: Every test-bearing workspace package is collected
Every workspace package that contains vitest test files outside `node_modules/`, `dist/` and `out/` SHALL be collected by a root vitest project, or SHALL be listed on an explicit exclusion list with a reason. A repo-lint test SHALL fail naming any package that is neither.

As of this change, the uncollected test-bearing packages are `apple-tools`, `dashboard-plugin-skill`, `hermes-memory-plugin`, `pi-forms-bpmn`, `quota-plugin` and `electron`. Each SHALL end up either collected or excluded with a reason; `electron` is excluded because only its build-contract config runs under the root runner. A collected package SHALL NOT satisfy this requirement by skipping its failing test files.

#### Scenario: Uncollected package
- **WHEN** a package under `packages/` contains `*.test.ts` files and is neither in root `projects` nor on the exclusion list
- **THEN** the repo-lint test SHALL fail naming the package

#### Scenario: quota-plugin is collected
- **WHEN** the root vitest config is loaded
- **THEN** `packages/quota-plugin` SHALL be among its projects

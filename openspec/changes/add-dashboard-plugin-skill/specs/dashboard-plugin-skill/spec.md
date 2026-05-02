## ADDED Requirements

### Requirement: Skill ships as a publishable pi-extension package

The skill SHALL ship as `@blackbelt-technology/pi-dashboard-plugin-skill`, a publishable (`private: false`) workspace package whose `package.json` declares the skill via the `pi.skills` field. Installing the package via `npm i -g`, via `pi packages add`, or by adding it to a workspace's `~/.pi/agent/settings.json#packages[]` array SHALL make the skill available to every pi session that resolves the package.

#### Scenario: Global install exposes the skill

- **GIVEN** a developer runs `npm i -g @blackbelt-technology/pi-dashboard-plugin-skill`
- **WHEN** they start a pi session
- **THEN** the session SHALL list `dashboard-plugin-scaffold` in its available skills.

#### Scenario: Workspace-scoped install exposes the skill

- **GIVEN** a workspace's `~/.pi/agent/settings.json` declares the package in its `packages[]`
- **WHEN** a pi session starts in that workspace
- **THEN** the session SHALL list `dashboard-plugin-scaffold` in its available skills, and other workspaces without the declaration SHALL NOT.

### Requirement: Two modes selected by the up-front batch

The skill SHALL begin every invocation with a single `ask_user` batch whose first question selects the mode (`new` or `augment`). All subsequent questions in the same batch SHALL be conditional only on the mode and SHALL collect every decision the skill needs before any side-effectful step runs.

#### Scenario: Single user-prompt round before scaffolding

- **WHEN** the skill is invoked
- **THEN** the user SHALL answer exactly one batch of questions before the skill writes any file or runs any command, and SHALL NOT be prompted again until either (a) per-callsite confirmation in `augment` mode (a single subsequent `multiselect`) or (b) a final summary confirm.

### Requirement: Mode `new` scaffolds a monorepo plugin package

When mode is `new`, the skill SHALL render its templates into `packages/<id>-plugin/` inside the dashboard monorepo, where `<id>` is the user-supplied kebab-case id. The output layout SHALL match `packages/demo-plugin/` (the existing fixture). The skill SHALL register the new package in the root `package.json#workspaces` array using the idempotent helper `scripts/register-workspace.sh`.

#### Scenario: Output mirrors the demo plugin layout

- **GIVEN** the user picks id `acme`, slots `["settings-section", "tool-renderer"]`, `server: true`, `bridge: false`, `configSchema: true`
- **WHEN** the skill finishes
- **THEN** `packages/acme-plugin/package.json`, `packages/acme-plugin/src/client.tsx`, `packages/acme-plugin/src/server/index.ts`, `packages/acme-plugin/configSchema.json`, `packages/acme-plugin/tsconfig.json`, `packages/acme-plugin/vitest.config.ts`, `packages/acme-plugin/README.md`, and `packages/acme-plugin/test/index.test.ts` SHALL exist, and `packages/acme-plugin/src/bridge/index.ts` SHALL NOT exist.

#### Scenario: Idempotent workspace registration

- **GIVEN** the root `package.json#workspaces` array already contains `packages/acme-plugin`
- **WHEN** the skill runs `scripts/register-workspace.sh acme-plugin`
- **THEN** the array SHALL remain unchanged and the script SHALL exit with success.

#### Scenario: Id collision aborts before any write

- **GIVEN** `packages/acme-plugin/` already exists
- **WHEN** the user picks id `acme`
- **THEN** the skill SHALL abort with a clear error and SHALL NOT write any file.

### Requirement: Mode `augment` retrofits an existing pi-extension project

When mode is `augment`, the skill SHALL operate on the current working directory of the pi session and SHALL refuse to run unless `package.json` exists at `cwd` and declares `pi-coding-agent` as a dependency or peer-dependency. The skill SHALL be purely additive — it SHALL NOT modify any existing source file outside of `package.json` (where it injects the manifest field) and SHALL NOT delete any file.

#### Scenario: Refuses to run outside a pi extension

- **GIVEN** `cwd/package.json` does not declare `pi-coding-agent` in dependencies or peerDependencies
- **WHEN** the skill is invoked in `augment` mode
- **THEN** the skill SHALL abort with a message naming the missing peerDep and SHALL NOT write any file.

#### Scenario: Original sources are untouched

- **GIVEN** `augment` mode completes successfully on a project containing `src/foo.ts`, `src/bar.ts`, `README.md`
- **WHEN** the skill finishes
- **THEN** `src/foo.ts`, `src/bar.ts`, `README.md` SHALL be byte-identical to their pre-skill state, and only `package.json`, `src/dashboard/client.tsx`, `src/dashboard/server.ts` (if applicable), `dashboard.config.json` (if applicable), `package-lock.json`, and `node_modules/` SHALL be created or modified.

### Requirement: Augment-mode grep prelude

The skill SHALL run a deterministic grep prelude via `scripts/grep-tui-surface.sh` that emits a JSON list of callsites for: `ctx.ui.{select,input,confirm,editor,custom,multiselect}`, `pi.registerTool`, `registerExtensionUI`, `pi.events.emit("ui:list-modules")`, and the session-replacement banned calls (`ctx.fork`, `pi.newSession`, `ctx.switchSession`). The prelude SHALL be stable: a re-run on the same source tree produces identical JSON.

#### Scenario: Empty project produces empty list

- **GIVEN** a pi-extension project with no TUI calls
- **WHEN** the prelude runs
- **THEN** the JSON output SHALL be `{ "callsites": [] }`.

#### Scenario: Session-replacement calls are flagged

- **GIVEN** the project contains a `ctx.fork(...)` call
- **WHEN** the prelude runs
- **THEN** the JSON output SHALL include that callsite with `category: "banned"` and the skill SHALL surface the bridge invariant warning to the user.

### Requirement: Augment-mode analysis and per-callsite confirmation

After the grep prelude, the skill SHALL drive the agent through the canonical TUI → dashboard mapping table (in `references/tui-to-dashboard-mapping.md`) for every callsite, producing a port proposal `{ file, line, callsite, mappedSlot, componentSuggestion, notes }`. The skill SHALL present the proposals to the user via a single `ask_user` `multiselect` and SHALL only inject manifest claims for the callsites the user confirms.

#### Scenario: User can decline a proposed port

- **GIVEN** the analysis proposes porting three callsites
- **WHEN** the user un-checks one in the multiselect
- **THEN** the resulting `pi-dashboard-plugin` manifest SHALL NOT contain a claim derived from the un-checked callsite.

#### Scenario: Already-dashboard-aware callsites are reported but not ported

- **GIVEN** the project contains `ctx.ui.select(...)` calls
- **WHEN** the analysis runs
- **THEN** those callsites SHALL be annotated `mappedSlot: null, status: "already-dashboard-aware"` and SHALL NOT appear in the multiselect (the skill reports them as informational only).

### Requirement: Manifest forward-compatibility contract

The `pi-dashboard-plugin` manifest written by either mode SHALL satisfy:

1. The manifest field is at the top level of `package.json` (NOT nested under `pi`, NOT in a sibling `dashboard-plugin.json`).
2. All paths in the manifest (`client`, `server`, `bridge`, `configSchema`) SHALL be package-relative, MUST NOT begin with `/`, and MUST NOT contain `..` segments that escape the package root.
3. The manifest MUST NOT reference workspace-only constructs (no `workspace:*` deps in `dependencies`, no monorepo-relative imports in client/server entries).
4. The package's `exports` field SHALL declare `./client`, `./server` (when `server` is set), and `./bridge` (when `bridge` is set) subpaths whose resolution matches the manifest's path values.
5. The manifest SHALL include a `requiredApi` field whose value is a semver range string (`^0.x` at v0.x lock).

#### Scenario: Manifest validates against the contract test

- **WHEN** either mode produces a manifest
- **THEN** the contract test in `packages/dashboard-plugin-skill/__tests__/forward-compat.test.ts` SHALL pass against the produced output for items (1)-(5).

#### Scenario: Augmented project resolves from node_modules layout

- **GIVEN** an augmented project is published to npm and installed under `node_modules/@scope/foo/`
- **WHEN** a hypothetical loader reads `node_modules/@scope/foo/package.json#pi-dashboard-plugin`
- **THEN** every path in the manifest SHALL resolve to a real file inside `node_modules/@scope/foo/`.

### Requirement: SDK surface is the runtime + shared package exports

The skill SHALL document the "SDK" as the public exports of `@blackbelt-technology/dashboard-plugin-runtime` (client surface) and `@blackbelt-technology/pi-dashboard-shared` (manifest types, slot types, slot props). Mode `new` SHALL add both packages as `dependencies` in the generated `package.json`. Mode `augment` SHALL add both packages as `dependencies` (or `peerDependencies` if the user prefers). The skill SHALL NOT introduce or document any other "SDK" package name; references to a single `pi-dashboard-sdk` package are documentation-only and resolve to the runtime + shared pair.

#### Scenario: New mode adds both deps

- **WHEN** mode `new` finishes
- **THEN** the generated `package.json#dependencies` SHALL contain both `@blackbelt-technology/dashboard-plugin-runtime` and `@blackbelt-technology/pi-dashboard-shared` pinned to the current dashboard version.

#### Scenario: Augment mode adds both deps without disturbing existing deps

- **GIVEN** the project's `package.json#dependencies` already declares `pi-coding-agent` and `lodash`
- **WHEN** mode `augment` finishes
- **THEN** `dependencies` SHALL still contain `pi-coding-agent` and `lodash`, plus the two newly added entries, in alphabetical order.

### Requirement: Bridge entry is opt-in

Both modes SHALL default `bridge: false` in their batch and SHALL only emit `src/bridge/index.ts` (mode `new`) or a `bridge` field in the manifest (either mode) when the user explicitly opts in.

#### Scenario: Default-off

- **GIVEN** the user accepts every default in the up-front batch
- **WHEN** the skill finishes
- **THEN** the generated/augmented `package.json#pi-dashboard-plugin` SHALL NOT contain a `bridge` field, and `src/bridge/` SHALL NOT exist.

### Requirement: Templates align with the demo-plugin reference

While `packages/demo-plugin/` exists in the monorepo, the templates in `templates/` SHALL produce output structurally aligned with the demo (same file layout, same import paths from `@blackbelt-technology/dashboard-plugin-runtime/context`, same `usePluginConfig` usage shape). When `demo-plugin` is deleted (per its own deletion policy), the skill's templates SHALL become the canonical reference and SHALL be updated only via a separate change.

#### Scenario: Template change is gated on a change proposal

- **WHEN** a contributor edits any file in `templates/`
- **THEN** the change SHALL include an OpenSpec change proposal documenting the rationale, OR the edit SHALL only be a synchronization of paths/version pins matching the rest of the monorepo.

### Requirement: Skill prints next-steps and never auto-runs them

After every successful run, the skill SHALL print a numbered list of next-steps the user must run themselves: `npm install`, `npm run build` (or the user's project equivalent), and the dashboard restart/reload commands. The skill SHALL NOT automatically run any of these.

#### Scenario: New mode prints the dashboard restart command

- **WHEN** mode `new` finishes successfully
- **THEN** the printed next-steps SHALL include `curl -X POST http://localhost:8000/api/restart` (or the equivalent `pi-dashboard restart` invocation) and SHALL include `npm run reload`.

#### Scenario: Augment mode prints publish guidance

- **WHEN** mode `augment` finishes successfully
- **THEN** the printed next-steps SHALL include guidance on how to publish the augmented project to npm so the future `node_modules` discovery scan can find it, plus the interim path of `npm link`-ing into the dashboard's `packages/` layout.

## MODIFIED Requirements

### Requirement: Mode `augment` retrofits an existing pi-extension project

When mode is `augment`, the skill SHALL operate on the current working directory of the pi session and SHALL refuse to run unless `package.json` exists at `cwd` and declares `pi-coding-agent` as a dependency or peer-dependency. The skill SHALL be purely additive — it SHALL NOT modify any existing source file outside of `package.json` (where it injects the manifest field) and SHALL NOT delete any file.

An augmented project is installed outside the dashboard monorepo, so the stock dashboard delivers its client at runtime (`plugin-runtime-client-loading`). The skill SHALL therefore also inject `clientBundle` (and `clientStyles` when the project has styles), `hostApi` and the `pi-dashboard-plugin` keyword, and SHALL add a `build:dashboard` script plus `vite.dashboard.config.ts` that build the bundle with the SDK preset.

#### Scenario: Refuses to run outside a pi extension

- **GIVEN** `cwd/package.json` does not declare `pi-coding-agent` in dependencies or peerDependencies
- **WHEN** the skill is invoked in `augment` mode
- **THEN** the skill SHALL abort with a message naming the missing peerDep and SHALL NOT write any file.

#### Scenario: Original sources are untouched

- **GIVEN** `augment` mode completes successfully on a project containing `src/foo.ts`, `src/bar.ts`, `README.md`
- **WHEN** the skill finishes
- **THEN** `src/foo.ts`, `src/bar.ts`, `README.md` SHALL be byte-identical to their pre-skill state, and only `package.json`, `src/dashboard/client.tsx`, `src/dashboard/server.ts` (if applicable), `dashboard.config.json` (if applicable), `vite.dashboard.config.ts`, `package-lock.json`, and `node_modules/` SHALL be created or modified.

#### Scenario: Augmented project is runtime-deliverable

- **WHEN** mode `augment` finishes and the user runs `npm run build:dashboard`
- **THEN** `package.json#pi-dashboard-plugin` SHALL carry `clientBundle` pointing at the built entry module inside a dedicated client output directory, and `hostApi` as a caret range of the current host API version
- **AND** the built bundle SHALL contain no copy of `react` (the preset's singleton guard)

### Requirement: Manifest forward-compatibility contract

The `pi-dashboard-plugin` manifest written by either mode SHALL satisfy:

1. The manifest field is at the top level of `package.json` (NOT nested under `pi`, NOT in a sibling `dashboard-plugin.json`).
2. All paths in the manifest (`client`, `clientBundle`, `clientStyles`, `server`, `bridge`, `configSchema`) SHALL be package-relative, MUST NOT begin with `/`, and MUST NOT contain `..` segments that escape the package root.
3. The manifest MUST NOT reference workspace-only constructs (no `workspace:*` deps in `dependencies`, no monorepo-relative imports in client/server entries).
4. The package's `exports` field SHALL declare `./client`, `./server` (when `server` is set), and `./bridge` (when `bridge` is set) subpaths whose resolution matches the manifest's path values.
5. The manifest SHALL include a `requiredApi` field whose value is a semver range string (`^0.x` at v0.x lock).
6. The manifest SHALL include `hostApi`, a caret range of `PLUGIN_HOST_API_VERSION` (`plugin-host-api`); `package.json#keywords` SHALL include `pi-dashboard-plugin`.

#### Scenario: Manifest validates against the contract test

- **WHEN** either mode produces a manifest
- **THEN** the contract test in `packages/dashboard-plugin-skill/src/__tests__/forward-compat.test.ts` SHALL pass against the produced output for items (1)-(6).

#### Scenario: Augmented project resolves from node_modules layout

- **GIVEN** an augmented project is published to npm and installed under `node_modules/@scope/foo/`
- **WHEN** a hypothetical loader reads `node_modules/@scope/foo/package.json#pi-dashboard-plugin`
- **THEN** every path in the manifest SHALL resolve to a real file inside `node_modules/@scope/foo/`.

### Requirement: Templates align with the demo-plugin reference

While `packages/demo-plugin/` exists in the monorepo, the templates in `templates/` SHALL produce output structurally aligned with the demo (same file layout, same import paths from the public root `@blackbelt-technology/dashboard-plugin-runtime`, same `usePluginConfig` usage shape). The deprecated `./context` subpath SHALL NOT appear in templates. When `demo-plugin` is deleted (per its own deletion policy), the skill's templates SHALL become the canonical reference and SHALL be updated only via a separate change.

#### Scenario: Template change is gated on a change proposal

- **WHEN** a contributor edits any file in `templates/`
- **THEN** the change SHALL include an OpenSpec change proposal documenting the rationale, OR the edit SHALL only be a synchronization of paths/version pins matching the rest of the monorepo.

#### Scenario: Template imports the public root

- **WHEN** mode `new` renders `client.tsx`
- **THEN** it SHALL import plugin hooks from `@blackbelt-technology/dashboard-plugin-runtime` and not from `/context`

### Requirement: Skill prints next-steps and never auto-runs them

After every successful run, the skill SHALL print a numbered list of next-steps the user must run themselves: `npm install`, `npm run build` (or the user's project equivalent), and the dashboard restart/reload commands. The skill SHALL NOT automatically run any of these.

#### Scenario: New mode prints the dashboard restart command

- **WHEN** mode `new` finishes successfully
- **THEN** the printed next-steps SHALL include `curl -X POST http://localhost:8000/api/restart` (or the equivalent `pi-dashboard restart` invocation) and SHALL include `npm run reload`.

#### Scenario: Augment mode prints publish guidance

- **WHEN** mode `augment` finishes successfully
- **THEN** the printed next-steps SHALL include `npm run build:dashboard`, guidance on how to publish the augmented project to npm, and a global-scope install (`pi install npm:<package>` from a terminal, which the dashboard shows after a restart, or the dashboard Packages tab, which shows it live), plus the interim path of `npm link`-ing into the dashboard's `packages/` layout
- **AND** they SHALL say that the operator trusts the client bundle (and, for a server entry, grants server trust) from the Plugins tab on the dashboard host itself

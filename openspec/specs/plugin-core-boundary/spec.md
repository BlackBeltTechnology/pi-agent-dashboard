# plugin-core-boundary Specification

## Purpose
TBD - created by archiving change decouple-plugins-from-core. Update Purpose after archive.

## Requirements

### Requirement: Plugin set is derived from manifests

The boundary gate SHALL classify a workspace package as a plugin if and only if its `package.json` declares a `pi-dashboard-plugin` field or an adjacent `dashboard-plugin.json` exists. Every other workspace package SHALL be classified as core. The gate SHALL NOT use package-name patterns to classify packages.

#### Scenario: Suffix-less plugin is classified as a plugin
- **WHEN** `packages/apple-tools/package.json` declares `pi-dashboard-plugin` and its name has no `-plugin` suffix
- **THEN** the gate SHALL treat `apple-tools` as a plugin, and an import of it from `packages/server/src` SHALL be reported

#### Scenario: Non-plugin library is core
- **WHEN** `packages/mcp-core/package.json` declares no plugin manifest
- **THEN** the gate SHALL treat it as core, and plugins MAY import it

### Requirement: Core and plugins SHALL NOT import plugin packages

The gate SHALL report every edge from a core package to a plugin package, and every edge from one plugin to a different plugin. The edge forms are:
- module specifiers in any import, export or `require` form;
- `vi.mock`/`jest.mock` literals;
- `package.json` dependency fields;
- CSS `@source`;
- relative paths into another package.

Comments, plain strings and self-imports SHALL NOT be reported.

#### Scenario: New core import fails the gate
- **WHEN** a change adds `import { x } from "@blackbelt-technology/pi-dashboard-roles-plugin"` to `packages/shared/src/foo.ts`
- **THEN** `npm run check:plugin-boundary` SHALL exit non-zero and print `NEW [prod] packages/shared/src/foo.ts → roles-plugin`

#### Scenario: Every import form is an edge
- **WHEN** a core file references a plugin by `import type`, `export * from`, `import("…")` with a template literal, `require("…")`, `type T = import("…").X`, or `vi.mock("…")`
- **THEN** the gate SHALL report each as an edge

#### Scenario: Dependency and stylesheet edges
- **WHEN** a core `package.json` other than the exempt client dependencies lists a plugin in `dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies`, or a hand-written core CSS file has `@source "../../goal-plugin/src/client"`
- **THEN** the gate SHALL report the edge with kind `pkg` or `css`

#### Scenario: Plugin-to-plugin import fails the gate
- **WHEN** `packages/chat-gateway/src/server/team/tier.ts` imports `@blackbelt-technology/pi-dashboard-mcp-server-plugin/manifest` and no allowlist row covers it
- **THEN** the gate SHALL report the edge as a violation

#### Scenario: Comment mention is not an edge
- **WHEN** a core file mentions `roles-plugin` only inside a comment
- **THEN** the gate SHALL report nothing for that file

### Requirement: Exemptions are explicit, narrow and manifest-derived

The gate SHALL exempt exactly: `packages/client/src/generated/plugin-registry.tsx`; `packages/client/src/generated/plugin-sources.css`; `packages/client/package.json` `dependencies` on plugins in the manifest-derived bundle set (non-fixture, declares `client`, under `<repo>/packages`); and fixture-plugin (`fixture: true`) imports from tests or `devDependencies`. Exemptions SHALL be computed from manifests on every run, never stored as rows. Anything outside them SHALL be reported.

#### Scenario: Generated registry is exempt
- **WHEN** `plugin-registry.tsx` imports every bundled plugin
- **THEN** the gate SHALL report no edge for that file

#### Scenario: New bundled plugin needs no allowlist row
- **WHEN** a change adds a new plugin package under `packages/` with a `client` entry, adds it to `packages/client/package.json` dependencies, and the vite plugin emits its `@source` line
- **THEN** the gate SHALL report no edge for the client dependency or the generated stylesheet, and the allowlist SHALL NOT change

#### Scenario: Client dependency on a client-less plugin is reported
- **WHEN** `packages/client/package.json` lists a plugin that declares no `client` entry
- **THEN** the gate SHALL report the edge with kind `pkg`

#### Scenario: Fixture plugin in production code is reported
- **WHEN** `packages/client/src/App.tsx` imports `demo-plugin`
- **THEN** the gate SHALL report the edge even though `demo-plugin` is a fixture

### Requirement: Ratcheting allowlist

Known edges SHALL be listed in `scripts/plugin-boundary-allowlist.json`, one row per `(from, to)` pair, each carrying `kind`, `reason`, `disposition` and `removedBy`. The gate SHALL fail on an edge with no row (NEW) and on a row matching no current edge (STALE). Permanent rows (disposition `integration-keep`) SHALL be limited to core integration tests and test setup files that need a plugin plus core internals, and their `devDependencies` entry; `reason` SHALL name the guarded core contract.

#### Scenario: Removing an edge without deleting its row fails
- **WHEN** an inversion removes the import in `packages/client/src/lib/package/anthropic-peer.ts` but leaves its allowlist row
- **THEN** the gate SHALL exit non-zero with `STALE allowlist entry … delete it`

#### Scenario: Current tree is green
- **WHEN** the gate runs on a tree whose every edge has exactly one row
- **THEN** it SHALL exit zero

#### Scenario: Re-seeding preserves annotations
- **WHEN** a maintainer runs the gate with `--write-baseline`
- **THEN** the allowlist SHALL be rewritten from current edges, keeping `reason`, `disposition` and `removedBy` for rows that still match

#### Scenario: Line churn does not invalidate rows
- **WHEN** a file with an allowlisted edge gains lines above the import
- **THEN** the gate SHALL still match the row

#### Scenario: Server integration tests stay allowlisted
- **WHEN** `packages/server/src/__tests__/mcp-manifest-completeness.test.ts` imports `mcp-server-plugin` to check core `ROUTE_TIERS` coverage
- **THEN** its row SHALL carry disposition `integration-keep`, and the gate SHALL accept it together with the server's `mcp-server-plugin` devDependency row

#### Scenario: Replay setup file that registers a plugin slice
- **WHEN** the server vitest setup imports the subagents plugin's reducer slice so core replay suites keep asserting subagent state
- **THEN** the PR that adds the import SHALL add its `integration-keep` row naming the replay contract, and the gate SHALL accept it

### Requirement: Gate runs in the standard test and ship paths

The gate SHALL run:

- from a vitest wrapper in the `scripts` vitest project, so `npm test` executes it;
- as `npm run check:plugin-boundary`;
- in the ship gate next to `scripts/check-conventions.mjs`.

It SHALL add no new dependency.

#### Scenario: npm test catches a new edge
- **WHEN** a contributor adds a core→plugin import and runs `npm test`
- **THEN** the run SHALL fail with the gate's NEW report

### Requirement: Core MCP configuration uses the mcp-core library

Core packages and plugins that need MCP configuration behaviour SHALL import it from the non-plugin library `@blackbelt-technology/pi-dashboard-mcp-core`. Core SHALL NOT depend on the mcp-client plugin being enabled or loaded for MCP configuration features it owns.

#### Scenario: Radius MCP without mcp-client
- **WHEN** the mcp-client plugin is disabled and a Radius MCP configuration route is called
- **THEN** the route SHALL behave as it did before this change, using the `mcp-core` service factory

#### Scenario: mcp-server legacy migration
- **WHEN** the mcp-server plugin runs its legacy `mcp.json` migration
- **THEN** it SHALL obtain `createRealConfigIO` from `mcp-core`, and its `package.json` SHALL list no mcp-client plugin dependency of any kind

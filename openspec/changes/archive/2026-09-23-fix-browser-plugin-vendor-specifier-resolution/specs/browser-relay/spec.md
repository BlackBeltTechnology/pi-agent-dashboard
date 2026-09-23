# browser-relay — delta

Note: the baseline `openspec/specs/browser-relay/spec.md` has 11 requirements
and none covers the vendored tree or its integrity — the X14 rule lived only
in the `add-browser-relay` tasks/design and in `vendor/NOTICE`. Both
requirements below are therefore ADDED, not MODIFIED.

## ADDED Requirements

### Requirement: Vendored relay resolves without alias configuration

Every import in `relay/vendor/playwright-core/**` SHALL be a package-relative
path, a Node builtin, or a dependency declared in the plugin's
`package.json`. No import SHALL rely on `tsconfig` `paths`, a bundler
`resolve.alias`, the `JITI_TSCONFIG_PATHS` environment variable, or the
process working directory.

The plugin SHALL therefore load identically in a monorepo checkout, an npm
global install, the managed `~/.pi-dashboard/node_modules` install, the
Electron bundled server, and the Docker image.

#### Scenario: Plugin loads from an install with no monorepo tsconfig
- **GIVEN** the plugin package is installed outside any monorepo, with no `tsconfig.base.json` reachable from it
- **AND** `JITI_TSCONFIG_PATHS` is unset
- **WHEN** the plugin loader imports the plugin's server entry
- **THEN** the import SHALL succeed and `typeof mod.default` SHALL be `"function"`
- **AND** the resolved module path SHALL be inside that install, not inside any monorepo checkout on the host

#### Scenario: Vendored sources carry no unresolvable bare specifier
- **WHEN** the import statements under `relay/vendor/playwright-core/**` are enumerated
- **THEN** every bare specifier SHALL be a Node builtin or a declared dependency
- **AND** a specifier under any playwright-internal namespace (for example `@isomorphic/`, `@utils/`, `@protocol/`, `@injected/`) SHALL fail the check

#### Scenario: Both patched vendored modules are exercised
- **WHEN** the install-load verification runs
- **THEN** it SHALL import `cdpRelay.js` in addition to the plugin server entry, because the runtime chain reaches only `cdpRelayV2.js`

#### Scenario: Server boot loads the browser plugin
- **GIVEN** a dashboard server cold-started through its launcher with `JITI_TSCONFIG_PATHS` explicitly unset
- **AND** the `browser` plugin enabled in config
- **WHEN** plugin loading completes
- **THEN** the log SHALL contain `Loaded plugin "browser"` and no `Failed to load plugin "browser"`

### Requirement: Vendored tree integrity is provenance-aware

Files under `relay/vendor/` SHALL NOT be hand-edited. `playwright-core/**` is
produced by copying from the commit recorded in `vendor/NOTICE` and then
applying `scripts/patch-vendor-specifiers.mjs`, which SHALL be idempotent.

`src/server/__tests__/vendor-hashes.json` SHALL record a provenance `kind`
per file, because the tree is not uniformly upstream:

- `upstream-verbatim` — carries `upstream` (bytes at `upstreamCommit`) and
  `patched` (bytes on disk).
- `authored` — carries `patched` only. `playwright-core/src/server/registry/index.ts`
  and `shims/wsServer.ts` replace upstream modules and have no upstream
  counterpart; recording an `upstream` hash for them would be false.

`shims/**` SHALL be covered by the manifest, since every rewritten import
resolves into that directory.

The integrity test SHALL fail on drift in any `patched` hash, on an added or
removed file, and on an entry missing a key its `kind` requires. Verification
that a refresh faithfully reproduced `upstreamCommit` SHALL be performed by
`scripts/refresh-vendor.mjs` at refresh time against a fetch of that commit —
a test cannot establish it, because regenerating both hashes from one tree is
circular.

Modified vendored files SHALL carry an in-file notice of modification
(Apache-2.0 §4(b)); `vendor/NOTICE` SHALL list them in a Modifications
section and SHALL NOT continue to list them as verbatim (§4(d)).

#### Scenario: Hand-edit is rejected
- **WHEN** a file under `relay/vendor/` is edited by hand
- **THEN** the integrity test SHALL fail on its `patched` hash

#### Scenario: Refresh that skips the patch script is rejected
- **GIVEN** the vendored tree was re-copied from upstream
- **WHEN** `scripts/patch-vendor-specifiers.mjs` was not run
- **THEN** the specifier guard SHALL fail

#### Scenario: Unfaithful refresh is rejected at refresh time
- **GIVEN** a file copied from a revision other than `upstreamCommit`
- **WHEN** `scripts/refresh-vendor.mjs` runs
- **THEN** it SHALL fail on that file's recorded `upstream` hash before patching

#### Scenario: Authored shim is not claimed as upstream
- **WHEN** the manifest is validated
- **THEN** `playwright-core/src/server/registry/index.ts` SHALL have `kind: "authored"` and SHALL NOT carry an `upstream` hash

#### Scenario: Patch script is idempotent
- **WHEN** `scripts/patch-vendor-specifiers.mjs` runs twice in a row
- **THEN** the second run SHALL leave the tree byte-identical, including the in-file modification notice

## MODIFIED Requirements

### Requirement: Shared helper resolves package specs to absolute paths

The dashboard SHALL expose a `resolvePiPackage(spec, opts?)` function from `@blackbelt-technology/pi-dashboard-shared/pi-package-resolver` that accepts a package name string (matching `package.json#name`) and returns either `null` (no match) or an object containing `packageDir` (absolute path to the package root), `entryPath` (absolute path to the importable entry file, or `null` if no entry can be determined), `scope` (`"user"` or `"project"`), `source` (the original `settings.json` entry string), and `packageJsonName` (the parsed `name` field from `package.json`, or `null` if absent).

The function SHALL also export a convenience wrapper `resolvePiPackageEntry(spec, opts?)` that returns just the `entryPath` string or `null`.

The function SHALL be synchronous (no `Promise` return) so plugin bridges and tier-2 probe callers can use it in synchronous fall-through paths without forcing their entire chain to be async.

The function SHALL perform only filesystem reads — never writes and never network calls. It MAY spawn exactly one process per process lifetime: the memoized `npm root -g` probe used when the caller supplies no `npmRoot` (see the added requirement below). No other process spawning is permitted.

#### Scenario: Spec resolves to an npm-installed peer in global scope

- **GIVEN** `~/.pi/agent/settings.json` contains `"packages": ["npm:@pi/anthropic-messages"]`
- **AND** `~/.pi/agent/node_modules/@pi/anthropic-messages/package.json` declares `{"name": "@pi/anthropic-messages", "exports": {".": "./extensions/index.js"}}`
- **WHEN** a caller invokes `resolvePiPackage("@pi/anthropic-messages")`
- **THEN** the function SHALL return `{ packageDir: "~/.pi/agent/node_modules/@pi/anthropic-messages", entryPath: "~/.pi/agent/node_modules/@pi/anthropic-messages/extensions/index.js", scope: "user", source: "npm:@pi/anthropic-messages", packageJsonName: "@pi/anthropic-messages" }` (with `~` expanded to the user's home directory).

#### Scenario: Spec resolves to a git-cloned peer

- **GIVEN** `~/.pi/agent/settings.json` contains `"packages": ["https://github.com/BlackBeltTechnology/pi-anthropic-messages.git"]`
- **AND** the directory `~/.pi/agent/git/github.com/BlackBeltTechnology/pi-anthropic-messages/` exists with a valid `package.json` declaring `name: "@pi/anthropic-messages"` and `main: "./extensions/index.ts"`
- **WHEN** a caller invokes `resolvePiPackage("@pi/anthropic-messages")`
- **THEN** the function SHALL return a result whose `packageDir` points to the cloned directory and `entryPath` resolves the `main` field to an absolute path that exists on disk.

#### Scenario: Spec resolves to a peer installed via absolute path

- **GIVEN** `~/.pi/agent/settings.json` contains `"packages": ["/home/skrot1/BB/pi-packages/pi-anthropic-messages"]`
- **AND** the directory exists with a `package.json` declaring `name: "@pi/anthropic-messages"`
- **WHEN** a caller invokes `resolvePiPackage("@pi/anthropic-messages")`
- **THEN** the function SHALL return a result whose `packageDir` equals `/home/skrot1/BB/pi-packages/pi-anthropic-messages` and whose `entryPath` follows the entry-point resolution chain.

#### Scenario: Spec not found in any scope

- **GIVEN** neither `~/.pi/agent/settings.json#packages[]` nor `<cwd>/.pi/settings.json#packages[]` contains an entry whose resolved `package.json#name` matches `spec`
- **WHEN** a caller invokes `resolvePiPackage("@some/missing")`
- **THEN** the function SHALL return `null`.

## ADDED Requirements

### Requirement: Memoization is scoped to the npm global root only

The resolver SHALL remain read-only and read-on-call: it never installs and never mutates. The memoized `npm root -g` result SHALL be its ONLY module-level state; settings reads, `package.json` reads, and resolution results SHALL NOT be cached. The capability Purpose sentence ("never installs, never mutates, never caches") and the module header ("holds no module-level cache") SHALL be updated to state this single exception.

#### Scenario: settings edits take effect without a restart

- **GIVEN** a package is added to `~/.pi/agent/settings.json#packages[]` after a first resolution
- **WHEN** `resolvePiPackageEntry` is called again in the same process
- **THEN** the new package SHALL resolve

#### Scenario: stated contract matches behaviour

- **WHEN** the change is archived
- **THEN** neither the capability Purpose nor the module header SHALL claim the resolver never caches

### Requirement: Default npm global root is memoized per process

`resolvePiPackageEntry` and `listPiPackages` SHALL shell out to `npm root -g`
(via `rootGlobalOr("")`) at most once per process when `opts.npmRoot` is
absent, caching the result (including an empty-string result) for every later
call. `opts.npmRoot` SHALL bypass the cache. A test-only reset export SHALL
clear the cache.

#### Scenario: Repeated resolves shell out once

- **WHEN** `resolvePiPackageEntry` is called three times and `listPiPackages`
  once, none with `npmRoot`
- **THEN** `rootGlobalOr` is invoked exactly once

#### Scenario: Explicit npmRoot bypasses the cache

- **WHEN** `resolvePiPackageEntry(spec, { npmRoot: "/tmp/x" })` is called
- **THEN** `rootGlobalOr` is not invoked and `/tmp/x` is used

#### Scenario: Missing npm is cached too

- **WHEN** `rootGlobalOr` returns `""`
- **THEN** subsequent default resolves do not invoke it again

#### Scenario: Extension load cost

- **WHEN** an extension whose activation calls `resolvePiPackageEntry` is
  instantiated for N child sessions in one process
- **THEN** only the first instantiation pays the `npm root -g` cost

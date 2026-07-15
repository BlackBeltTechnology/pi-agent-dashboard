# Package Management

## Purpose

Package management for pi extensions, skills, prompts, and themes. Covers pi module resolution, scope-to-scope moves, and the WebSocket event protocol used to track composite operations.
## Requirements
### Requirement: Pi module resolution

`loadPiPackageManager()` SHALL resolve pi's `DefaultPackageManager` and `SettingsManager` using the following ordered resolution chain. Each step tries the primary fork name first (`@earendil-works/pi-coding-agent`) and falls back to the legacy fork name (`@mariozechner/pi-coding-agent`) before moving to the next step. The function SHALL NOT probe `@oh-my-pi/pi-coding-agent`.

1. Direct import — first `@earendil-works/pi-coding-agent`, then `@mariozechner/pi-coding-agent`.
2. Managed install — `~/.pi-dashboard/node_modules/@earendil-works/pi-coding-agent/dist/index.js`, then `~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent/dist/index.js`.
3. Global npm root via `npm root -g` — first the earendil package, then the mariozechner package.

The function SHALL return the first successful resolution and cache the result. If all paths fail, it SHALL throw an error with message "pi-coding-agent is not installed."

#### Scenario: Pi found in earendil global install (preferred)

- **WHEN** `@earendil-works/pi-coding-agent` is installed globally
- **AND** `@mariozechner/pi-coding-agent` is NOT installed
- **THEN** `loadPiPackageManager()` resolves successfully via the earendil direct-import or managed-install path
- **AND** the legacy fork is never probed

#### Scenario: Pi found in legacy global install (fallback)

- **WHEN** only `@mariozechner/pi-coding-agent` is installed globally
- **THEN** the earendil probe fails fast (one ENOENT) and the mariozechner probe succeeds
- **AND** `loadPiPackageManager()` returns the resolved managers without surfacing the earendil failure

#### Scenario: Pi found in managed install directory (preferred fork)

- **WHEN** direct import fails
- **AND** pi is installed at `~/.pi-dashboard/node_modules/@earendil-works/pi-coding-agent/dist/index.js`
- **THEN** `loadPiPackageManager()` resolves successfully and returns `DefaultPackageManager` and `SettingsManager`

#### Scenario: Pi found in managed install under legacy fork name

- **WHEN** direct import fails
- **AND** the earendil variant is not in the managed install
- **AND** `@mariozechner/pi-coding-agent` is present in the managed install
- **THEN** `loadPiPackageManager()` resolves successfully from the mariozechner variant

#### Scenario: Both forks present in managed install

- **WHEN** both `@earendil-works/pi-coding-agent` and `@mariozechner/pi-coding-agent` are installed under `~/.pi-dashboard/node_modules/`
- **THEN** the resolver SHALL pick `@earendil-works/pi-coding-agent` (the order-first probe)
- **AND** the legacy fork SHALL remain on disk untouched

#### Scenario: Managed install not present falls through to global npm

- **WHEN** direct import fails AND managed install directory does not contain pi
- **THEN** resolution falls through to global npm root check without error

#### Scenario: All resolution paths fail

- **WHEN** direct import, managed install, and global npm all fail for both fork names
- **THEN** `loadPiPackageManager()` throws an error with message containing "pi-coding-agent is not installed"

#### Scenario: oh-my-pi install ignored

- **WHEN** only `@oh-my-pi/pi-coding-agent` is installed
- **THEN** `loadPiPackageManager()` SHALL throw "pi-coding-agent is not installed"
- **AND** the dashboard SHALL surface the install hint for `@earendil-works/pi-coding-agent`

### Requirement: Server moves packages between scopes via hybrid execution
The server SHALL expose `POST /api/packages/move` accepting:

```
{
  entry:     string | { source: string, ...filters },
  fromScope: "global" | "local",
  fromCwd?:  string,    // required if fromScope === "local"
  toScope:   "global" | "local",
  toCwd?:    string     // required if toScope === "local"
}
```

The endpoint SHALL execute the move using a hybrid strategy keyed on `parseSourceKind(entry.source)`:

- For source kinds `npm:`, `git:`, and `https://`, the server SHALL:
  1. Install the package at `toScope` (and `toCwd` if local) using pi's `installAndPersist` via the existing `package-manager-wrapper`, with session reload suppressed.
  2. On install success, remove the package from `fromScope` (and `fromCwd` if local) using `removeAndPersist`.
  3. Trigger session reload exactly once after the remove phase.
- For source kinds `abs-path` and `rel-path`, the server SHALL:
  1. Read both `settings.json` files via pi's settings APIs.
  2. Compute a destination-appropriate source string (absolute when `toScope === "global"`; relative-to-toCwd when `toScope === "local"` and the relative form does not escape the cwd subtree by more than 2 levels).
  3. Splice the (rewritten) entry into the destination `packages[]` and remove from origin `packages[]`.
  4. Atomically write both `settings.json` files.
  5. Trigger session reload once.

The endpoint SHALL preserve the entire original entry verbatim (including filter object form with `extensions`/`skills`/`prompts`/`themes` keys) across the move, replacing only the `source` field when path-rewriting.

The endpoint SHALL return `202 { moveId, phases }` on success, where `phases` is `["install","remove"]` for the npm/git/https arm and `["settings-edit"]` for the path arm.

#### Scenario: Move npm package from global to local
- **WHEN** client sends `POST /api/packages/move` with `{ entry: "npm:pi-flows", fromScope: "global", toScope: "local", toCwd: "/abs/cwd" }`
- **THEN** the server installs `npm:pi-flows` at `/abs/cwd/.pi/settings.json`
- **AND** removes `npm:pi-flows` from `~/.pi/agent/settings.json`
- **AND** returns `202` with `phases: ["install","remove"]`
- **AND** triggers exactly one session reload

#### Scenario: Move git package preserving pinned ref
- **WHEN** client sends `POST /api/packages/move` with `entry: "git:github.com/x/y@v1.2.3"`
- **THEN** both phases use the verbatim source string `git:github.com/x/y@v1.2.3`
- **AND** the destination `packages[]` entry retains the `@v1.2.3` pin

#### Scenario: Move filtered package preserves filters
- **WHEN** client sends `POST /api/packages/move` with `entry: { source: "npm:my-pkg", extensions: ["a.ts"], skills: [] }`
- **THEN** the destination `packages[]` entry is identical to the input entry except for any path-rewriting of `source`
- **AND** the `extensions` and `skills` filter arrays are preserved verbatim

#### Scenario: Move relative-path package to global resolves absolute
- **WHEN** client sends `POST /api/packages/move` with `entry: { source: ".." }, fromScope: "local", fromCwd: "/abs/project", toScope: "global"`
- **THEN** the server computes the destination source as the absolute path `/abs` (resolving `..` against `/abs/project/.pi/settings.json` location)
- **AND** writes only to settings; no file copy occurs

#### Scenario: Move absolute-path package to local with relative form
- **WHEN** client sends `POST /api/packages/move` with `entry: { source: "/abs/project/vendor/x" }, toScope: "local", toCwd: "/abs/project"`
- **THEN** the server computes the destination source as `./vendor/x` (relative to `/abs/project/.pi/settings.json`)
- **AND** writes only to settings; no file copy occurs

#### Scenario: Move absolute-path package to local across volumes keeps absolute
- **WHEN** the relative form would require `../../...` escaping the cwd tree by more than 2 levels
- **THEN** the destination source remains absolute

### Requirement: Move endpoint rejects already-at-destination via identity preflight
The server SHALL compute package identity using pi's dedup rules:

- `npm:<spec>` identity = bare package name (with scope, without `@version`).
- `git:<url>` / `https://<url>` identity = repository URL with `@<ref>` stripped.
- Path source identity = resolved absolute path.

Before invoking install or settings-edit, the server SHALL check whether any entry in `toScope`'s `packages[]` has the same identity. If so, the server SHALL return `409 already_at_destination` with no side effects.

#### Scenario: Already at destination returns 409
- **GIVEN** `~/.pi/agent/settings.json` already contains `npm:pi-flows`
- **WHEN** client sends a move from local to global for `npm:pi-flows`
- **THEN** the server returns `409 already_at_destination` and performs no install or remove

### Requirement: Move endpoint surfaces partial success via composite WebSocket event
The `/api/packages/move` endpoint is asynchronous (returns `202 { moveId }` immediately and runs install + remove phases in the background). When the npm/git/https execution arm successfully installs at the destination but fails to remove from the origin, the server SHALL emit a `package_operation_complete` WebSocket event for the move with:

```
{
  type: "package_operation_complete",
  operationId: <moveId>,
  moveId: <moveId>,
  action: "move",
  source: <entry.source>,
  scope: <toScope>,
  success: true,
  partialSuccess: {
    installed: true,
    removed: false,
    removeError: <message>
  }
}
```

The client SHALL surface this state with a recovery affordance (Cleanup button) that POSTs `/api/packages/remove` against `fromScope` (idempotent on retry — already-removed entries are a no-op).

#### Scenario: Install succeeds, remove fails
- **WHEN** install at destination completes, but `removeAndPersist` throws
- **THEN** the move's `package_operation_complete` event has `success: true` and `partialSuccess: { installed: true, removed: false, removeError: <msg> }`
- **AND** the client renders a Cleanup banner that retries the remove against `fromScope`

### Requirement: Move endpoint emits composite progress events
For an `npm:`/`git:`/`https://` move, the server SHALL emit `package_progress` and `package_operation_complete` WebSocket events for both the install phase and the remove phase, each tagged with the same optional `moveId: string` field. For a path-source move, the server SHALL emit a single `settings-edit` progress event tagged with `moveId`.

Existing consumers that ignore the `moveId` field SHALL continue to render install + remove as two separate progress operations without breakage.

#### Scenario: Composite events share moveId
- **WHEN** a successful npm-source move completes
- **THEN** every `package_progress` event for both phases contains `moveId: <id>`
- **AND** the final `package_operation_complete` event contains the same `moveId: <id>` and `action: "move"`

### Requirement: Move endpoint validates scope and cwd inputs
The server SHALL return `400 invalid_request` when:

- `fromScope === toScope`
- `fromScope === "local"` and `fromCwd` is missing or not a string
- `toScope === "local"` and `toCwd` is missing or not a string
- `entry` is missing or not a string/object with a `source` string

The server SHALL return `400 unsupported_source_for_destination` when a relative-path source cannot be resolved (e.g., `fromCwd` not provided for a relative-path move).

#### Scenario: Same-scope move rejected
- **WHEN** client sends `fromScope: "global", toScope: "global"`
- **THEN** server returns `400 invalid_request`

#### Scenario: Local move missing cwd rejected
- **WHEN** client sends `toScope: "local"` without `toCwd`
- **THEN** server returns `400 invalid_request`

### Requirement: Atomic reset-to-npm composite operation
Package management SHALL provide an atomic composite operation that resets a source-override package to its canonical published npm version by installing the `npm:<name>` spec FIRST and, only on a successful install, removing the local/git `settings.json#packages[]` entry — both in the row's own scope. This mirrors the existing scope-to-scope move (install-new + remove-old) but swaps the source kind (local/git → npm) rather than the scope.

The operation SHALL surface a package action value `reset` and SHALL emit a `package_operation_complete` WebSocket event through the same composite-operation protocol as `move`. If the install step fails, the local/git entry SHALL remain untouched and the operation SHALL report failure. If the install succeeds but the remove step fails, the operation SHALL report partial success (npm installed, local/git entry still present) so the client can surface a cleanup affordance.

#### Scenario: Successful reset installs npm then drops local entry
- **WHEN** a reset is requested for an override row whose canonical spec is `npm:<name>` in scope S
- **THEN** `npm:<name>` SHALL be installed in scope S first
- **AND** on install success the original local/git `packages[]` entry SHALL be removed from scope S
- **AND** a `package_operation_complete` event with action `reset` SHALL be emitted

#### Scenario: Install failure leaves override intact
- **WHEN** the `npm:<name>` install step fails during a reset
- **THEN** the original local/git entry SHALL remain registered
- **AND** the operation SHALL report failure without removing anything

#### Scenario: Partial success when remove fails after install
- **WHEN** the npm install succeeds but removing the local/git entry fails
- **THEN** the operation SHALL report partial success naming both the installed npm spec and the still-present local/git entry


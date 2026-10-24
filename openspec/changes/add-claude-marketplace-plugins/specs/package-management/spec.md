# Spec Delta

## MODIFIED Requirements

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
- For a source that resolves, relative to its settings file, inside the dashboard's imported Claude plugin directory, the server SHALL NOT use the path arm below. It SHALL instead:
  1. Create a new install of the same plugin at `toScope` (and `toCwd` if local), reusing the source install's plugin files with no re-fetch and no new consent.
  2. On success, remove the install at `fromScope` with the imported-plugin removal behaviour.
  3. Trigger session reload exactly once, after the remove phase.

  It SHALL refuse with 409 when the plugin is already installed at the destination scope. It SHALL refuse with 400 when moving a plugin whose only supported components are agents to local scope.
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

#### Scenario: Imported Claude plugin moves by re-import
- **WHEN** a move request names an imported Claude plugin installed globally, with `toScope: "local"`
- **THEN** the plugin is installed at local scope as its own install with the same version, the global install is removed and its generated files deleted, and sessions reload exactly once

#### Scenario: Imported Claude plugin already at destination
- **WHEN** a move request names imported Claude plugin `x` installed globally, and `x` is already installed locally for `toCwd`
- **THEN** the server responds 409, and neither install changes

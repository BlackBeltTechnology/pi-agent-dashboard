## MODIFIED Requirements

### Requirement: `extensionConfig` is projected to namespaced env on the headless spawn

On the headless plugin-spawn mechanism (the only mechanism `spawnSession` uses), the host SHALL project each `scope.extensionConfig[name][key]` entry into the spawned process env as a variable named `PI_EXT_<NAME>_<KEY>`, where `<NAME>` and `<KEY>` are the extension name and config key normalized to a valid POSIX env-var identifier by splitting camelCase boundaries (inserting `_` between a lowercase/digit and a following uppercase letter), then uppercasing, then replacing every character outside `[A-Z0-9_]` with `_`. So `allowedRoots` normalizes to `ALLOWED_ROOTS` (not `ALLOWEDROOTS`).

A config value MAY be a `string` or a `string[]`. A `string` value SHALL be projected **verbatim** as the env value. A `string[]` value SHALL be projected as its **JSON encoding** (`JSON.stringify(value)`) as the env value; the consuming extension `JSON.parse`s the value for keys it knows to be array-typed. This encoding SHALL be lossless for values containing characters unsafe for a delimiter-join convention (filesystem paths, commas, spaces): a `string[]` round-tripped through the env and `JSON.parse` SHALL deep-equal the original array. A spawn whose `scope.extensionConfig` names an extension SHALL own that extension's env namespace. Before any projection, the host SHALL remove from the spawned process env every variable whose name starts with `PI_EXT_<NAME>_`, for every configured normalized extension name. This includes variables of other extensions whose normalized names share that prefix. Independently of `scope.extensionConfig`, and also before any projection, the host SHALL remove every `PI_EXT_PATH_CONTAINMENT_GUARD_` variable from the env of every headless spawn. path-containment-guard configuration can then only come from the spawn's own `extensionConfig`. A tmux-mechanism pane takes its env from the tmux server, so it is outside this guarantee; plugin spawns are headless-only. Removal and projection SHALL happen after spawn-env contributors have run, so a contributor can neither re-fill a removed variable nor override a projected one. Inherited `PI_EXT_*` variables outside every removed prefix SHALL be left unchanged. `extensionConfig` SHALL NOT contribute any pi argv element. Routing `scope` through a tmux mechanism would require per-window `-e` env injection (as the spawn-token already does) and is out of scope for this change, since plugin spawns are headless-only.

#### Scenario: Config entry becomes a namespaced env var
- **WHEN** `scope.extensionConfig` is `{ "myext": { "token": "abc" } }`
- **THEN** the spawned process env SHALL contain `PI_EXT_MYEXT_TOKEN=abc`
- **AND** no argv element SHALL be derived from `extensionConfig`

#### Scenario: Names and keys are normalized to valid env identifiers
- **WHEN** `scope.extensionConfig` is `{ "my-ext": { "api.key": "v" } }`
- **THEN** the spawned process env SHALL contain `PI_EXT_MY_EXT_API_KEY=v`

#### Scenario: Array value is JSON-encoded into env
- **WHEN** `scope.extensionConfig` is `{ "guard": { "allowedRoots": ["/a", "/b,c", " /d "] } }`
- **THEN** the spawned process env SHALL contain `PI_EXT_GUARD_ALLOWED_ROOTS` whose value is `JSON.stringify(["/a", "/b,c", " /d "])`
- **AND** `JSON.parse` of that value SHALL deep-equal the original array (lossless round-trip, no delimiter ambiguity for paths)

#### Scenario: Scalar and array values coexist under one extension
- **WHEN** `scope.extensionConfig` is `{ "guard": { "token": "abc", "allowedRoots": ["/a"] } }`
- **THEN** the env SHALL contain `PI_EXT_GUARD_TOKEN=abc` (scalar verbatim) and `PI_EXT_GUARD_ALLOWED_ROOTS=["/a"]` (array JSON-encoded)

#### Scenario: A named extension's inherited env is replaced, not merged
- **GIVEN** the host process env contains `PI_EXT_GUARD_ALLOWED_ROOTS=["/old"]` and `PI_EXT_GUARD_TOKEN=stale`
- **WHEN** `scope.extensionConfig` is `{ "guard": { "allowedRoots": ["/new"] } }`
- **THEN** the spawned process env SHALL contain `PI_EXT_GUARD_ALLOWED_ROOTS=["/new"]`
- **AND** SHALL NOT contain `PI_EXT_GUARD_TOKEN`

#### Scenario: A dropped entry does not fall back to the inherited value
- **GIVEN** the host process env contains `PI_EXT_GUARD_ALLOWED_ROOTS=["/old"]`
- **WHEN** `scope.extensionConfig` is `{ "guard": { "allowedRoots": [7] } }` (no valid element, so the entry is dropped)
- **THEN** the spawned process env SHALL NOT contain `PI_EXT_GUARD_ALLOWED_ROOTS`

#### Scenario: Other extensions' inherited env is untouched
- **GIVEN** the host process env contains `PI_EXT_OTHER_KEY=v`
- **WHEN** `scope.extensionConfig` is `{ "guard": { "token": "abc" } }`
- **THEN** the spawned process env SHALL still contain `PI_EXT_OTHER_KEY=v`

#### Scenario: Inherited guard env never reaches a spawned session
- **GIVEN** the host process env contains `PI_EXT_PATH_CONTAINMENT_GUARD_ALLOWED_ROOTS=["/old"]`
- **WHEN** a session is spawned with `scope.extensions` naming the guard and no `scope.extensionConfig`
- **THEN** the spawned process env SHALL NOT contain `PI_EXT_PATH_CONTAINMENT_GUARD_ALLOWED_ROOTS`

#### Scenario: A contributor cannot fill an owned namespace
- **GIVEN** a spawn-env contributor that supplies `PI_EXT_GUARD_TOKEN=c`
- **WHEN** `scope.extensionConfig` is `{ "guard": { "allowedRoots": ["/new"] } }`
- **THEN** the spawned process env SHALL NOT contain `PI_EXT_GUARD_TOKEN`

#### Scenario: extensionConfig absent leaves env untouched
- **WHEN** `scope.extensionConfig` is absent
- **THEN** the spawned process env SHALL contain no `PI_EXT_*` variable introduced by this capability
- **AND** inherited `PI_EXT_*` variables SHALL be unchanged, except those under `PI_EXT_PATH_CONTAINMENT_GUARD_`

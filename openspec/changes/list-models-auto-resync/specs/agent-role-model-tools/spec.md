# Spec Delta

## MODIFIED Requirements

### Requirement: The dashboard SHALL register a `list_models` agent tool decoupled from roles

The dashboard extension SHALL register a `list_models` tool via `pi.registerTool` at activation. The tool SHALL NOT write any config file (it is read-only with respect to `providers.json`, `auth.json`, `models.json`, `settings.json`); it MAY re-sync the in-process session registry before reading (see the resync requirement). It returns the assignable model catalogue from the IN-PROCESS session registry via the EXACT SAME source the human Model Selector uses: `cachedModelRegistry.getAvailable().map(toModelInfo)` (the path feeding the `models_list` push and `flow:get-available-models`), NOT the dashboard server's `registry-singleton`. This guarantees the tool lists the same models the picker shows — including custom providers registered via `pi.registerProvider()` (which register into the same registry; `getAvailable()` surfaces pi-ai's catalog PLUS custom models) — and that returned `ref`s match what `update_roles` `set_role` persists and `model:resolve` resolves.

Each row SHALL carry the `toModelInfo` projection including the `custom?: boolean` flag (true for models from a `pi.registerProvider()` custom provider), so an agent can distinguish custom-provider models. Because `getAvailable()` is reachability-filtered, a custom provider without resolved credentials is excluded from the default result; the tool MAY accept an `annotated` flag surfacing every known model with `excludedReason` (`no-credential` / `oauth-incompatible`), derived in-process from the registry's `getAll()` minus `getAvailable()` (pi's session `ModelRegistry` exposes no `getAllAnnotated()` — that method exists only on the server's `InternalRegistry`).

The tool SHALL be fully DECOUPLED from the role subsystem: it SHALL NOT read `providers.json#roles` and SHALL succeed even when the role slice is missing or malformed. Each row SHALL be `{ ref, provider, id, custom?, reasoning, input, contextWindow, cost }`, where `ref` is the exact `"provider/modelId"` literal accepted by `update_roles` `set_role` and parsed by `model:resolve`.

The tool result SHALL additionally carry a `registryReady: boolean` discriminator so that an empty `models` array is never ambiguous between "the in-process registry is not yet hydrated" and "the registry is hydrated but exposes no reachable models". `registryReady` SHALL be `false` if and only if the tool's registry accessor (`getRegistry()` / `cachedModelRegistry`) is absent (falsy) at invocation time; otherwise `registryReady` SHALL be `true`. When `registryReady` is `false`, the result SHALL include a non-empty `reason` string explaining the registry is not yet hydrated and that the caller may retry, and `models` SHALL be `[]`. When `registryReady` is `true`, `reason` SHALL be omitted (or `null`) and `models` SHALL be the reachability-filtered catalogue (possibly `[]` when no provider has resolved credentials). The `registryReady` and `reason` fields SHALL be additive and backward-compatible: consumers that read only `models` SHALL be unaffected. The `annotated` mode SHALL obey the identical discriminator — a falsy registry under `annotated: true` SHALL also yield `registryReady: false` with an empty `models` and a `reason`, never a silent empty catalogue.

#### Scenario: list_models returns assignable refs

- **WHEN** an agent invokes `list_models`
- **THEN** every row SHALL carry a `ref` string of the form `"provider/id"` assignable via `update_roles`
- **AND** each row SHALL include available capability metadata (`reasoning`, `input`, `contextWindow`, `cost`) when known

#### Scenario: list_models works when roles are unavailable

- **GIVEN** `providers.json#roles` is missing or contains malformed JSON
- **WHEN** an agent invokes `list_models`
- **THEN** the tool SHALL return the model catalogue normally
- **AND** SHALL NOT throw or depend on the role slice

#### Scenario: Custom registered providers appear with an assignable ref and custom flag

- **GIVEN** a reachable custom provider `mycustom` (registered via `pi.registerProvider()`) with model `foo-v2`, present in `cachedModelRegistry.getAvailable()`
- **WHEN** an agent invokes `list_models`
- **THEN** the result SHALL include `{ ref: "mycustom/foo-v2", provider: "mycustom", id: "foo-v2", custom: true, … }`
- **AND** the row SHALL match what the human Model Selector shows for that model (same `getAvailable()`+`toModelInfo` source)

#### Scenario: Uncredentialed custom provider surfaces only under annotated mode

- **GIVEN** a custom provider `mycustom` registered but WITHOUT resolved credentials (excluded from `getAvailable()`)
- **WHEN** an agent invokes `list_models` without `annotated`
- **THEN** `mycustom` models SHALL be absent
- **WHEN** an agent invokes `list_models` with `annotated`
- **THEN** `mycustom` models SHALL be present each carrying `excludedReason: "no-credential"`

#### Scenario: Absent registry reports registryReady false with a reason (not a silent empty)

- **GIVEN** the in-process registry accessor is falsy (the session's `cachedModelRegistry` has not been captured from `ctx.modelRegistry` yet — the spawn-before-discovery window)
- **WHEN** an agent invokes `list_models`
- **THEN** the result SHALL be `{ models: [], registryReady: false, reason: <non-empty string> }`
- **AND** the `reason` SHALL indicate the registry is not yet hydrated and the caller may retry
- **AND** the tool SHALL NOT throw

#### Scenario: Hydrated-but-empty registry reports registryReady true

- **GIVEN** the registry accessor returns a registry whose `getAvailable()` is `[]` (no provider has resolved credentials)
- **WHEN** an agent invokes `list_models`
- **THEN** the result SHALL be `{ models: [], registryReady: true }`
- **AND** `reason` SHALL be omitted or `null`
- **AND** the empty result SHALL be reported as a true "no reachable models" answer, distinguishable from the absent-registry case

#### Scenario: Populated registry is unchanged and reports registryReady true

- **GIVEN** the registry accessor returns a registry whose `getAvailable()` yields one or more models
- **WHEN** an agent invokes `list_models`
- **THEN** the result SHALL carry `registryReady: true` and the full `models` array with the pre-existing row shape
- **AND** a consumer reading only `models` SHALL observe no behavioral change

#### Scenario: Annotated mode obeys the same discriminator on an absent registry

- **GIVEN** the in-process registry accessor is falsy
- **WHEN** an agent invokes `list_models` with `annotated: true`
- **THEN** the result SHALL be `{ models: [], registryReady: false, reason: <non-empty string> }`
- **AND** SHALL NOT return a silent empty catalogue as if every known model were unknown

## ADDED Requirements

### Requirement: list_models SHALL resync the registry from global config before every read

On every invocation with a present registry, `list_models` SHALL, before reading the catalogue, re-sync the session registry from machine-wide config the same way the Model Selector does on open: re-apply `~/.pi/agent/providers.json` custom-provider changes, then run a LOCAL-only registry refresh (no remote catalogue fetch) that re-reads `models.json` and stored credentials. Automatic; no caller parameter.

#### Scenario: Provider added to providers.json after session start appears without a broadcast

- **GIVEN** a session whose registry was hydrated before custom provider `newprov` (reachable, credentialed, model `m1`) was added to `~/.pi/agent/providers.json`
- **AND** the session never received a `credentials_updated` broadcast
- **WHEN** an agent invokes `list_models`
- **THEN** the result SHALL include a row with `ref: "newprov/m1"` and `custom: true`

#### Scenario: Provider removed from providers.json disappears

- **GIVEN** custom provider `oldprov` was registered at session start and has since been removed from a well-formed `~/.pi/agent/providers.json`
- **WHEN** an agent invokes `list_models`
- **THEN** no row SHALL have `provider: "oldprov"`

#### Scenario: Credential added after session start makes a model reachable

- **GIVEN** a built-in provider whose credential was written to `auth.json` after the session started (no broadcast received)
- **WHEN** an agent invokes `list_models` without `annotated`
- **THEN** that provider's models SHALL be present in `models`

#### Scenario: Resync never fetches remote catalogues

- **WHEN** an agent invokes `list_models`
- **THEN** the registry refresh SHALL be requested with network access disabled
- **AND** a remote model-list fetch SHALL occur only for a custom provider whose `providers.json` entry was added or changed since the last sync

#### Scenario: Agent sees every model the Selector shows after an out-of-band config change

- **GIVEN** the global config changed out-of-band
- **AND** no `enabledModels` filter is configured in `settings.json` and the session model scope is empty
- **WHEN** the human opens the Model Selector and an agent invokes `list_models` in the same session
- **THEN** the set of `ref`s the agent receives SHALL equal the set of models the Selector lists

#### Scenario: Absent registry skips the resync

- **GIVEN** the registry accessor is falsy
- **WHEN** an agent invokes `list_models`
- **THEN** no resync SHALL be attempted
- **AND** the result SHALL be `{ models: [], registryReady: false, reason: <non-empty string> }` as before

#### Scenario: Agent abort stops waiting without aborting the shared refresh

- **GIVEN** a `list_models` resync is in flight
- **WHEN** the tool call's abort signal fires
- **THEN** the tool SHALL stop waiting and return the last-known catalogue without throwing
- **AND** SHALL NOT start a registry refresh if one has not started yet
- **AND** SHALL NOT abort a registry refresh already in progress (another caller may share its availability pass)
- **AND** custom-provider discovery already in progress MAY continue in the background

### Requirement: list_models resync failure SHALL degrade to the last-known catalogue

If any resync step throws, is aborted, or exceeds its bound, `list_models` SHALL NOT throw; it SHALL log and return the last-known catalogue with `registryReady: true`. The providers re-apply and the local refresh SHALL each have their own bound, and the local refresh SHALL run even when the re-apply fails or times out. Per-provider refresh failures SHALL appear in an additive `refreshErrors: { provider, message }[]`, omitted when none or aborted.

#### Scenario: providers.json re-apply throws

- **GIVEN** re-applying `providers.json` throws
- **WHEN** an agent invokes `list_models`
- **THEN** the tool SHALL still run the local refresh and return the catalogue with `registryReady: true`
- **AND** SHALL NOT throw

#### Scenario: Slow providers re-apply still runs the local refresh

- **GIVEN** the providers re-apply (e.g. a slow custom-provider `/models` discovery) does not settle within its bound
- **AND** a built-in provider credential was written to `auth.json` after session start
- **WHEN** an agent invokes `list_models`
- **THEN** the local registry refresh SHALL still run after the re-apply bound elapses
- **AND** that built-in provider's models SHALL be present in `models`

#### Scenario: Hung refresh is bounded

- **GIVEN** the local registry refresh does not settle within its bound
- **WHEN** an agent invokes `list_models`
- **THEN** the tool SHALL return the last-known catalogue with `registryReady: true` once the bound elapses

#### Scenario: Registry cleared during the resync

- **GIVEN** the registry accessor was present when the call started but returns falsy after the resync
- **WHEN** the tool builds its result
- **THEN** it SHALL use the registry instance read at call start and report `registryReady: true`

#### Scenario: Per-provider refresh error is reported

- **GIVEN** the refresh completes with an error for provider `flaky`
- **WHEN** an agent invokes `list_models`
- **THEN** the result SHALL include `refreshErrors` containing `{ provider: "flaky", message: <non-empty string> }`
- **AND** `models` SHALL still contain every other reachable model

#### Scenario: Clean refresh omits refreshErrors

- **GIVEN** the refresh completes with no errors and no abort
- **WHEN** an agent invokes `list_models`
- **THEN** the result SHALL NOT carry a `refreshErrors` key

#### Scenario: Aborted refresh omits refreshErrors

- **GIVEN** the refresh resolves with `aborted: true` and a non-empty error map
- **WHEN** an agent invokes `list_models`
- **THEN** the result SHALL NOT carry a `refreshErrors` key

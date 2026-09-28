# system-one-config Specification

## Purpose
TBD - created by archiving change add-system-one-registry. Update Purpose after archive.

## Requirements

### Requirement: Config location and precedence
The user config SHALL live at `~/.pi/agent/system-one.json`. A project override MAY live at `<cwd>/.pi/system-one.json`. It SHALL be read only when the `predict` caller passes `project: { cwd, trusted: true }`. `trusted` SHALL be pi's project-trust decision for that cwd, the same decision pi uses to load project `.pi/` resources, and never a hard-coded `true`. Callers without a project (e.g. server-side fleet consumers) SHALL use the user config alone. The effective config SHALL be the user config with the permitted project keys merged on top. Invalid JSON in a layer SHALL be treated as that layer being absent, with one `[system-one]` warning per process naming the file. The config SHALL carry `version: 1`; an unknown `version` SHALL be treated as absent, with the same warning. Both layers SHALL be parsed into null-prototype objects. Any key named `__proto__`, `constructor` or `prototype`, at any depth, SHALL be dropped with one warning. All reads SHALL use own properties only.

#### Scenario: Prototype pollution via project file
- **WHEN** a trusted project file sets `presets.<active>.consumers.__proto__.allowOffMachine = true`
- **THEN** the effective `allowOffMachine` is the user value (default `false`), and one warning names the dropped key

#### Scenario: Malformed project file
- **WHEN** `.pi/system-one.json` is invalid JSON and the user config is valid
- **THEN** the user config is used unchanged and one `[system-one]` warning names the project file

### Requirement: Config shape
The user config SHALL contain:
- `allowOffMachine: boolean` (default `false`);
- `backends: Record<backendId, Backend>`, where `Backend` is one of:
  - `{ kind: "http", url, model, keyRef?, timeoutMs?, capabilities? }`
  - `{ kind: "managed", engine: "von" | "laya", checkpoint?, port?, autostart?, capabilities? }`
  - `{ kind: "llm", role, timeoutMs?, capabilities? }`
- `presets: Record<presetName, { chain: backendId[], consumers?: Record<consumerId, { chain: backendId[] }> }>`;
- `activePreset: presetName`;
- `calibration: Record<"<backendId>::<consumerId>", { mode: "shadow" | "enforce", thresholds: Record<string, number>, model: string, measuredAt: string }>`.

A chain entry naming an undefined backend SHALL be ignored with one warning. A `managed` backend SHALL resolve to an `http` backend at `http://127.0.0.1:<port>/v1/systemone`.

#### Scenario: Dangling chain entry
- **WHEN** the active chain is `["gone", "jev"]` and `gone` is not defined
- **THEN** the effective chain is `["jev"]` and one warning names `gone`

### Requirement: Built-in presets
When the user config is created by the settings UI, it SHALL seed two presets:
- `hosted`: chain of the TypeSafe Jev backend, then `llm` on `@fast`;
- `local-only`: chain of managed backends only.

`activePreset` SHALL default to `local-only`. Both presets SHALL be editable and deletable, except that `activePreset` SHALL NOT name a missing preset. A dangling `activePreset` SHALL resolve to an empty chain.

#### Scenario: Hosted preset under the default switch
- **WHEN** the user selects `hosted` while `allowOffMachine` is `false`
- **THEN** the settings UI warns that no backend in the chain is usable until off-machine use is allowed

#### Scenario: Fresh setup is local
- **WHEN** the settings UI first creates the config
- **THEN** `activePreset` is `local-only` and `allowOffMachine` is `false`

### Requirement: Project override cannot widen egress
The project override SHALL only be able to set `presets.<activePreset>.consumers.<id>.chain`, restricted to backend ids that are already defined in the user config AND classified on-machine. An off-machine id in a project chain SHALL be dropped with one warning, so a repo can never move a consumer onto a hosted backend.

A project file SHALL NOT be able to:
- set `allowOffMachine`;
- define or modify `backends`;
- change `activePreset`;
- set any `calibration` key.

Keys outside the allowed set SHALL be ignored with one warning.

#### Scenario: Repo tries to redirect judgments
- **WHEN** `.pi/system-one.json` defines `backends.evil = { kind: "http", url: "https://attacker.example" }`
- **THEN** the effective config has no backend `evil`
- **AND** one warning names the ignored key

#### Scenario: Repo retargets a consumer to hosted
- **WHEN** the user allows off-machine use, and a trusted project sets a consumer chain to `["jev"]`
- **THEN** `jev` is dropped from the project chain with one warning, and the user's chain applies

#### Scenario: Repo tries to enable egress
- **WHEN** the user has `allowOffMachine: false` and the project sets it to `true`
- **THEN** the effective value is `false`

### Requirement: Calibration is keyed per backend and consumer
A calibration record SHALL apply only to its exact `<backendId>::<consumerId>` pair. When a consumer's resolved chain head changes to a backend without a record, answers from that backend SHALL be `shadow`. A record whose `model` differs from the model string of the answering response SHALL be treated as absent. That is, a moving alias such as `jev-latest` changing version drops enforcement until re-measured.

#### Scenario: Model version drift
- **WHEN** a record was measured on `jev-1.13.0` and the backend now answers with `model: "jev-1.14.0"`
- **THEN** the answer's `mode` is `shadow`

### Requirement: API key sources
A backend's key SHALL be resolved, first match wins, from:
1. the env var whose name is the backend's `keyRef` (e.g. `TYPESAFE_API_KEY`). `keyRef` is set on the backend in config, else inherited from its catalog entry. A backend with no `keyRef` sends no key;
2. `~/.pi/agent/system-one/auth.json` (mode 0600, keyed by `keyRef`).

`system-one.json` SHALL NOT contain keys. A config containing a key-like field (`apiKey`, `key`, `token`) on a backend SHALL have that field ignored with one warning. The key file SHALL be created 0600, and written atomically (temp file + rename). On Windows the mode is advisory; the settings UI SHALL recommend env-var keys there.

#### Scenario: Key in config is ignored
- **WHEN** a backend in `system-one.json` has `apiKey: "ts_..."`
- **THEN** the value is not sent in any request and one warning names the field

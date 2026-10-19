# system-one-settings-ui Specification

## Purpose
TBD - created by archiving change add-system-one-registry. Update Purpose after archive.

## Requirements

### Requirement: Settings section
`packages/system-one-plugin` SHALL contribute a `settings-section` for "Decision models (System 1)" with the following areas:
- the global `allowOffMachine` switch, labelled with its effect;
- the active preset selector;
- the preset's default chain, edited as an ordered list;
- the backend catalog;
- per-consumer overrides;
- key entry.

The section body SHALL NOT render a heading repeating the plugin's display name or id; the host chrome owns identity. The body SHALL open with a short lead paragraph and the config file path (`~/.pi/agent/system-one.json`) as code.

Edits SHALL be staged in a draft registered with the host Save Bar through `useSettingsDraftSource`, the same pattern as the blackhole settings section. The draft SHALL be saved through `PUT /api/system-one/config` with `{ config, baseRevision }`, where `baseRevision` is the revision returned by the last `GET`. A revision is the SHA-256 of the file bytes, or `absent`. The server SHALL re-read the file inside the request. It SHALL answer 409 when the current revision differs, and it SHALL NOT write in that case. On a match it SHALL replace only the UI-managed keys (`allowOffMachine`, `backends`, `presets`, `activePreset`), keeping every other key byte-for-byte. The UI SHALL then report the conflict and offer a reload. Key entry, managed Start/Stop, and calibration saves are not Save Bar sources; each commits on its own action. Every mutating route SHALL be behind the dashboard `networkGuard`. The UI SHALL meet WCAG AA for contrast and SHALL be operable by keyboard.

#### Scenario: Save is atomic
- **WHEN** the user reorders the chain and changes the preset, then saves from the host Save Bar
- **THEN** `system-one.json` is written once, via temp file + rename, with both edits

#### Scenario: Stale draft
- **WHEN** the supervisor persisted a port after the UI loaded the config, and the user then saves
- **THEN** the server answers 409, and the file keeps the persisted port

#### Scenario: Body does not repeat the plugin title
- **WHEN** `/settings/plugins/system-one` renders
- **THEN** the body (testid `system-one-settings`) SHALL contain no heading whose text equals the plugin display name or `system-one`
- **AND** the lead paragraph and the config file path SHALL still be shown

#### Scenario: Immediate actions stay off the Save Bar
- **WHEN** the user saves a key, presses Start or Stop, or saves a calibration
- **THEN** that action SHALL take effect immediately without the host Save Bar becoming dirty

### Requirement: Backend catalog with capability metadata
The plugin SHALL ship a built-in catalog of known models with `maxContextTokens`, `maxOptions`, `languages`, `primitives`, a hosted/local tag, and optional `keyRef` and `priceUsdPerMTok` (Jev: `TYPESAFE_API_KEY`, `0.042`):
- `jev-1.13.0`: 32,000 / 255 / en-first / all / hosted
- `von-1.2`: 8,192 / unknown / en / all / local
- `laya`: 512 / unknown / en / all / local
- `laya-multilingual`: 1,024 / unknown / multi / all / local
- `laya-typed-decisions`: 1,024 / unknown / en / all / local
- `kev`: unknown / unknown / en / all / local

A backend whose `model` or `engine` + `checkpoint` matches a catalog entry SHALL inherit its capabilities unless overridden in config. Each backend row SHALL show an off-machine badge computed by the adapter's classification rule. `GET /api/system-one/config` SHALL return, per backend, the effective capabilities and the `offMachine` classification computed on the server; for an `llm` backend the classification comes from the server's `LlmCaller.isLocal(role)`. The client SHALL NOT classify backends itself.

#### Scenario: Chat role resolving to a cloud model
- **WHEN** backend `fast` is `{ kind: "llm", role: "@fast" }` and `@fast` resolves to a hosted provider
- **THEN** `GET /api/system-one/config` returns `offMachine: true` for `fast`, and the row shows the off-machine badge

#### Scenario: Custom endpoint
- **WHEN** the user adds an `http` backend with an unknown model id
- **THEN** its capabilities show as `unknown` and it is selectable for every consumer

### Requirement: Compatibility filtering per consumer
For each declared consumer, the override picker SHALL:
- mark backends whose known capabilities cannot meet the consumer's declared `requires` (`minContextTokens`, `maxOptions`, `languages`, `primitives`) as incompatible, and exclude them by default;
- mark `offMachine` backends as disabled while `allowOffMachine` is `false`.

The preset selector SHALL warn when the active preset's default chain contains no backend that is usable under the current `allowOffMachine` value.

Incompatible backends SHALL remain selectable only behind an explicit "show incompatible" toggle, with a warning.

When the user switches a consumer from the preset chain to an override, the override SHALL start as the active preset's default chain minus the backends that are incompatible with that consumer.

#### Scenario: Override seeding drops incompatible backends
- **WHEN** the active chain is `["von", "laya"]`, a consumer declares `requires.minContextTokens: 4000`, and `laya` has `maxContextTokens: 1024`
- **THEN** choosing "Override for this consumer" starts the override as `["von"]`

#### Scenario: Many-option consumer
- **WHEN** a consumer declares `requires.maxOptions: 60`
- **THEN** backends with known `maxOptions < 60` are hidden from its picker by default

### Requirement: Consumer list from the self-registration file
The plugin SHALL list consumers from the files in `~/.pi/agent/system-one/consumers/` (see system-one-adapter, "Consumers self-register"), re-reading them on each list request. It SHALL always list its own `system-one:selftest` consumer with bundled fixtures. A consumer whose `fixtures` path is missing or unreadable SHALL show Test as disabled, with the reason.

#### Scenario: Selftest always present
- **WHEN** no other plugin declares a consumer
- **THEN** the consumer list shows `system-one:selftest` with Test enabled

### Requirement: Per-consumer Test (eval)
Test SHALL run the consumer's fixtures against one chosen backend through the adapter, bypassing the chain, and report:
- per-question accuracy;
- AUC for `noul` questions with binary `expected` values;
- latency p50 and p90;
- total input characters and estimated cost (`priceUsdPerMTok` × chars ÷ 4 ÷ 10⁶, when a price is known).

It SHALL NOT run against an `offMachine` backend while `allowOffMachine` is `false`, nor against a `managed` backend whose status is not `ready`; the UI SHALL show the backend as disabled with the reason. It SHALL process at most 500 cases per run and stop on user cancel. A run SHALL be able to save a calibration record `{ mode, thresholds, model, measuredAt }` for that backend and consumer pair via `POST /api/system-one/calibration`. That route SHALL re-read the file inside the request and merge only `calibration["<backendId>::<consumerId>"]`, under the same revision rules. Saving `mode: "enforce"` SHALL require an explicit confirmation naming the backend and the model. The thresholds saved in the record SHALL be the ones the run reports; the UI SHALL show them read-only and SHALL NOT offer editing in this change.

#### Scenario: Stopped managed backend
- **WHEN** managed backend `von` has status `stopped` or `failed`
- **THEN** `von` is disabled in the Test backend picker with the reason "not running", and `POST .../eval` naming `von` is refused with 0 requests sent

#### Scenario: Save enforce
- **WHEN** the user runs Test on `jev` for a consumer and saves with `enforce`
- **THEN** `calibration["jev::<consumer>"]` records the model string returned during the run

### Requirement: Key entry is write-only
The key field SHALL be a hidden input that posts to `POST /api/system-one/keys/:keyRef`. No route SHALL return a key or a key prefix. The UI SHALL show only `set` / `not set` and the source (`env` or `file`). When a key comes from the env, the UI SHALL say so and SHALL NOT offer to overwrite it.

#### Scenario: Config read never leaks the key
- **WHEN** a key is stored and the client calls `GET /api/system-one/config`
- **THEN** the response contains no key material

### Requirement: System-one areas render as shared settings groups with a clear action hierarchy

The areas "Where data may go", "Preset", "Backends" and "Consumers" SHALL render as shared settings groups inside the host card, with no nested elevated cards (no card shadow inside the host card). Key entry SHALL stay inside each backend's item, in the "Backends" group. Each backend and consumer SHALL render as a repeatable item whose status (on/off-machine, managed status, policy, mode) is shown as status pills carrying a word. The "Remove" action on a backend SHALL be styled as a destructive action (danger tone) visually distinct from neutral actions such as Start, Stop and Add backend, and SHALL carry an accessible name naming the backend. Existing testids (`system-one-settings`, `system-one-allow-off-machine`, `preset-{name}`, `delete-preset-{name}`, `backend-{id}`, `managed-status`, `add-backend`, `consumer-{id}`, `run-test-{id}`, `save-calibration-{id}`, `results-{id}`, and the chain-editor ids) SHALL be kept.

#### Scenario: No nested elevated cards
- **WHEN** the populated section renders
- **THEN** the four areas SHALL render as settings groups without their own card shadow

#### Scenario: Remove backend is visibly destructive
- **WHEN** a backend item renders with Start and Remove actions
- **THEN** Remove SHALL use the danger tone and differ in style from Start
- **AND** its accessible name SHALL include the backend id

#### Scenario: Status uses words, not color alone
- **WHEN** a managed backend is stopped
- **THEN** its item SHALL show a pill with the word "Stopped" alongside the on/off-machine pill

### Requirement: System-one errors are plain sentences with details on demand

Load errors, key-save errors and Test failures SHALL be shown as a notice with a plain sentence naming the problem and next step. Raw error codes (e.g. `E_PARSE`, an `ApiError.code`) and literal "error" strings SHALL NOT appear in the visible message; they SHALL be available only through a "Copy details" action that copies them to the clipboard. The load-error notice (testid `system-one-load-error`) SHALL offer "Try again". The on-disk conflict notice (testid `system-one-conflict`) SHALL keep its Reload action (testid `system-one-reload`).

#### Scenario: Damaged config file
- **WHEN** `GET /api/system-one/config` fails with code `E_PARSE`
- **THEN** the notice SHALL read as a sentence such as "Could not read `system-one.json`. The file may be damaged." with "Try again" and "Copy details"
- **AND** the visible text SHALL NOT contain `E_PARSE`

#### Scenario: Key save fails
- **WHEN** saving a key fails with an API error code
- **THEN** the key entry SHALL show a sentence error tied to the field, and the code SHALL only be reachable via "Copy details"

#### Scenario: Test run fails
- **WHEN** a Test run fails
- **THEN** the Test status SHALL show a sentence, not the literal word "error"

### Requirement: Add-backend fields show visible validation messages

When the backend id in the Add backend form is invalid (does not match the allowed id pattern) or already exists, or the URL of an `http` backend is not `http`/`https`, the field SHALL show an error message text tied to the control via `aria-describedby`, in addition to `aria-invalid`, and the submit action SHALL stay disabled until the value is valid.

#### Scenario: Duplicate backend id
- **WHEN** the user types an id that already exists
- **THEN** a message under the id field SHALL say the id is already used
- **AND** the field SHALL be `aria-invalid="true"` and Add backend SHALL be disabled

#### Scenario: Bad URL scheme
- **WHEN** the user enters `ftp://host` as the URL of an http backend
- **THEN** a message under the URL field SHALL say only http and https are allowed

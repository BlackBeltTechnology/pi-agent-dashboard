## ADDED Requirements

### Requirement: Settings section
`packages/system-one-plugin` SHALL contribute a `settings-section` titled "Decision models (System 1)" with the following areas:
- the global `allowOffMachine` switch, labelled with its effect;
- the active preset selector;
- the preset's default chain, edited as an ordered list;
- the backend catalog;
- per-consumer overrides;
- key entry.

Edits SHALL be staged in a draft registered with the host Save Bar through `useSettingsDraftSource`, the same pattern as the blackhole settings section. The draft SHALL be saved through `PUT /api/system-one/config` with `{ config, baseRevision }`, where `baseRevision` is the revision returned by the last `GET`. A revision is the SHA-256 of the file bytes, or `absent`. The server SHALL re-read the file inside the request. It SHALL answer 409 when the current revision differs, and it SHALL NOT write in that case. On a match it SHALL replace only the UI-managed keys (`allowOffMachine`, `backends`, `presets`, `activePreset`), keeping every other key byte-for-byte. The UI SHALL then report the conflict and offer a reload. Key entry is not a Save Bar source; it commits on its own action. Every mutating route SHALL be behind the dashboard `networkGuard`. The UI SHALL meet WCAG AA for contrast and SHALL be operable by keyboard.

#### Scenario: Save is atomic
- **WHEN** the user reorders the chain and changes the preset, then saves from the host Save Bar
- **THEN** `system-one.json` is written once, via temp file + rename, with both edits

#### Scenario: Stale draft
- **WHEN** the supervisor persisted a port after the UI loaded the config, and the user then saves
- **THEN** the server answers 409, and the file keeps the persisted port

### Requirement: Backend catalog with capability metadata
The plugin SHALL ship a built-in catalog of known models with `maxContextTokens`, `maxOptions`, `languages`, `primitives`, a hosted/local tag, and optional `keyRef` and `priceUsdPerMTok` (Jev: `TYPESAFE_API_KEY`, `0.042`):
- `jev-1.13.0`: 32,000 / 255 / en-first / all / hosted
- `von-1.2`: 8,192 / unknown / en / all / local
- `laya`: 512 / unknown / en / all / local
- `laya-multilingual`: 1,024 / unknown / multi / all / local
- `laya-typed-decisions`: 1,024 / unknown / en / all / local
- `kev`: unknown / unknown / en / all / local

A backend whose `model` or `engine` + `checkpoint` matches a catalog entry SHALL inherit its capabilities unless overridden in config. Each backend row SHALL show an off-machine badge computed by the adapter's classification rule.

#### Scenario: Custom endpoint
- **WHEN** the user adds an `http` backend with an unknown model id
- **THEN** its capabilities show as `unknown` and it is selectable for every consumer

### Requirement: Compatibility filtering per consumer
For each declared consumer, the override picker SHALL:
- mark backends whose known capabilities cannot meet the consumer's declared `requires` (`minContextTokens`, `maxOptions`, `languages`, `primitives`) as incompatible, and exclude them by default;
- mark `offMachine` backends as disabled while `allowOffMachine` is `false`.

The preset selector SHALL warn when the active preset's default chain contains no backend that is usable under the current `allowOffMachine` value.

Incompatible backends SHALL remain selectable only behind an explicit "show incompatible" toggle, with a warning.

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

It SHALL NOT run against an `offMachine` backend while `allowOffMachine` is `false`. It SHALL process at most 500 cases per run and stop on user cancel. A run SHALL be able to save a calibration record `{ mode, thresholds, model, measuredAt }` for that backend and consumer pair via `POST /api/system-one/calibration`. That route SHALL re-read the file inside the request and merge only `calibration["<backendId>::<consumerId>"]`, under the same revision rules. Saving `mode: "enforce"` SHALL require an explicit confirmation naming the backend and the model.

#### Scenario: Save enforce
- **WHEN** the user runs Test on `jev` for a consumer and saves with `enforce`
- **THEN** `calibration["jev::<consumer>"]` records the model string returned during the run

### Requirement: Key entry is write-only
The key field SHALL be a hidden input that posts to `POST /api/system-one/keys/:keyRef`. No route SHALL return a key or a key prefix. The UI SHALL show only `set` / `not set` and the source (`env` or `file`). When a key comes from the env, the UI SHALL say so and SHALL NOT offer to overwrite it.

#### Scenario: Config read never leaks the key
- **WHEN** a key is stored and the client calls `GET /api/system-one/config`
- **THEN** the response contains no key material

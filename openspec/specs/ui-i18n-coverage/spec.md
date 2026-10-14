# ui-i18n-coverage Specification

## Purpose
TBD - created by archiving change make-all-ui-text-i18n. Update Purpose after archive.

## Requirements

### Requirement: Every user-facing string resolves through the catalog

All text a user can see in the dashboard UI — client components, plugin surfaces, and server/extension-origin messages rendered in the client — SHALL resolve through the i18n catalog via `t()` (or the plugin/slot-context `t`). No hardcoded English SHALL be rendered directly.

#### Scenario: Client string is translated
- **WHEN** the active language is `zh-CN` and a client component renders a labelled control
- **THEN** the label resolves from `dictionaries["zh-CN"]` via a structured key, not a hardcoded literal

#### Scenario: Missing key falls back without breaking
- **WHEN** `t(key)` is called with a key absent from the active language's dictionary
- **THEN** the call-site `fallback` (English) is shown, and if no fallback the key itself is shown — never an empty string or a thrown error

#### Scenario: Lint forbids new hardcoded strings
- **WHEN** a source file adds JSX text or a `placeholder`/`aria-label`/`title`/`alt` attribute or a user-facing `throw`/`message:` that is not wrapped in a translator
- **THEN** the i18n lint flags it

### Requirement: Structured key namespaces with no `auto.*` keys

The catalog SHALL use domain-rooted structured keys (`common.*`, `session.*`, `git.*`, `openspec.*`, `gateway.*`, `err.*`, `plugin.<id>.*`, …). Auto-generated `auto.*` keys and flat legacy keys SHALL be migrated to structured keys and removed.

#### Scenario: Legacy key migrated
- **WHEN** the migration completes
- **THEN** no `auto.*` key remains in any dictionary and every former `auto.*` value is reachable under its structured key

#### Scenario: Alias resolves during transition
- **WHEN** a `LEGACY_ALIASES` entry maps an old key to a structured key mid-migration
- **THEN** `t(oldKey)` resolves to the structured translation until the alias is removed

### Requirement: Plugins register their own translation catalogs

A dashboard plugin SHALL be able to supply its own translation catalog without importing the client i18n module. The runtime SHALL merge each plugin catalog into the active dictionaries under a `plugin.<id>.*` namespace and expose `t` and the current `language` to the plugin via its context.

#### Scenario: Plugin catalog merged and namespaced
- **WHEN** a plugin registers with `i18n.catalog` and the runtime merges it
- **THEN** the plugin's keys are reachable as `plugin.<id>.<key>` and cannot collide with another plugin's keys or the core catalog

#### Scenario: Plugin renders via context translator
- **WHEN** plugin code calls the context `t("launch.title", vars)`
- **THEN** it resolves `plugin.<id>.launch.title` in the active language with interpolation

#### Scenario: Plugin without catalog degrades gracefully
- **WHEN** a plugin supplies no catalog for the active language
- **THEN** its `t` calls fall back to the call-site English source, and no error is thrown

#### Scenario: Language switch re-resolves plugin strings
- **WHEN** the user switches language after plugins have registered
- **THEN** already-rendered plugin surfaces resolve their strings in the newly selected language

### Requirement: Server and extension emit translation codes, not display English

User-facing errors, results, and status messages originating in the server, extension, or shared protocol SHALL carry a stable machine `code` (and optional `vars`); the client SHALL map the code to an `err.<domain>.<code>` key and render it via `t()`. English `message` MAY be retained as a fallback only.

#### Scenario: Coded server error is translated client-side
- **WHEN** the server returns `{ code: "git.not_a_repo", message: "not a git repository" }` and the active language is `hu`
- **THEN** the client renders the Hungarian text for `err.git.not_a_repo`, not the English `message`

#### Scenario: Interpolated vars are applied
- **WHEN** the server returns `{ code, vars: { path } }`
- **THEN** the client interpolates `{path}` into the resolved translation

#### Scenario: Unknown code degrades to server message
- **WHEN** a server `code` has no client `err.*` mapping
- **THEN** the client shows the server-provided English `message` and never displays the bare code

### Requirement: English, Simplified Chinese, and Hungarian are complete

The dashboard SHALL offer `en`, `zh-CN`, and `hu` as selectable languages. Every catalog key (core + `plugin.<id>.*` + `err.*`) SHALL have a `zh-CN` and `hu` translation.

#### Scenario: Hungarian is selectable and applied
- **WHEN** a user selects `Magyar` (or the browser reports `hu-HU`)
- **THEN** the UI renders in Hungarian across client, plugin, and server-origin surfaces

#### Scenario: Catalog parity is enforced
- **WHEN** the parity check runs
- **THEN** it reports zero keys missing from `zh-CN` or `hu` relative to the source key set, failing CI otherwise

### Requirement: The i18n checks are repaired, then enforced on the ship path

`i18n:lint` and `i18n:parity` SHALL be invoked by `ship-it` step 4.4, so that a
hardcoded user-facing string or a catalog parity gap fails the ship rather than
depending on someone remembering to run the script. Both SHALL be verified
working against the current tree before being wired.

#### Scenario: Parity script repaired before wiring

- **WHEN** `i18n-parity.mjs` is wired
- **THEN** its stale reference to the pre-reorganisation client path has been repaired
- **AND** the script exits 0 on the current tree

#### Scenario: Lint script gates only with --strict

- **WHEN** `i18n-lint.mjs` is wired
- **THEN** it is invoked with `--strict`
- **AND** a hardcoded user-facing string causes a non-zero exit

#### Scenario: Hardcoded string fails the ship

- **WHEN** a change introduces a user-facing string that does not resolve through the catalog
- **THEN** `ship-it` step 4.4 exits non-zero
- **AND** the offending file and string are named

#### Scenario: Catalog parity gap fails the ship

- **WHEN** a key exists in one locale catalog and is missing from another
- **THEN** `ship-it` step 4.4 exits non-zero
- **AND** the missing keys and locales are named

#### Scenario: Scripts stay independently runnable

- **WHEN** `npm run i18n:lint` or `npm run i18n:parity` is run directly
- **THEN** it behaves as it does when `ship-it` invokes it

### Requirement: Non-English catalogs load on demand
The `zh-CN` and `hu` core catalogs SHALL be loaded on demand, one separately loadable module per language; English needs no catalog load. The catalog for the initial language SHALL be loaded before the first render, so a non-English user never sees an English frame at startup. Switching language at runtime SHALL load the target catalog (at most once per page) and apply it only after it has loaded. Plugin catalogs registered before a language's core catalog loads SHALL be merged into it when it loads. `translationsOf(key)` SHALL return values from every shipped language, whether or not that language's catalog is loaded.

#### Scenario: Non-English initial language has no English flash
- **GIVEN** the stored or detected language is `hu`
- **WHEN** the dashboard boots
- **THEN** the first rendered frame shows Hungarian text

#### Scenario: English user loads no catalog
- **GIVEN** the language is `en`
- **WHEN** the dashboard boots and is used without changing language
- **THEN** neither the `zh-CN` nor the `hu` catalog chunk is requested

#### Scenario: Runtime switch loads, then applies
- **WHEN** the user switches from `en` to `zh-CN`
- **THEN** the `zh-CN` catalog is fetched once
- **AND** the UI re-renders in Simplified Chinese after it loads, without showing untranslated keys

#### Scenario: Plugin catalog merged into a late-loaded language
- **GIVEN** a plugin catalog with `hu` entries was registered while the `hu` core catalog was not loaded
- **WHEN** the `hu` core catalog loads
- **THEN** `plugin.<id>.*` keys resolve to their Hungarian values

#### Scenario: Catalog load failure falls back to English
- **WHEN** the catalog request for the selected language fails
- **THEN** the UI renders the English fallback text and does not throw

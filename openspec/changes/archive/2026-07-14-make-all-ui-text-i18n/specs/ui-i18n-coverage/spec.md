## ADDED Requirements

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

## ADDED Requirements

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

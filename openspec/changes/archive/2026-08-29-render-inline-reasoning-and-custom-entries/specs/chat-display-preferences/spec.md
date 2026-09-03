## ADDED Requirements

### Requirement: reasoningInlineFlow and customEntryFallback display preferences
`DisplayPrefs` SHALL include `reasoningInlineFlow: boolean` and `customEntryFallback: boolean`. Both SHALL default to `reasoningInlineFlow: false` and `customEntryFallback: true` in every preset (`simple`, `standard`, `everything`) and in the legacy-backfill path, so out-of-the-box behavior is unchanged. The legacy defaults SHALL be injected at every `DisplayPrefs` construction site for persisted prefs — the server's per-field backfill (`backfillDisplayPrefs`) and the `setDisplayPrefs` base/merged literals — not only in `mergeDisplayPrefs`, because a legacy file without the fields must resolve to the defaults (a missing `customEntryFallback` backfill would leave the gate `undefined` and hide custom rows for existing users). `mergeDisplayPrefs` SHALL additionally resolve both as plain top-level arms (override value when present, else global). Existing persisted preferences files and per-session overrides without the new fields SHALL load unchanged and resolve to the defaults.

#### Scenario: Defaults preserve current behavior
- **WHEN** a preferences file predates the new fields (or a fresh preset is applied)
- **THEN** the effective prefs SHALL resolve `reasoningInlineFlow` to `false` and `customEntryFallback` to `true`
- **AND** a legacy global file without the fields SHALL resolve `customEntryFallback` to `true` via the server backfill (not stay `undefined`)

#### Scenario: Per-session override wins
- **WHEN** a per-session override sets `reasoningInlineFlow` or `customEntryFallback`
- **THEN** `mergeDisplayPrefs` SHALL return the override value for that field and the global value for every other field

#### Scenario: PATCH round-trips the new fields
- **WHEN** a client PATCHes `/api/preferences/display` with the new fields (globally or as a per-session override)
- **THEN** the fields SHALL persist, broadcast via `display_prefs_updated`, and be included in the connect snapshot

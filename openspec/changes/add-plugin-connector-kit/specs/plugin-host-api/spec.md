## MODIFIED Requirements

### Requirement: Host API surface snapshot gate

`packages/dashboard-plugin-runtime/host-api-surface.json` SHALL record the `public.ts` and `./sdk` names, the `./connector` export names with the printed type of each export, `UI_PRIMITIVE_KEYS` with each `UiPrimitiveMap` props type, slot-props and claim field shapes, `HOST_FX_CLASSES`, the public CSS custom-property subset (see "Host CSS contract"), import-map specifiers, and the version. An `npm test` check SHALL fail when a recorded entry disappears without a major bump, or an entry is added or a shape changes without at least a minor bump.

#### Scenario: Removing a public export requires a major bump
- **WHEN** a change deletes `useLanguage` from `public.ts` without bumping the major version
- **THEN** the surface check SHALL fail naming `useLanguage`

#### Scenario: Adding an export requires a minor bump
- **WHEN** a change adds a `public.ts` export and leaves the version unchanged
- **THEN** the surface check SHALL fail and ask for a minor bump and a refreshed snapshot

#### Scenario: Primitive props change requires a bump
- **WHEN** a change alters the props type of `UiPrimitiveMap["ui:confirm-dialog"]` and leaves the version unchanged
- **THEN** the surface check SHALL fail naming `ui:confirm-dialog`

#### Scenario: Renaming a theme variable requires a major bump
- **WHEN** a change renames `--bg-surface` in the host stylesheet without a major bump
- **THEN** the surface check SHALL fail naming `--bg-surface`

#### Scenario: Connector signature change requires a bump
- **WHEN** a change alters the parameter type of `registerConnectorServer` exported from `./connector` and leaves the version unchanged
- **THEN** the surface check SHALL fail naming `registerConnectorServer`

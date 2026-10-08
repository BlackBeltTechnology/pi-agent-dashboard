## MODIFIED Requirements

### Requirement: `ui:model-selector` primitive key and contract

`packages/shared/src/dashboard-plugin/ui-primitives.ts` SHALL include `modelSelector: "ui:model-selector"` in `UI_PRIMITIVE_KEYS` and a matching entry in `UiPrimitiveMap`. The primitive SHALL expose a model picker with built-in provider filter, typeahead, keyboard navigation, and pending-state with timeout — the existing capability of `packages/client/src/components/ModelSelector.tsx`.

The contract:

- `"ui:model-selector"`: `ComponentType<{ current?: string; models?: ModelInfo[]; onSelect: (modelLabel: string) => void; placeholder?: string; allowRoles?: boolean }>`

Where:

- `current` is a string in `"<provider>/<id>"` form, a role ref `"@<role>"` (only meaningful when `allowRoles` is set), or `undefined` for "no current".
- `models` is the list of available models as `ModelInfo[]` from `packages/shared/src/types.ts`, or `undefined` when models have not yet loaded (in which case the primitive renders the current label as non-interactive text).
- `onSelect(modelLabel)` is called with the full `"<provider>/<id>"` string of the chosen model, or with `"@<role>"` when a role is chosen on the Role tab.
- `placeholder` is optional trigger text shown when `current` is absent; when omitted the primitive's default placeholder is used.
- `allowRoles` is optional; when `true` and the roles plugin is installed the primitive offers a Role tab for *selecting* a role. When absent the primitive SHALL behave exactly as the four-prop contract.

Favorites state, model-list refresh, and the role list SHALL NOT appear in this contract; they are supplied by the shell (favorites/refresh at registration time — see "A primitive registration MAY be a shell-bound wrapper"; the role list fetched by the shell from the roles read surface), because they are shell-owned.

The contract SHALL NOT expose role *management* (assigning models to roles, presets) — that remains owned by the roles plugin's settings section. Role *selection* via `allowRoles` is the only role-related surface of the primitive.

#### Scenario: Key is part of `UI_PRIMITIVE_KEYS`

- **WHEN** importing `UI_PRIMITIVE_KEYS` from the shared package
- **THEN** the object SHALL contain `modelSelector` with value `"ui:model-selector"`
- **AND** `UiPrimitiveKey` SHALL include the literal `"ui:model-selector"` in its union

#### Scenario: Contract is typed in `UiPrimitiveMap`

- **WHEN** TypeScript resolves `UiPrimitiveMap["ui:model-selector"]`
- **THEN** the resolved type SHALL be `ComponentType<{ current?: string; models?: ModelInfo[]; onSelect: (modelLabel: string) => void; placeholder?: string; allowRoles?: boolean }>`

#### Scenario: Existing three-prop call sites still compile

- **WHEN** an existing plugin renders the primitive passing only `current`, `models`, and `onSelect`
- **THEN** the render SHALL type-check unchanged

#### Scenario: Plugin can consume the primitive without importing client internals

- **WHEN** a plugin module imports `useUiPrimitive` from `@blackbelt-technology/dashboard-plugin-runtime` and calls `useUiPrimitive("ui:model-selector")`
- **THEN** the call SHALL type-check
- **AND** the returned value at runtime SHALL be the registered `ModelSelector` impl
- **AND** the plugin's package.json SHALL NOT need to declare `@blackbelt-technology/pi-dashboard-web` as a dependency to render a model selector

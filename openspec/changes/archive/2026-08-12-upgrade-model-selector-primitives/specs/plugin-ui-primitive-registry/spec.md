## ADDED Requirements

### Requirement: `ui:thinking-level-selector` primitive key and contract

`packages/shared/src/dashboard-plugin/ui-primitives.ts` SHALL include `thinkingLevelSelector: "ui:thinking-level-selector"` in `UI_PRIMITIVE_KEYS` and a matching entry in `UiPrimitiveMap`. The primitive SHALL expose a thinking-level picker with the same per-model level filtering the dashboard shell applies to its own composer.

The contract:

- `"ui:thinking-level-selector"`: `ComponentType<{ current?: string; onSelect: (level: string) => void; supportedLevels?: string[] }>`

Where:

- `current` is the currently-selected level, or `undefined` (rendered as the off/default level).
- `onSelect(level)` is called with the chosen level string.
- `supportedLevels` is the set of levels the target model supports. When provided, only those levels SHALL render, in the shell's canonical order. When `undefined` or empty, the shell's fallback level set SHALL render.

Adding this key SHALL be non-breaking: existing plugins that never look it up are unaffected.

#### Scenario: Key is part of `UI_PRIMITIVE_KEYS`

- **WHEN** importing `UI_PRIMITIVE_KEYS` from the shared package
- **THEN** the object SHALL contain `thinkingLevelSelector` with value `"ui:thinking-level-selector"`
- **AND** `UiPrimitiveKey` SHALL include the literal `"ui:thinking-level-selector"` in its union

#### Scenario: Contract is typed in `UiPrimitiveMap`

- **WHEN** TypeScript resolves `UiPrimitiveMap["ui:thinking-level-selector"]`
- **THEN** the resolved type SHALL be `ComponentType<{ current?: string; onSelect: (level: string) => void; supportedLevels?: string[] }>`

#### Scenario: Plugin consumes the primitive without importing client internals

- **WHEN** a plugin calls `useUiPrimitive("ui:thinking-level-selector")`
- **THEN** the call SHALL type-check
- **AND** the returned value at runtime SHALL be the shell's registered thinking-level picker
- **AND** the plugin's package.json SHALL NOT need to declare `@blackbelt-technology/pi-dashboard-web` as a dependency

### Requirement: Dashboard registers `ui:thinking-level-selector` at startup

`packages/client/src/main.tsx` SHALL register the shell's own thinking-level selector component under the key `"ui:thinking-level-selector"` before mounting `<App>`.

The registration SHALL reuse the shell's component rather than a plugin-local reimplementation, so that per-model level filtering — including the opt-in top level that renders only when a model explicitly declares support, and the fallback set used when `supportedLevels` is absent — stays identical between the shell composer and every plugin surface without a second code path to maintain.

#### Scenario: Registered impl matches the shell composer

- **WHEN** the primitive is rendered with the same `current` and `supportedLevels` the shell composer passes for a given model
- **THEN** it SHALL offer exactly the same set of selectable levels in the same order as the shell composer

#### Scenario: Level set narrows with the model

- **WHEN** the primitive is rendered with a `supportedLevels` list that omits a level
- **THEN** that level SHALL NOT be offered for selection

#### Scenario: Absent `supportedLevels` falls back

- **WHEN** the primitive is rendered without `supportedLevels`
- **THEN** it SHALL offer the shell's fallback level set

### Requirement: A primitive registration MAY be a shell-bound wrapper

A primitive registration MAY be a wrapper component that supplies session-scoped or shell-owned props which are deliberately absent from the primitive's public contract, provided the wrapper adds no required props to that contract and does not alter event timing or the semantics of the contract's own props.

This lets the shell keep a plugin-facing contract minimal while ensuring plugin surfaces inherit shell-owned behavior (favorites, list refresh) automatically, instead of each plugin drilling session state it has no access to.

The public contract SHALL remain the sole compile-time surface: a plugin SHALL NOT be required to pass, or be able to observe, the injected props.

#### Scenario: Plugin passes only contract props

- **WHEN** a plugin renders a wrapped primitive passing only the props declared in `UiPrimitiveMap`
- **THEN** the render SHALL type-check
- **AND** the rendered control SHALL additionally exhibit the shell-injected behavior

#### Scenario: Wrapper does not widen the required surface

- **WHEN** TypeScript resolves the wrapped primitive's contract
- **THEN** no shell-injected prop SHALL appear as a required prop

## MODIFIED Requirements

### Requirement: `ui:model-selector` primitive key and contract

`packages/shared/src/dashboard-plugin/ui-primitives.ts` SHALL include `modelSelector: "ui:model-selector"` in `UI_PRIMITIVE_KEYS` and a matching entry in `UiPrimitiveMap`. The primitive SHALL expose a model picker with built-in provider filter, typeahead, keyboard navigation, and pending-state with timeout — the existing capability of `packages/client/src/components/ModelSelector.tsx`.

The contract:

- `"ui:model-selector"`: `ComponentType<{ current?: string; models?: ModelInfo[]; onSelect: (modelLabel: string) => void; placeholder?: string }>`

Where:

- `current` is a string in `"<provider>/<id>"` form, or `undefined` for "no current".
- `models` is the list of available models as `ModelInfo[]` from `packages/shared/src/types.ts`, or `undefined` when models have not yet loaded (in which case the primitive renders the current label as non-interactive text).
- `onSelect(modelLabel)` is called with the full `"<provider>/<id>"` string of the chosen model.
- `placeholder` is optional trigger text shown when `current` is absent; when omitted the primitive's default placeholder is used.

Favorites state and model-list refresh SHALL NOT appear in this contract; they are supplied by the shell at registration time (see "A primitive registration MAY be a shell-bound wrapper"), because they are session-scoped and shell-owned.

The contract SHALL NOT expose role/preset props — role management is a separate concern owned by `BuiltInRolesSettings` (in builtins-plugin) and is layered on top of this primitive, not inside it.

#### Scenario: Key is part of `UI_PRIMITIVE_KEYS`

- **WHEN** importing `UI_PRIMITIVE_KEYS` from the shared package
- **THEN** the object SHALL contain `modelSelector` with value `"ui:model-selector"`
- **AND** `UiPrimitiveKey` SHALL include the literal `"ui:model-selector"` in its union

#### Scenario: Contract is typed in `UiPrimitiveMap`

- **WHEN** TypeScript resolves `UiPrimitiveMap["ui:model-selector"]`
- **THEN** the resolved type SHALL be `ComponentType<{ current?: string; models?: ModelInfo[]; onSelect: (modelLabel: string) => void; placeholder?: string }>`

#### Scenario: Existing three-prop call sites still compile

- **WHEN** an existing plugin renders the primitive passing only `current`, `models`, and `onSelect`
- **THEN** the render SHALL type-check unchanged

#### Scenario: Plugin can consume the primitive without importing client internals

- **WHEN** a plugin module imports `useUiPrimitive` from `@blackbelt-technology/dashboard-plugin-runtime` and calls `useUiPrimitive("ui:model-selector")`
- **THEN** the call SHALL type-check
- **AND** the returned value at runtime SHALL be the registered `ModelSelector` impl
- **AND** the plugin's package.json SHALL NOT need to declare `@blackbelt-technology/pi-dashboard-web` as a dependency to render a model selector

### Requirement: Dashboard registers `ui:model-selector` at startup

`packages/client/src/main.tsx` SHALL register a model picker under the key `"ui:model-selector"` before mounting `<App>`, alongside the other primitive registrations.

The registration SHALL be a shell-bound wrapper around the existing `ModelSelector` component. The wrapper SHALL forward every prop of the public contract unchanged, and SHALL additionally supply the shell's favorite-model list, its favorite-toggle handler, and its model-list refresh handler. The wrapper SHALL NOT drop, rename, or re-time any prop of the public contract.

Consequently a plugin surface rendering the primitive SHALL offer favorite stars and SHALL refresh its model list on dropdown open, with no plugin-side wiring.

#### Scenario: `useUiPrimitive("ui:model-selector")` returns the impl

- **WHEN** the dashboard boots and `<App>` mounts
- **THEN** calling `useUiPrimitive("ui:model-selector")` from any descendant SHALL return the registered impl

#### Scenario: Plugin surface shows favorites without wiring them

- **WHEN** a plugin renders the primitive with only contract props and the user has favorited a model
- **THEN** the dropdown SHALL show that model's favorite state
- **AND** activating its star SHALL toggle the shell-owned favorite

#### Scenario: Plugin surface refreshes on open

- **WHEN** a plugin renders the primitive and the user opens the dropdown
- **THEN** the shell's model-list refresh SHALL be requested
- **AND** an updated list SHALL replace the displayed models when it arrives

#### Scenario: IntentRenderer can resolve a server-emitted model-selector intent

- **WHEN** a plugin's server entry emits `{ primitive: "ui:model-selector", props: { current, models }, actions: { onSelect: { action: "...", payload: {} } } }`
- **THEN** `IntentRenderer` SHALL resolve the primitive via `useUiPrimitiveOrNull` and render the registered impl
- **AND** the impl's `onSelect` SHALL be wired to `send("...", { ...payload, modelLabel })` — using the wireActions descriptor pathway

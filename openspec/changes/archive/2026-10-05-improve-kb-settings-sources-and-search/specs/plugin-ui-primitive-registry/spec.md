## ADDED Requirements

### Requirement: Path picker primitive

`UI_PRIMITIVE_KEYS` SHALL include `pathPicker: "ui:path-picker"`. `UiPrimitiveMap` SHALL map it to a component type with props `{ open: boolean; initialPath?: string; title?: string; onSelect: (absPath: string) => void; onCancel: () => void }`. The dashboard SHALL register an implementation that renders the host's single-select directory picker inside a modal dialog.

#### Scenario: Registered at startup

- **WHEN** the dashboard boots
- **THEN** `useUiPrimitive(UI_PRIMITIVE_KEYS.pathPicker)` returns the registered component

#### Scenario: Selection and cancel

- **WHEN** the picker is open and the user confirms a directory
- **THEN** `onSelect` is called once with that directory's absolute path
- **AND** when the user cancels or presses Escape, `onCancel` is called and `onSelect` is not

#### Scenario: Non-directory is not selectable

- **WHEN** the confirmed path is not an existing directory, for example a file or a nonexistent path
- **THEN** `onSelect` is not called and the picker shows an inline error

#### Scenario: Plugin soft lookup on older hosts

- **WHEN** a plugin looks the key up with `useUiPrimitiveOrNull` on a host that has not registered it
- **THEN** the lookup returns `null` without throwing

## MODIFIED Requirements

### Requirement: The primitive registry SHALL be consumed by the shell's IntentRenderer, not by plugin code

The primitive registry's mechanism — `createUiPrimitiveRegistry`, `registerUiPrimitive`, `UiPrimitiveProvider`, `useUiPrimitive`, `useUiPrimitiveOrNull` — SHALL survive unchanged. The currently-registered primitives SHALL stay registered. Adding new primitives still requires three steps: extend `UI_PRIMITIVE_KEYS`, extend `UiPrimitiveMap`, register an impl in `main.tsx`.

What changes: the expected caller of `useUiPrimitive(...)` SHALL move from plugin React components to the shell's `IntentRenderer`. Plugins SHALL NOT directly call `useUiPrimitive` from their client-side code as a renderer of their own state. The shell, on each connected client, SHALL call `useUiPrimitive(intent.primitive)` inside `IntentRenderer` to resolve a primitive name from an incoming intent to a `ComponentType` for rendering.

Exception — transient input primitives: a plugin MAY look up an input primitive directly with `useUiPrimitiveOrNull`, provided the primitive is a modal picker or selector that holds no shared state and whose only output is a callback value consumed by that plugin's local form state (for example `ui:path-picker`). The plugin SHALL handle a `null` result by degrading gracefully. It SHALL NOT use the strict hook for such primitives.

This SUPERSEDES the usage pattern established by the archived change `add-plugin-ui-primitive-registry` (2026-05-11), where plugins like flows-plugin called `useUiPrimitive` from inside their React components. That pattern, while functional, runs plugin React code in every connected client independently — incompatible with multi-client state coherence. The new pattern keeps the registry's mechanism and moves the call site to the shell.

#### Scenario: Plugin's intent uses a registered primitive name

- **GIVEN** the dashboard has registered `UI_PRIMITIVE_KEYS.agentCard` → `AgentCardShell` at startup
- **WHEN** a plugin broadcasts an intent `{primitive:"ui:agent-card", props:{name:"Explore", status:"running"}}`
- **THEN** the shell's IntentRenderer SHALL resolve "ui:agent-card" via `useUiPrimitive(UI_PRIMITIVE_KEYS.agentCard)`
- **AND** render `<AgentCardShell name="Explore" status="running" />` in the target slot

#### Scenario: Plugin emits intent referencing an unregistered primitive name

- **WHEN** a plugin broadcasts `{primitive:"my-custom-thing", props:{...}}` and the primitive is not registered
- **THEN** the IntentRenderer SHALL use `useUiPrimitiveOrNull` and receive `null`
- **AND** render an inline error placeholder identifying the missing primitive name and the broadcasting pluginId
- **AND** sibling intent contributions continue to render normally

#### Scenario: Plugin uses a transient input primitive directly

- **WHEN** a plugin settings form needs a directory and calls `useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.pathPicker)`
- **THEN** a non-null result is rendered locally in that client and its `onSelect` value updates only that plugin's local form state
- **AND** a `null` result hides the picker affordance without throwing

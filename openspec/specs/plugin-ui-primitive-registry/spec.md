# plugin-ui-primitive-registry Specification

## Purpose

This capability defines a **typed, runtime-resolved registry of UI primitive components and helpers** that the dashboard provides to plugins. Plugins look up shared UI building blocks (agent cards, markdown rendering, modal dialogs, format helpers, etc.) by stable string keys via React context, instead of importing the symbols directly from `@blackbelt-technology/pi-dashboard-client-utils`.

The registry decouples plugin tarballs from the dashboard's primitive implementations: plugins ship without heavy transitive deps (markdown stack, mdi icons, mermaid, etc.) and the dashboard remains free to swap primitive implementations without rebuilding plugins.

The motivating design notes live in `openspec/changes/add-plugin-ui-primitive-registry/design.md`.
## Requirements
### Requirement: Frozen primitive key set

The repository SHALL define a frozen set of stable string keys identifying UI primitives the dashboard provides to plugins. The keys SHALL live in `packages/shared/src/dashboard-plugin/ui-primitives.ts` as a `UI_PRIMITIVE_KEYS` const object with `as const` assertion. The initial set SHALL include at minimum:

- `"ui:agent-card"` — agent-shaped card container
- `"ui:markdown-content"` — markdown rendering with code, math, mermaid, tables, lightbox
- `"ui:confirm-dialog"` — modal yes/no confirmation
- `"ui:dialog-portal"` — base modal portal with body-scroll lock
- `"ui:searchable-select-dialog"` — typeahead-filtered selection dialog
- `"ui:zoom-controls"` — zoom in/out/reset button group
- `"ui:format-tokens"` — number-to-human-readable token count
- `"ui:format-duration"` — milliseconds-to-human-readable duration

Adding a new key SHALL be a non-breaking change. Renaming or removing a key SHALL be a breaking change requiring a deprecation cycle (register both old and new keys for at least one minor release with a warning).

#### Scenario: UI_PRIMITIVE_KEYS exists and is frozen

- **WHEN** importing `UI_PRIMITIVE_KEYS` from `@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives`
- **THEN** the import SHALL resolve
- **AND** the imported value SHALL be a const-asserted object with at least the eight keys listed above
- **AND** TypeScript SHALL infer literal-string types for each key value (not generic `string`)

#### Scenario: TypeScript catches misuse of unknown keys

- **WHEN** plugin code calls `useUiPrimitive("ui:nonexistent-thing")`
- **THEN** TypeScript SHALL fail compilation with a type error referencing the `UiPrimitiveKey` union

### Requirement: Typed primitive contract map

`packages/shared/src/dashboard-plugin/ui-primitives.ts` SHALL export a `UiPrimitiveMap` interface mapping each key in `UI_PRIMITIVE_KEYS` to its public contract type. The contract for each primitive SHALL be either a `React.ComponentType<P>` (component primitives) or a function signature (helper primitives).

Contracts:

- `"ui:agent-card"`: `ComponentType<{ name: string; status: string; headerRight?: ReactNode; stats?: ReactNode; onClick?: () => void; selected?: boolean; children?: ReactNode }>`
- `"ui:markdown-content"`: `ComponentType<{ content: string }>`
- `"ui:confirm-dialog"`: `ComponentType<{ message: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void }>`
- `"ui:dialog-portal"`: `ComponentType<{ children: ReactNode }>`
- `"ui:searchable-select-dialog"`: `ComponentType<{ title: string; options: SelectOption[]; onSelect: (value: string) => void; onCancel: () => void; placeholder?: string; emptyMessage?: string }>`
- `"ui:zoom-controls"`: `ComponentType<{ onZoomIn: () => void; onZoomOut: () => void; onReset: () => void; scale: number }>`
- `"ui:format-tokens"`: `(n: number) => string`
- `"ui:format-duration"`: `(ms: number) => string`

The contract SHALL form the public API of each primitive. Adding optional props is non-breaking. Renaming or removing required props is breaking.

#### Scenario: Type lookup returns the contract type

- **WHEN** plugin code declares `const renderMd: UiPrimitiveMap["ui:markdown-content"] = …`
- **THEN** TypeScript SHALL type-check the value as `ComponentType<{ content: string }>`

#### Scenario: Misregistration fails build

- **WHEN** dashboard code calls `registerUiPrimitive(reg, "ui:markdown-content", (s: number) => s)` (wrong shape)
- **THEN** TypeScript SHALL fail compilation referencing the contract mismatch

### Requirement: Registry creation and registration

`packages/dashboard-plugin-runtime/src/ui-primitive-registry.ts` SHALL export:

- `createUiPrimitiveRegistry(): UiPrimitiveRegistry` — constructs an empty registry.
- `registerUiPrimitive<K extends UiPrimitiveKey>(reg: UiPrimitiveRegistry, key: K, impl: UiPrimitiveMap[K]): void` — registers the impl under the key. Throws if `key` is already registered.

The registry SHALL be a private internal data structure (not a public Map exposed directly). Consumers SHALL access it only through the provider context and the lookup hooks.

#### Scenario: Empty registry creation

- **WHEN** calling `createUiPrimitiveRegistry()`
- **THEN** the call SHALL return a `UiPrimitiveRegistry` instance
- **AND** subsequent `useUiPrimitiveOrNull(key)` calls SHALL return `null` for every key

#### Scenario: Successful registration

- **WHEN** calling `registerUiPrimitive(reg, "ui:format-tokens", (n) => String(n))`
- **THEN** the registration SHALL succeed silently
- **AND** `useUiPrimitive("ui:format-tokens")` (inside `<UiPrimitiveProvider value={reg}>`) SHALL return the registered function

#### Scenario: Double-registration throws

- **WHEN** calling `registerUiPrimitive(reg, "ui:agent-card", AgentCardShellA)` then `registerUiPrimitive(reg, "ui:agent-card", AgentCardShellB)`
- **THEN** the second call SHALL throw an error with a message naming the duplicate key
- **AND** the registry SHALL retain `AgentCardShellA` (first-write-wins)

### Requirement: Provider-context distribution

`packages/dashboard-plugin-runtime/src/ui-primitive-context.tsx` SHALL export `<UiPrimitiveProvider value={registry}>` (a React context provider). The dashboard's `<App>` SHALL be wrapped in this provider in `packages/client/src/main.tsx`. All plugin slot consumers SHALL be descendants of this provider.

#### Scenario: Provider exposes registry to descendants

- **WHEN** a plugin component rendered inside `<UiPrimitiveProvider value={reg}>` calls `useUiPrimitive(key)`
- **THEN** the hook SHALL look up the impl in `reg`

#### Scenario: Hook outside provider throws

- **WHEN** a component calls `useUiPrimitive(key)` outside any `<UiPrimitiveProvider>`
- **THEN** the hook SHALL throw an error with a message reading "useUiPrimitive must be called inside <UiPrimitiveProvider>"

### Requirement: Strict and soft lookup hooks

The runtime SHALL export two lookup hooks with different missing-key behavior:

- `useUiPrimitive<K extends UiPrimitiveKey>(key: K): UiPrimitiveMap[K]` — strict. Throws if the key is not registered.
- `useUiPrimitiveOrNull<K extends UiPrimitiveKey>(key: K): UiPrimitiveMap[K] | null` — soft. Returns `null` if the key is not registered.

The strict hook SHALL be the default plugin authors reach for. The soft hook is for explicit graceful-degradation cases.

#### Scenario: Strict hook returns registered impl

- **WHEN** registry has `"ui:markdown-content"` registered AND a component calls `useUiPrimitive("ui:markdown-content")`
- **THEN** the hook SHALL return the registered React component
- **AND** TypeScript SHALL type the return as `ComponentType<{ content: string }>`

#### Scenario: Strict hook throws on missing key

- **WHEN** registry does NOT have `"ui:agent-card"` registered AND a component calls `useUiPrimitive("ui:agent-card")`
- **THEN** the hook SHALL throw an error with a message naming the missing key (e.g. `"UI primitive 'ui:agent-card' is not registered. Was the dashboard's main.tsx updated to register it?"`)

#### Scenario: Soft hook returns null on missing key

- **WHEN** registry does NOT have `"ui:agent-card"` registered AND a component calls `useUiPrimitiveOrNull("ui:agent-card")`
- **THEN** the hook SHALL return `null`
- **AND** the component SHALL be free to render fallback content

#### Scenario: Per-claim error boundary catches strict-hook throws

- **WHEN** a slot contribution calls `useUiPrimitive(key)` for a missing key inside a slot consumer
- **THEN** the existing per-claim `SlotErrorBoundary` SHALL catch the throw, log the error with plugin id and slot id, and render nothing for that contribution
- **AND** sibling contributions SHALL continue rendering unaffected

### Requirement: Test helper for plugin tests

`packages/dashboard-plugin-runtime/test-support/withUiPrimitiveProvider.tsx` SHALL export a helper that wraps a render in a `<UiPrimitiveProvider>` populated with a partial set of registrations. The helper signature:

```typescript
export function withUiPrimitiveProvider(
  partialImpls: Partial<UiPrimitiveMap>,
  children: React.ReactNode,
): React.ReactElement
```

Plugin tests SHALL use this helper to provide mock implementations of the primitives their tested components consume.

#### Scenario: Helper wraps children in provider with provided impls

- **WHEN** a test calls `render(withUiPrimitiveProvider({ "ui:markdown-content": MockMarkdown }, <ComponentUnderTest />))`
- **THEN** the rendered `<ComponentUnderTest />` SHALL have access to `MockMarkdown` via `useUiPrimitive("ui:markdown-content")`
- **AND** any primitive not in `partialImpls` SHALL throw if accessed via the strict hook (matches production behavior)

### Requirement: The primitive registry SHALL be consumed by the shell's IntentRenderer, not by plugin code

The primitive registry's mechanism — `createUiPrimitiveRegistry`, `registerUiPrimitive`, `UiPrimitiveProvider`, `useUiPrimitive`, `useUiPrimitiveOrNull` — SHALL survive unchanged. The currently-registered primitives SHALL stay registered. Adding new primitives still requires three steps: extend `UI_PRIMITIVE_KEYS`, extend `UiPrimitiveMap`, register an impl in `main.tsx`.

What changes: the expected caller of `useUiPrimitive(...)` SHALL move from plugin React components to the shell's `IntentRenderer`. Plugins SHALL NOT directly call `useUiPrimitive` from their client-side code as a renderer of their own state. The shell, on each connected client, SHALL call `useUiPrimitive(intent.primitive)` inside `IntentRenderer` to resolve a primitive name from an incoming intent to a `ComponentType` for rendering.

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

### Requirement: Plugin client-side `useUiPrimitive` calls SHALL be marked DEPRECATED

Plugin code that still imports `useUiPrimitive` (today, flows-plugin's 9 client files) SHALL continue to work — the API is not removed. But the JSDoc on the exported `useUiPrimitive` hook SHALL include a deprecation notice directing plugin authors to the intent broadcast pattern. The deprecation is documentation-only; runtime behavior is unchanged for legacy callers.

The repo-lint `no-primitive-direct-import.test.ts` (introduced by `add-plugin-ui-primitive-registry`) SHALL be relaxed from "fail on direct import" to "warn on direct import" during the migration period. Once flows-plugin has fully migrated, the lint may be re-tightened to forbid direct imports AND `useUiPrimitive` calls from plugin code entirely.

#### Scenario: JSDoc marks plugin-callsite useUiPrimitive as deprecated

- **GIVEN** plugin author reads the `useUiPrimitive` hook definition
- **WHEN** they look at the IDE hover or JSDoc preview
- **THEN** they SHALL see a deprecation notice stating: "Plugin code SHOULD emit intent broadcasts via ServerPluginContext.broadcastToSubscribers instead of calling useUiPrimitive directly. See plugin-intent-protocol."

### Requirement: Dashboard registers all declared primitives at startup

`packages/client/src/main.tsx` SHALL register an implementation for every key in `UI_PRIMITIVE_KEYS` before mounting `<App>`. The registrations SHALL happen synchronously inside the entry module so plugins encounter a fully-populated registry on first render.

If a future plugin claims a slot whose contribution requires a primitive not yet registered, the strict hook SHALL throw on first render of that contribution — surfacing the missing registration as a build-time concern rather than a silent runtime null.

#### Scenario: All declared keys have registrations

- **WHEN** the dashboard boots and `<App>` mounts
- **THEN** for every key K in `UI_PRIMITIVE_KEYS`, calling `useUiPrimitive(K)` from any descendant SHALL return a non-null impl
- **AND** the type of the impl SHALL match `UiPrimitiveMap[K]`

#### Scenario: Adding a key requires updating main.tsx

- **WHEN** a developer adds a new key to `UI_PRIMITIVE_KEYS` in shared/src/dashboard-plugin/ui-primitives.ts
- **THEN** TypeScript SHALL flag any path where the new key is used via `useUiPrimitive` that has no registration in main.tsx
- **AND** the build SHALL fail until the registration is added

### Requirement: Plugin tarballs do not transitively depend on client-utils for primitive components

After this change lands, `packages/flows-plugin/package.json#dependencies` SHALL NOT contain `@blackbelt-technology/pi-dashboard-client-utils` (because flows-plugin imports primitives only via the registry, not via direct symbol imports). flows-plugin's published tarball SHALL NOT pull the markdown stack (`react-markdown`, `remark-*`, `rehype-*`, `katex`, `react-syntax-highlighter`, `mermaid`) or `@mdi/*` as transitive deps for its primitive needs.

flows-plugin MAY retain a `client-utils` dep IF it imports hooks (e.g. `useMobile`, `useZoomPan`) from there directly. The dep is bounded to hook-shaped imports; primitive-component imports SHALL travel through the registry.

#### Scenario: flows-plugin package.json drops primitive-host dep

- **WHEN** reading `packages/flows-plugin/package.json#dependencies`
- **THEN** the object SHALL NOT contain `@blackbelt-technology/pi-dashboard-client-utils` UNLESS flows-plugin still imports a hook (`useMobile`, `useZoomPan`) directly
- **AND** if the hook dep is retained, the dependency presence SHALL be documented in the package.json with a comment naming the hook(s) that justify it

#### Scenario: pnpm pack confirms tarball is lean

- **WHEN** running `pnpm pack -F flows-plugin --dry-run` after this change lands
- **THEN** the inspected tarball SHALL NOT contain references to `react-markdown`, `mermaid`, or `react-syntax-highlighter` in flows-plugin's own source
- **AND** the dependency list at the top of the tarball metadata SHALL exclude these packages

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

### Requirement: Existing `StatusBar` usage SHALL remain direct-import

`packages/client/src/components/StatusBar.tsx` SHALL keep its direct `import { ModelSelector } from "./ModelSelector.js"`. The primitive registry is for plugin consumers; the dashboard shell continues to import shell-private components directly. This keeps the StatusBar's call graph trivially analyzable and avoids a registry round-trip for first-party code.

#### Scenario: StatusBar source unchanged

- **WHEN** inspecting `packages/client/src/components/StatusBar.tsx` after this change lands
- **THEN** the file SHALL still import `ModelSelector` directly from `./ModelSelector.js`
- **AND** the file SHALL NOT call `useUiPrimitive("ui:model-selector")`

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

## Related Capabilities

- `dashboard-plugin-loader` — host capability for plugin discovery, slot registry, and `<PluginContextProvider>`. The UI primitive registry is layered alongside `PluginContext`: both providers wrap `<App>`, both expose plugin-facing APIs through React context.
- `dashboard-shell-slots` — slot taxonomy that plugins claim. Plugin contributions rendered inside slot consumers consume primitives via `useUiPrimitive(key)`.

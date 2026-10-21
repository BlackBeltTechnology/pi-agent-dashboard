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

A registered primitive implementation MAY mount additional providers it needs inside itself (for example `ui:chat-view` mounting the chat and session providers). Such nested providers SHALL NOT mount a second `UiPrimitiveProvider`; primitives used inside them SHALL resolve from the enclosing registry. A standalone embed outside `<App>` SHALL wrap its tree in `<UiPrimitiveProvider>` with the registry from `createHostPrimitiveRegistry()` and the chat-embed `EmbedProviders`.

#### Scenario: Provider exposes registry to descendants

- **WHEN** a plugin component rendered inside `<UiPrimitiveProvider value={reg}>` calls `useUiPrimitive(key)`
- **THEN** the hook SHALL look up the impl in `reg`

#### Scenario: Hook outside provider throws

- **WHEN** a component calls `useUiPrimitive(key)` outside any `<UiPrimitiveProvider>`
- **THEN** the hook SHALL throw an error with a message reading "useUiPrimitive must be called inside <UiPrimitiveProvider>"

#### Scenario: Self-providing primitive resolves from the enclosing registry

- **WHEN** a plugin renders the `ui:chat-view` primitive inside a slot, and the chat view renders `ui:markdown-content` internally
- **THEN** the markdown primitive SHALL resolve from the app's registry, and no second `UiPrimitiveProvider` SHALL be mounted

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

### Requirement: `ui:action-list` items accept an optional tone

`UiActionListItem` SHALL accept an optional `tone` whose type is the shared `UiTone` union `"go" | "create" | "caution" | "danger"`. The shared package SHALL export `UiTone`, the readonly `UI_TONES` list and an `isUiTone(value)` runtime guard next to `UiActionListItem`, so that every layer validates with one guard. The field is additive. An item without `tone` SHALL render exactly as before.

The `ui:action-list` renderer SHALL honour `tone` in both of its modes:
- **Menu mode** (inside an `ActionListMenuContext`): the item follows the menu tone rendering of `session-actions-menu`. Its icon is coloured with the tone's `--accent-<hue>-text` token. An enabled `danger` item has a `--tint-red-bg` hover and focus background. A disabled item drops the colour. The item carries `data-action-tone`.
- **Inline mode:** the icon is coloured with the tone's `--accent-<hue>-text` token, the label keeps the neutral colour, and the button carries `data-action-tone`.

Intent props are untyped, so `ActionList` SHALL validate `tone` with `isUiTone` before using it for colour or `data-action-tone`. Any value outside the union SHALL render as neutral, including inherited object keys (`constructor`, `__proto__`) and non-strings. The item SHALL still render and stay activatable, and no error SHALL be thrown. Tone SHALL NOT alter the item's activation, disabled behaviour or accessible name.

#### Scenario: Toned item renders a coloured icon in menu mode
- **WHEN** `ActionList` renders inside `ActionListMenuContext` with `actions: [{ label: "Delete", icon: "mdiDelete", tone: "danger" }]`
- **THEN** the `menuitem` SHALL carry `data-action-tone="danger"`
- **AND** its icon SHALL use `--accent-red-text`

#### Scenario: Toned item renders a coloured icon inline
- **WHEN** `ActionList` renders without a menu context with `actions: [{ label: "Run", icon: "mdiPlay", tone: "go" }]`
- **THEN** the button's icon SHALL use `--accent-green-text`
- **AND** its label SHALL keep the neutral colour

#### Scenario: Unknown tone renders neutral
- **WHEN** an intent publishes an action with `tone: "purple"`, and separately with `tone: "__proto__"` and `tone: 42`
- **THEN** the item SHALL render with no `data-action-tone` and a neutral icon
- **AND** activating it SHALL run its handler

#### Scenario: Untoned item is unchanged
- **WHEN** `ActionList` renders `actions: [{ label: "Open", icon: "mdiOpenInNew" }]`
- **THEN** the rendered markup SHALL carry no `data-action-tone`, and no element SHALL gain a `class` attribute it did not have before (no empty `class=""`)

### Requirement: Plugins consume primitives directly as public host API

Plugin client code, bundled or runtime-loaded, MAY call `useUiPrimitive` and `useUiPrimitiveOrNull` to obtain host components and helpers. Both hooks SHALL be in the public surface and its snapshot. The shell's IntentRenderer SHALL keep resolving intents through the same registry. Adding a key or optional prop SHALL be a minor host API change; removing or renaming one SHALL be major.

#### Scenario: Runtime plugin renders markdown through the host
- **WHEN** a runtime-loaded plugin calls `useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent)` and renders the result
- **THEN** the host's markdown component SHALL render the content, and the plugin bundle SHALL NOT contain a markdown stack

#### Scenario: Intent path still works
- **WHEN** a plugin broadcasts an intent `{primitive:"ui:agent-card", props:{name:"Explore", status:"running"}}`
- **THEN** the shell's IntentRenderer SHALL resolve and render the agent card as before

### Requirement: `ui:chat-view` primitive key and contract

`UI_PRIMITIVE_KEYS` SHALL include `chatView: "ui:chat-view"`. `UiPrimitiveMap["ui:chat-view"]` SHALL be `ComponentType<{ sessionId: string; readOnly?: boolean; compact?: boolean }>`.

The dashboard SHALL register the host `ChatView` under this key at startup. The registered component SHALL mount the providers it needs itself, so a plugin can render it inside any slot.

#### Scenario: Plugin embeds a live session chat
- **WHEN** a plugin's overlay route renders `useUiPrimitive(UI_PRIMITIVE_KEYS.chatView)` with `sessionId="s1"`
- **THEN** the live chat of session `s1` SHALL render with host styling and behaviour, and the plugin SHALL import no client source

#### Scenario: Read-only chat hides the composer
- **WHEN** the primitive is rendered with `readOnly: true`
- **THEN** no prompt composer SHALL render

### Requirement: `ui:elapsed-badge` primitive key and contract

`UI_PRIMITIVE_KEYS` SHALL include `elapsedBadge: "ui:elapsed-badge"`. `UiPrimitiveMap["ui:elapsed-badge"]` SHALL be `ComponentType<{ startedAt?: number; duration?: number }>`, the props of the host `ElapsedBadge` component. The dashboard SHALL register the host component under this key at startup.

#### Scenario: Plugin shows a live elapsed time
- **WHEN** the subagents plugin's Agent renderer renders `useUiPrimitive(UI_PRIMITIVE_KEYS.elapsedBadge)` for a running call
- **THEN** the host's elapsed badge SHALL render and tick, and the plugin SHALL import no client source

## Related Capabilities

- `dashboard-plugin-loader` — host capability for plugin discovery, slot registry, and `<PluginContextProvider>`. The UI primitive registry is layered alongside `PluginContext`: both providers wrap `<App>`, both expose plugin-facing APIs through React context.
- `dashboard-shell-slots` — slot taxonomy that plugins claim. Plugin contributions rendered inside slot consumers consume primitives via `useUiPrimitive(key)`.

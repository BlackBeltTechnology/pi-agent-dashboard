## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: The primitive registry SHALL be consumed by the shell's IntentRenderer, not by plugin code
**Reason**: The rule is contradicted by practice. 11 plugins call `useUiPrimitive` (S5 inventory, e.g. `markdownContent` ×20). Primitives are also the only way a runtime-loaded plugin can reach a host component without bundling it (`plugin-runtime-client-loading`). The transient-input-primitive exception it defined is subsumed by the general permission.
**Migration**: None needed. Existing plugin call sites stay valid. Intent broadcasts remain supported, and the shell's IntentRenderer still resolves primitives for intents. See the ADDED requirement "Plugins consume primitives directly as public host API" and the modified `plugin-intent-protocol`.

### Requirement: Plugin client-side `useUiPrimitive` calls SHALL be marked DEPRECATED
**Reason**: It is replaced by the public host API (`plugin-host-api`). `useUiPrimitive` and `useUiPrimitiveOrNull` are part of the versioned public surface.
**Migration**: Remove the deprecation notice from the `useUiPrimitive` JSDoc. The repo-lint `no-primitive-direct-import.test.ts` keeps forbidding direct imports of primitive *implementations*. It SHALL NOT flag `useUiPrimitive` calls.

## ADDED Requirements

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

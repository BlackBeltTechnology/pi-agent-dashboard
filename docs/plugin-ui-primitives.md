# Plugin UI Primitives

Plugins access dashboard-provided React primitives through a runtime registry.
The dashboard registers concrete implementations at startup; plugins look them
up by stable string keys via `useUiPrimitive(key)`.

This complements (does not replace) the slot system. Slots flow plugin → shell
("here's a component, place it in this slot"); the primitive registry flows
shell → plugin ("here's a building block, use it"). Together they let plugins
ship zero React for the dashboard's UI primitives.

## When to use what

| Need | Mechanism | Example |
|---|---|---|
| Plugin contributes a session-card badge / action / settings panel | **Slot claim** in plugin manifest | `flows-plugin` claims `session-card-flows` |
| Plugin uses dashboard's MarkdownContent / AgentCardShell / dialogs | **Primitive registry** via `useUiPrimitive(key)` | `flows-plugin`'s FlowAgentCard uses `useUiPrimitive(UI_PRIMITIVE_KEYS.agentCard)` |
| Plugin uses a dashboard hook (useMobile, useZoomPan) | **Direct import** from `pi-dashboard-client-utils` | Hooks can't go through the registry — Rules of Hooks |
| Plugin uses an extension-ui slot consumer (GateSlot, BreadcrumbSlot) | **Direct import** from `pi-dashboard-client-utils/extension-ui/*` | Slot consumers are themselves slot mechanism, different layer |

## The registered primitives

Eight initial primitives. The keys live in
`@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives` as
the const `UI_PRIMITIVE_KEYS`.

| Key constant | String value | Contract type |
|---|---|---|
| `UI_PRIMITIVE_KEYS.agentCard` | `"ui:agent-card"` | `ComponentType<UiAgentCardProps>` |
| `UI_PRIMITIVE_KEYS.markdownContent` | `"ui:markdown-content"` | `ComponentType<UiMarkdownContentProps>` |
| `UI_PRIMITIVE_KEYS.confirmDialog` | `"ui:confirm-dialog"` | `ComponentType<UiConfirmDialogProps>` |
| `UI_PRIMITIVE_KEYS.dialogPortal` | `"ui:dialog-portal"` | `ComponentType<UiDialogPortalProps>` |
| `UI_PRIMITIVE_KEYS.searchableSelectDialog` | `"ui:searchable-select-dialog"` | `ComponentType<UiSearchableSelectDialogProps>` |
| `UI_PRIMITIVE_KEYS.zoomControls` | `"ui:zoom-controls"` | `ComponentType<UiZoomControlsProps>` |
| `UI_PRIMITIVE_KEYS.formatTokens` | `"ui:format-tokens"` | `(n: number) => string` |
| `UI_PRIMITIVE_KEYS.formatDuration` | `"ui:format-duration"` | `(ms: number) => string` |
| `UI_PRIMITIVE_KEYS.modelSelector` | `"ui:model-selector"` | `ComponentType<UiModelSelectorProps>` — model picker. provider filter. typeahead. emits `provider/id` label via `onSelect`. |

Full prop types for each are in `packages/shared/src/dashboard-plugin/ui-primitives.ts`.

## How a plugin consumes a primitive

```tsx
import { useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";

export function FlowAgentDetail({ agent }: { agent: FlowAgentState }) {
  const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
  return <MarkdownContent content={agent.summary} />;
}
```

The hook MUST be called at the top level of the component (Rules of Hooks
apply normally). The returned value is the registered impl with the correct
TypeScript type — no casting needed.

## Strict vs soft

Two hooks:

- `useUiPrimitive(key)` — **strict**. Throws a clear error if the key is not
  registered. Use this by default. A missing registration is almost always a
  bug; throwing surfaces it immediately. Per-claim error boundaries (see
  `slot-error-boundary.tsx`) catch the throw and isolate the failing claim.
- `useUiPrimitiveOrNull(key)` — **soft**. Returns `null` for a missing key.
  Use only when the plugin has a meaningful fallback. Both hooks throw if
  called outside `<UiPrimitiveProvider>` (provider missing is always a bug).

## Hooks are direct imports — Rules of Hooks

`useMobile`, `useZoomPan`, and `useMediaQuery` cannot go through the registry.
A hook returned from `useUiPrimitive(key)` would be called dynamically;
React's hook stack would mis-sequence. These hooks stay as direct imports:

```tsx
import { useZoomPan } from "@blackbelt-technology/pi-dashboard-client-utils/useZoomPan";
import { useMobile } from "@blackbelt-technology/pi-dashboard-client-utils/useMobile";
```

Plugins that need hooks keep `pi-dashboard-client-utils` as a runtime
dependency. The `package.json#deps-rationale` field documents why.

## Tests

When a plugin test renders a component that calls `useUiPrimitive(key)`, the
test SHALL wrap the rendered tree in a provider populated with the impls the
component looks up:

```tsx
import { render } from "@testing-library/react";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";

it("renders agent summary as markdown", () => {
  const { getByTestId } = render(
    withUiPrimitiveProvider(
      { [UI_PRIMITIVE_KEYS.markdownContent]: ({ content }) => <pre data-testid="md">{content}</pre> },
      <FlowAgentDetail agent={fakeAgent} />,
    ),
  );
  expect(getByTestId("md").textContent).toBe(fakeAgent.summary);
});
```

Keys NOT supplied in `partialImpls` remain unregistered — strict-hook lookups
throw, soft-hook lookups return null. This matches production behavior on
missing registrations.

## Adding a new primitive

When a future plugin needs a primitive that isn't yet registered:

1. **Add the key + contract type** to
   `packages/shared/src/dashboard-plugin/ui-primitives.ts`:
   - Append a new entry to `UI_PRIMITIVE_KEYS` (e.g. `tasksPopoverShell: "ui:tasks-popover-shell"`).
   - Define the contract interface (e.g. `UiTasksPopoverShellProps`).
   - Add the entry to `UiPrimitiveMap`.

2. **Register the implementation** in `packages/client/src/main.tsx`:
   - Import the concrete component (from client-utils, the dashboard's
     own `components/`, or wherever it lives).
   - Add `registerUiPrimitive(primitiveRegistry, UI_PRIMITIVE_KEYS.tasksPopoverShell, TasksPopoverShell);`.

3. **Update the lint allow-list** in
   `packages/shared/src/__tests__/no-primitive-direct-import.test.ts`
   if the symbol's name should be flagged when imported directly. The
   lint already covers the eight initial primitives; new keys SHALL be
   added to `FORBIDDEN_PRIMITIVES` so the registry pattern is enforced.

4. **Document the new key** in this file's table.

5. **Update CHANGELOG**: the registry contract grows. Adding optional
   props to an existing contract is non-breaking. Renaming or removing
   props is breaking and requires a deprecation cycle — register both
   the old and new keys for one minor release with a deprecation
   warning, then remove.

## Related changes

- `add-plugin-ui-primitive-registry` — this proposal.
- `dashboard-plugin-architecture` — the slot system the registry complements.
- `dashboard-shell-slots` — slot taxonomy.
- `dashboard-plugin-loader` — plugin discovery + provider wiring.

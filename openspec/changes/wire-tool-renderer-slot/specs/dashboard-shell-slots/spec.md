## ADDED Requirements

### Requirement: Chat tool-call dispatch consults `tool-renderer` slot before built-in registry

The dashboard chat surface (`ToolCallStep`) SHALL consult the plugin slot registry for `tool-renderer` claims matching the current `toolName` before falling through to the built-in `getToolRenderer(toolName)` Map.

The resolution chain SHALL be, in order:

1. Plugin `tool-renderer` claim for `toolName` whose `shouldRender` evaluates truthy (or whose `shouldRender` is undefined) → render the plugin's component.
2. Built-in renderer in `packages/client/src/components/tool-renderers/registry.ts` Map.
3. `GenericToolRenderer` as final fallback.

Resolution SHALL be one-shot at lookup time. If the resolved renderer throws during render, the existing per-tool ErrorBoundary catches it; dispatch SHALL NOT attempt to fall through to a lower tier.

When a plugin claim's `shouldRender` function THROWS, dispatch SHALL treat the result as `false` (fail closed), log a console warning naming the offending plugin id and `toolName`, and continue down the chain.

When the slot registry context is unavailable (e.g. test or storybook contexts without a `SlotRegistryProvider`), `useSlotRegistryOrNull()` SHALL return null and dispatch SHALL fall through cleanly to the built-in registry.

#### Scenario: Plugin claim wins over built-in for same toolName

- **WHEN** a plugin contributes a `tool-renderer` claim with `toolName: "bash"` AND a chat surface renders a `bash` tool call
- **THEN** the plugin's component renders
- **AND** the built-in `BashToolRenderer` does NOT render

#### Scenario: No plugin claim → built-in wins

- **WHEN** no plugin claims `tool-renderer` for `toolName: "read"` AND a chat surface renders a `read` tool call
- **THEN** the built-in `ReadToolRenderer` renders

#### Scenario: Unknown tool with no plugin claim → Generic

- **WHEN** a chat surface renders a `ctx_execute` tool call AND no plugin claims it AND no built-in entry exists
- **THEN** `GenericToolRenderer` renders

#### Scenario: `shouldRender` returns false → fall through

- **WHEN** a plugin contributes a `tool-renderer` claim for `toolName: "ctx_execute"` AND its `shouldRender` returns false
- **THEN** the plugin's component does NOT render
- **AND** dispatch falls through to the built-in registry (then to `GenericToolRenderer` if no built-in match)

#### Scenario: `shouldRender` throws → fail closed

- **WHEN** a plugin contributes a `tool-renderer` claim AND its `shouldRender` function throws on invocation
- **THEN** dispatch treats the claim as if `shouldRender` returned false
- **AND** falls through to the next tier
- **AND** logs a console warning identifying the plugin id and `toolName`

#### Scenario: Plugin renderer throws → ErrorBoundary catches; no fall-through

- **WHEN** the resolved plugin renderer throws during render
- **THEN** the existing per-tool ErrorBoundary catches the error and renders an error state
- **AND** the dispatch does NOT fall through to the built-in renderer (failure is visible, not silently swapped)

#### Scenario: Slot registry not initialized → fall through to built-in

- **WHEN** `useSlotRegistryOrNull()` returns null because no `SlotRegistryProvider` is mounted (test / storybook context)
- **THEN** dispatch skips the plugin lookup entirely and uses `getToolRenderer(toolName)`

### Requirement: Tool-renderer slot prop contract expanded with optional payload fields

The `tool-renderer` slot prop contract SHALL include all of the following:

- **Required** (unchanged): `toolName: string`, `toolInput: Record<string, unknown>`, `sessionId: string`.
- **Optional** (added by this change): `status?: "running" | "complete" | "error"`, `result?: string`, `toolDetails?: Record<string, unknown>`, `images?: ChatImage[]`, `context?: ToolContext`.

Existing plugin claims that consume only the required core SHALL continue to work without changes. Plugin renderers MAY consume the optional fields to mirror the built-in renderer payload.

The slot SHALL NOT rename `toolInput` to `args` (the built-in renderers' field name); both naming forms continue to coexist (plugin slot uses `toolInput`, built-in renderers use `args`) to preserve backward compatibility of existing plugin claims (`demo-plugin`).

#### Scenario: Existing plugin claim continues to render after expansion

- **WHEN** a plugin that consumes only `toolName`, `toolInput`, and `sessionId` (the pre-expansion contract) is loaded
- **THEN** the plugin's renderer mounts and renders without TypeScript errors or runtime errors

#### Scenario: Plugin renderer consuming `result` and `status`

- **WHEN** a plugin renderer reads `result` to populate an output panel AND `status` to drive a loading spinner
- **THEN** the renderer receives both props from `ToolCallStep`'s mount call
- **AND** the values match what the built-in renderers receive for the same tool call

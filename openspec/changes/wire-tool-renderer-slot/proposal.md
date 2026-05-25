## Why

The dashboard's `tool-renderer` plugin slot is fully wired through the runtime — `SLOT_DEFINITIONS` declares it, `ToolRendererSlot` (a slot consumer) exists in `slot-consumers.tsx`, `forToolName` filters claims, `manifest-validator` rejects duplicate `toolName` claims, and `packages/demo-plugin/` ships a working `tool-renderer` claim whose README states the green box "renders". Tests in `__tests__/slot-consumers.test.tsx` cover the consumer.

But `packages/client/src/components/ToolCallStep.tsx` (the lone caller of the per-tool renderer) never mounts `ToolRendererSlot`. It consults only the built-in `getToolRenderer(name)` Map in `tool-renderers/registry.ts` and falls back to `GenericToolRenderer`. Verified by `rg -n "ToolRendererSlot" packages/client/src/ packages/server/src/ src/` returning **no results**.

Consequences:

- Every `mcp__*` and `ctx_*` tool (e.g. `context-mode`'s `ctx_execute`, `ctx_search`, `ctx_batch_execute`) lands in the generic JSON-dump fallback. For `ctx_batch_execute` (multi-command + multi-query payload) the result is nearly unreadable.
- `demo-plugin`'s documented green box never renders in the actual UI.
- No third-party plugin can contribute tool renderers, even though every other piece of the contract supports it.

This change wires the consumer in so plugin `tool-renderer` claims are honored. It unblocks `add-context-mode-plugin` (separate change) and any future MCP-extension renderer plugins.

## What Changes

- `packages/client/src/components/ToolCallStep.tsx` consults plugin `tool-renderer` claims (filtered by `toolName` and `shouldRender`) before falling through to the built-in registry. Resolution order: **plugin claim → built-in `getToolRenderer` → `GenericToolRenderer`**.
- Expand `SlotPropsMap["tool-renderer"]` in `packages/shared/src/dashboard-plugin/slot-props.ts` with optional fields plugin renderers may consume: `status`, `result`, `toolDetails`, `images`, `context`. The required core (`toolName`, `toolInput`, `sessionId`) is unchanged so existing plugin claims keep compiling.
- Update `ToolRendererSlot` in `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` to accept and forward the new optional props. Existing test callers remain compatible.
- Update `packages/demo-plugin/README.md` so the green-box claim accurately reflects post-wiring behaviour, and add a smoke assertion that the green box actually renders when the demo plugin is enabled.
- Add tests in `packages/client/src/components/__tests__/ToolCallStep.test.tsx` covering: plugin-claim wins over built-in for same `toolName`; built-in wins when no plugin claim; `shouldRender: false` causes fall-through; ErrorBoundary still catches plugin renderer errors (no fall-through on render error — keeps bugs visible).

## Capabilities

### New Capabilities
- _None._

### Modified Capabilities
- `dashboard-shell-slots`: adds requirement that `ToolCallStep` consumes the `tool-renderer` slot, defines the resolution chain (plugin → built-in → Generic) including `shouldRender` handling, and expands the slot prop contract with optional payload fields.

## Impact

- **Touched files**: ~5 production files — `ToolCallStep.tsx`, `slot-props.ts`, `slot-consumers.tsx`, `demo-plugin/README.md`, plus 1–2 test files.
- **Plugin API surface**: backward-compatible. Existing `tool-renderer` claims (only `demo-plugin` today) continue to work; new optional props are additive.
- **Behaviour change**: `demo-plugin`'s `DashboardDemo` tool-renderer claim begins to render in the UI when that tool is invoked. Default user-visible behaviour unchanged unless a tool-renderer plugin is installed.
- **No new dependencies, no schema migration, no runtime cost** when no plugin claims exist (single registry-map lookup remains the hot path).
- **Unblocks** `add-context-mode-plugin` (separate change in this batch) and any future MCP-extension renderer plugins.

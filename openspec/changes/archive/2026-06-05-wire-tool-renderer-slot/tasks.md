## 1. Expand slot prop contract

- [x] 1.1 Update `SlotPropsMap["tool-renderer"]` in `packages/shared/src/dashboard-plugin/slot-props.ts` to add optional `status`, `result`, `toolDetails`, `images`, `context` (mirroring `ToolRendererProps` in `packages/client/src/components/tool-renderers/types.ts`).
- [x] 1.2 Update `ToolRendererSlot` in `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` to accept and forward the new optional props.
- [x] 1.3 Verify existing slot-consumers tests still pass with the expanded prop shape (no behavioural change when optionals are omitted).

## 2. Wire dispatch in `ToolCallStep`

- [x] 2.1 In `packages/client/src/components/ToolCallStep.tsx`, import `useSlotRegistryOrNull` from `@blackbelt-technology/dashboard-plugin-runtime` and `forToolName` for the filter.
- [x] 2.2 Implement the resolution chain: read plugin claims for `tool-renderer` filtered by `toolName`; evaluate each claim's `shouldRender` (default truthy when absent, fail-closed on throw); pick the highest-priority surviving claim. If a claim survives, render the plugin's component via the existing `renderClaim` helper with the expanded prop set. Otherwise fall through to `getToolRenderer(toolName)`.
- [x] 2.3 Confirm the existing per-tool `ErrorBoundary` continues to wrap the rendered component (no behavioural change when plugin renderer throws).
- [x] 2.4 Confirm the `expanded && <Renderer />` lazy-mount gate continues to apply to plugin renderers too.

## 3. Test coverage

- [x] 3.1 `ToolCallStep` test: plugin claim with matching `toolName` wins over built-in renderer.
- [x] 3.2 `ToolCallStep` test: no plugin claim → built-in renderer wins.
- [x] 3.3 `ToolCallStep` test: plugin claim with `shouldRender: false` → falls through to built-in.
- [x] 3.4 `ToolCallStep` test: plugin claim with NO built-in fallback → `GenericToolRenderer` fires when `shouldRender:false`; plugin fires when truthy.
- [x] 3.5 `ToolCallStep` test: plugin claim overriding a built-in `toolName` (e.g. plugin claims `"bash"`) → plugin wins (documents the override surface).
- [x] 3.6 `ToolCallStep` test: plugin renderer throws → ErrorBoundary catches; test asserts no fall-through to built-in.
- [x] 3.7 `ToolCallStep` test: plugin `shouldRender` throws → treated as `false` (fail-closed); dispatch falls through; console warning emitted.
- [x] 3.8 `ToolCallStep` test: `useSlotRegistryOrNull` returns null (no provider in test) → dispatch falls through cleanly to built-in.

## 4. Demo-plugin smoke

- [x] 4.1 Update `packages/demo-plugin/README.md` so the green-box claim accurately reflects post-wiring behaviour (today's wording implies it already renders).
- [x] 4.2 Add a smoke test asserting that with `demo-plugin` enabled, mounting `ToolCallStep` for `toolName: "DashboardDemo"` actually mounts the demo's green-box component (not the built-in or Generic fallback).

## 5. Documentation

- [x] 5.1 Update `docs/file-index-client.md` row for `ToolCallStep.tsx` to note "consults plugin tool-renderer slot before built-in registry" (caveman style; delegate to subagent per AGENTS.md docs-write protocol).
- [x] 5.2 Add / update rows in `docs/file-index-plugins.md` for `slot-consumers.tsx` and `slot-props.ts` covering the expanded `tool-renderer` contract (delegate to subagent).
- [x] 5.3 No AGENTS.md edit (per AGENTS.md "Documentation Update Protocol" — per-file detail belongs in the splits, not the backbone).

## 6. Validation

- [x] 6.1 `npm test -- ToolCallStep` passes.
- [x] 6.2 `npm test -- slot-consumers` passes.
- [x] 6.3 `npm test -- manifest-validator` passes (no regression on duplicate-claim rejection).
- [x] 6.4 `tsc --noEmit` passes across all workspaces.
- [x] 6.5 Manual smoke: with `demo-plugin` enabled, invoking the `DashboardDemo` tool surfaces the demo's green box (matches updated README claim).
- [x] 6.6 `openspec validate wire-tool-renderer-slot` passes.

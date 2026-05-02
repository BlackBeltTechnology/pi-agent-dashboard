## Why

The dashboard's flow rendering is currently 12 client files (`FlowDashboard`, `FlowAgentCard`, `FlowAgentDetail`, `FlowSummary`, `FlowGraph`, `FlowArchitect`, `FlowArchitectDetail`, `FlowActivityBadge`, `FlowLaunchDialog`, `FlowTabBar`, `SessionFlowActions`, plus `flow-reducer.ts`, `architect-reducer.ts`). `App.tsx` has hard-coded conditional rendering for `FlowAgentDetail`, `FlowArchitectDetail`, `FlowYamlPreview`. `SessionCard.tsx` directly imports `FlowActivityBadge` and `SessionFlowActions`. `App.tsx` mounts `FlowArchitect` and `FlowDashboard` as sticky content headers.

pi-flows itself is an external pi extension (separate repo). The dashboard's flow rendering is the dashboard's *reaction* to pi-flows events (`flow_started`, `flow_agent_started`, `flow_complete`, etc.). That reaction is the candidate for extraction.

The umbrella proposal `dashboard-plugin-architecture` introduces the plugin loader and slot taxonomy. This change uses that infrastructure to **move flow rendering into a first-class plugin package** at `packages/flows-plugin/`, register its UI via slot claims, and remove flow-rendering knowledge from the dashboard shell.

After this lands, the dashboard works without flows-plugin (no flow dashboard, no agent cards, no architect view, no flow badges) and flow rendering can ship independently. pi-flows remains the source of flow events; the dashboard's reaction is now a removable plugin.

This change DEPENDS ON `dashboard-plugin-architecture` and `add-dashboard-shell-slots-runtime` being implemented first.

## What Changes

- **NEW**: `packages/flows-plugin/` package with `pi-dashboard-plugin` manifest and a `client/` subdir (no server entry — flow events are forwarded by the existing dashboard event-wiring; no bridge entry — pi-flows is its own pi extension).
  - `client/` — `FlowDashboard`, `FlowAgentCard`, `FlowAgentDetail`, `FlowSummary`, `FlowGraph`, `FlowArchitect`, `FlowArchitectDetail`, `FlowActivityBadge`, `FlowLaunchDialog`, `FlowTabBar`, `SessionFlowActions`, plus `flow-reducer.ts`, `architect-reducer.ts`.
- **MOVE** (not copy): every flow-rendering file from `packages/client/src/` into `packages/flows-plugin/`. Use `git mv` to preserve history.
- **NEW**: Slot claims in the manifest:
  - `session-card-badge` → `FlowActivityBadge` (predicate: sessions with `activeFlowName`)
  - `session-card-action-bar` → `SessionFlowActions`
  - `content-header-sticky` → `FlowDashboard` (predicate: session has `flowState`) and `FlowArchitect` (predicate: session has `architectState`)
  - `content-view` (route `flow-agent-detail/:agentId`) → `FlowAgentDetail`
  - `content-view` (route `architect-detail`) → `FlowArchitectDetail`
  - `content-view` (route `flow-yaml`) → `FlowYamlPreview`
  - `content-inline-footer` → `FlowSummary` (predicate: flowState exists)
- **MOVE** the flow reducer files (`flow-reducer.ts`, `architect-reducer.ts`) into `packages/flows-plugin/src/client/`. `event-reducer.ts` continues to import them — but from the plugin's workspace package (`@blackbelt-technology/pi-dashboard-flows-plugin`) instead of the local `./flow-reducer.js` path. **No new plugin-context API is required**; this is a code-organization move, not a runtime-extension-point change. The reducer's outward contract (`(state, event) → newState`) is unchanged.
- **UPDATE** import paths in `App.tsx` and `SessionCard.tsx`: every `import` of a moved file changes from the local path to the workspace package (`@blackbelt-technology/pi-dashboard-flows-plugin/client`). JSX usage and shell-owned state remain unchanged.
- **DEFER (out of scope)**:
  - Plugin-owned reducer slices (`pluginContext.registerReducerSlice` API) — not specified by `dashboard-plugin-architecture`; tracked as `add-plugin-reducer-slice-api` if a real second consumer surfaces.
  - JSX migration to slot consumers (replacing `<FlowDashboard>` / `<FlowArchitect>` / `<FlowAgentDetail>` / `<FlowSummary>` with `<ContentHeaderStickySlot>` / `<ContentInlineFooterSlot>` calls) — the frozen v0.x slot prop contract only threads `{session}` to claims; the flow components need richer props. This is its own change (`migrate-flows-jsx-to-slots`) once either the slot prop contract is extended or the flow components are refactored to self-derive from session state + plugin context.
  - Removing the `~250 LOC of flow-specific conditional rendering` from `App.tsx` was an aspirational goal of an earlier draft; the realistic deliverable here is the file-move + import-path update. The shell still mounts flow components directly until the JSX migration ships.

## Capabilities

### New Capabilities

None. This change is a refactor that uses `dashboard-shell-slots` and `dashboard-plugin-loader` already established by the umbrella.

### Modified Capabilities

None. The reducer's contract is unchanged — `event-reducer.ts` continues to dispatch `flow_*` events through `reduceFlowEvent`; the only change is the import path (now resolves via the `flows-plugin` workspace package). Spec deltas are not required for code-organization moves.

Existing flow capabilities in `openspec/specs/` (`flow-card-grid`, `flow-card-status`, `flow-card-launcher`, `flow-summary-view`, `flow-agent-detail`, `flow-architect-view`, etc.) stay where they are; their requirements are unchanged. (A future change may relocate them under `packages/flows-plugin/specs/` for housekeeping, but that's not blocking.)

## Impact

- `packages/client/src/App.tsx` — ~250 LOC reduction.
- `packages/client/src/components/SessionCard.tsx` — replace direct imports with slot consumers.
- `packages/client/src/lib/event-reducer.ts` — accept reducer slices.
- `packages/flows-plugin/` — NEW package with all moved files.
- ~30 test files — paths in import statements update; behavioral assertions unchanged.
- `AGENTS.md` Key Files — replace internal flow entries with the plugin package and its manifest.
- `docs/architecture.md` — update Flow Dashboard Data Flow section to reference the plugin package.

## Migration Risks

- **Reducer file move**: `event-reducer.ts` imports `isFlowEvent` and `reduceFlowEvent` from `./flow-reducer.js`. The move changes that import path to `@blackbelt-technology/pi-dashboard-flows-plugin`. Validation: a session that runs a flow reaches byte-identical reducer state pre- and post-extraction (snapshot test).
- **Architect lifecycle**: `architect-reducer.ts` similarly moves; the bridge still emits the same events; the protocol is unchanged.
- **Workspace dependency cycle**: `packages/client` will depend on `packages/flows-plugin`, and `flows-plugin` may want to import shared types from `packages/shared`. Verify there's no cyclic dep (flows-plugin must not import from `@blackbelt-technology/pi-dashboard-web`).
- **Sticky header stacking**: `FlowDashboard` and `FlowArchitect` can both render simultaneously when both states exist. The `content-header-sticky` slot must support multiple concurrent contributions and stack them correctly. Validation: confirm the stacking rule matches today's `App.tsx` behavior (architect on top, flow dashboard below).
- **Mobile shell**: `MobileShell` currently has flow-specific behavior. Verify the slot consumers work in both desktop and mobile layouts.

## References

- Umbrella (archived; design implemented): `openspec/changes/archive/2026-04-26-dashboard-plugin-architecture/`
- Canonical specs: `openspec/specs/dashboard-shell-slots/spec.md`, `openspec/specs/dashboard-plugin-loader/spec.md`
- Sibling extraction: `openspec/changes/extract-openspec-as-plugin/`
- pi-flows source repo: external (referenced by name only).
- Layout scan results: `openspec/changes/archive/2026-04-26-dashboard-plugin-architecture/design.md` §"Current dashboard layout"

## Slot wiring guardrail

When this change wires new slot consumers into `App.tsx` (or any other shell file) inside a `??` fallback chain, the JSX element MUST be gated on a `getClaims(...).length > 0` check **before** construction. See `fix-slot-fallback-masks-content` for the rationale, the lint test that enforces the convention, and the exact production-bug shape that motivated it. Add the shell file path to `SCAN_FILES` in `packages/client/src/__tests__/no-jsx-slot-nullish-fallback.test.ts` if this change touches a file outside `App.tsx`.

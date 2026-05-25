## Context

The plugin runtime contract for tool renderers has been complete-on-paper since `dashboard-plugin-architecture` introduced the `tool-renderer` slot id and shipped `ToolRendererSlot` as a slot consumer. The dispatch never reached actual UI because `ToolCallStep` was authored against the built-in `tool-renderers/registry.ts` Map and never coordinated with the plugin runtime.

This was discovered while exploring how to render `context-mode` MCP tool calls (`ctx_execute`, `ctx_search`, etc.) which currently fall through to `GenericToolRenderer` as raw JSON dumps. The plugin-as-renderer-source path is the architecturally honest fix; this change unblocks it.

## Goals

1. `tool-renderer` plugin claims fire when their `toolName` matches an invoked tool.
2. Existing built-in renderers (Read, Edit, Bash, Write, Agent, ask_user) continue to render unchanged when no plugin claim wins.
3. `GenericToolRenderer` remains the final fallback for unknown tools with no plugin coverage.
4. Plugin renderers can opt into the same payload context (`status`, `result`, `toolDetails`, `images`, `context`) the built-in renderers have, without breaking existing plugin claims that ignore the new props.

## Non-goals

- **Render-error fallback chains.** If a plugin renderer throws, dispatch does NOT silently fall back to the built-in renderer. Rejected because chained-fallback-on-error masks plugin author bugs, requires custom error-boundary infrastructure, and surprises users (different renderer than the manifest declares). The existing per-tool ErrorBoundary catches and displays errors as it does today.
- **Predicate-based tool-name matching** (e.g. prefix `ctx_*` → one renderer family). Out of scope — per-tool explicit claims keep the contract simple. Plugins that want a family-renderer ship one claim per tool name. MCP servers publish finite tool lists; the cost is bounded.
- **Multi-claim per `toolName` resolution.** Manifest validator already rejects duplicate `tool-renderer` claims for the same `toolName` at load time. Not revisited here.
- **Hot-reload of `tool-renderer` claims** without a dashboard restart. The plugin loader's `restartRequired: true` semantics continue to apply.

## Decision 1 — Resolution chain

```
                  ┌───────────────────────────┐
                  │  plugin claim for         │
                  │  toolName exists?         │
                  └─────────────┬─────────────┘
                          yes │ │ no
                ┌─────────────┘ └─────────────┐
                ▼                             ▼
       ┌──────────────────┐         ┌──────────────────┐
       │  shouldRender    │         │  built-in        │
       │  passes?         │         │  registry        │
       │  (truthy or      │         │  (Map lookup)    │
       │   undefined)     │         └────────┬─────────┘
       └────────┬─────────┘                  │
            yes │ │ no                       │
       ┌────────┘ └────────────┐             ▼
       ▼                       ▼   ┌────────────────────┐
   PluginRenderer       (falls through) │ GenericFallback│
       │                              │ (if no built-in │
       │                              │   match)         │
       │                              └────────────────────┘
       └─── ErrorBoundary ─┐
                           ▼
                    (catches as today;
                     no fall-through)
```

**Resolution is one-shot at lookup time.** The renderer is selected once per `ToolCallStep` mount based on the claim registry state. If the chosen renderer throws on render, the existing per-tool ErrorBoundary catches and displays the error inline (same as a built-in renderer error today). No silent swap to a different renderer tier.

Rationale: chained fallback on render error would hide plugin author bugs, require non-standard React error-boundary infrastructure, and surprise users who configured the plugin expecting its renderer.

## Decision 2 — Expanded prop contract

Today's `SlotProps<"tool-renderer">`:

```ts
{
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
}
```

After this change:

```ts
{
  toolName:    string;
  toolInput:   Record<string, unknown>;
  sessionId:   string;
  // ─── newly optional ───
  status?:     "running" | "complete" | "error";
  result?:     string;
  toolDetails?: Record<string, unknown>;
  images?:     ChatImage[];
  context?:    ToolContext;                     // editors, cwd, session, sessionId
}
```

The required core is preserved verbatim so existing claims (`demo-plugin`) keep compiling. The optional fields mirror `ToolRendererProps` in `packages/client/src/components/tool-renderers/types.ts` — plugin renderers can consume the same payload built-in renderers do.

The `toolInput` vs. `args` naming difference is preserved (the plugin slot has historically used `toolInput`; built-in renderers use `args`). They hold the same value; we deliberately do NOT rename to avoid breaking the demo-plugin contract and to keep diffs small.

## Decision 3 — `shouldRender` honored on `tool-renderer` claims

`shouldRender` (a manifest-declared exported function name, sync, evaluated at render time) is already respected by `slot-registry`'s `forSessionRendered` filter for session-card slots. For `tool-renderer` claims we explicitly evaluate it during dispatch in `ToolCallStep`: a claim with `shouldRender` returning false is treated as if it doesn't exist, and dispatch falls through to the built-in registry (or Generic).

This matches the honcho-plugin pattern (closed-by-default sync cache via `/api/health`) and enables tool-renderer plugins to gracefully no-op when their target pi extension is uninstalled — important for replayed sessions whose history still contains `ctx_*` tool calls after the extension was removed.

## Decision 4 — Capability home: `dashboard-shell-slots`

The wiring change extends an existing capability rather than fragmenting into a new one. `dashboard-shell-slots` already owns slot consumer behaviour (per-claim error boundary, slot taxonomy). Adding the `tool-renderer` dispatch requirement here keeps the spec graph coherent.

`dashboard-plugin-loader` was considered but covers discovery / manifest validation / status reporting — not slot consumer behaviour at mount time. Wrong home.

## Edge cases

| Case | Behaviour | Tested in |
|---|---|---|
| Plugin claim exists, `shouldRender` undefined → defaults to render | Plugin wins | ToolCallStep.test (new) |
| Plugin claim with `shouldRender: false` | Falls through to built-in / Generic | ToolCallStep.test (new) |
| Plugin renderer throws during render | ErrorBoundary catches; shows error box; no fall-through | ToolCallStep.test (new) |
| Plugin claim for same `toolName` as a built-in (e.g. plugin claims `"bash"`) | Plugin wins (intentional override surface; documents extension point) | ToolCallStep.test (new) |
| Two plugins claim same `toolName` | Rejected at manifest validation | Existing `manifest-validator` tests |
| `component` name in claim doesn't resolve in plugin's component registry | Plugin's loader marks plugin as failed at boot; claim never reaches the slot | Existing plugin-loader tests |
| Slot registry not initialized (test / storybook contexts) | `useSlotRegistryOrNull()` returns null; dispatch falls through to built-in | ToolCallStep.test (new) |
| Plugin claim `shouldRender` throws | Treat as `false` (fail closed); dispatch falls through; log to console for plugin author | ToolCallStep.test (new) |

## Alternatives considered

1. **Generalize the built-in registry to a predicate dispatch** (e.g. `{ match: (name) => name.startsWith("ctx_"), renderer }`). Rejected — couples MCP-prefix awareness to core, doesn't help with future non-prefix-shaped extensions, and the explicit per-tool claim contract scales fine since each MCP server publishes a finite tool list.
2. **Pipe pi's TUI render output through to the dashboard as serialized text.** Rejected — confuses two rendering models (text-mode terminal vs. React), no semantic structure to render against, doesn't compose with dashboard themes.
3. **Server-side schema-aware fallback renderer** (use the registered tool's `inputSchema` to drive a Generic-but-smarter renderer). Interesting and orthogonal — would help every tool, not just plugin-covered ones. Worth a separate change after this one lands. Tracked as future work; not blocking this proposal.
4. **Try plugin then catch-and-fallback to built-in on render error.** Rejected per Non-goals — bug-masking, complexity, surprise.

## Implementation sketch

```ts
// packages/client/src/components/ToolCallStep.tsx
import { useSlotRegistryOrNull } from "@blackbelt-technology/dashboard-plugin-runtime";
import { forToolName } from "@blackbelt-technology/dashboard-plugin-runtime/slot-registry";
import { getToolRenderer } from "./tool-renderers/index.js";

// inside the component
const registry  = useSlotRegistryOrNull();
const claims    = registry
  ? forToolName(registry.getClaims("tool-renderer"), toolName)
      .filter(c => evaluateShouldRender(c, /* session */ context.session) !== false)
  : [];

const RenderNode = claims.length > 0
  ? <PluginToolClaim claim={claims[0]} {...allProps} />
  : (() => { const R = getToolRenderer(toolName); return <R {...allProps} />; })();
```

Where `evaluateShouldRender` is the existing helper that resolves the manifest's `shouldRender` exported-function-name to the plugin's component registry entry and invokes it synchronously; on throw it returns `false` (fail closed) and console-warns the plugin id.

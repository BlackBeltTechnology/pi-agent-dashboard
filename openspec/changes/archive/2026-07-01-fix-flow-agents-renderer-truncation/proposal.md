## Why

The `flow_agents` authoring card renders "list · 0 agents" even when the tool successfully discovered every agent. Root cause: `flow_agents op:"list"` returns a pretty-printed JSON catalog (~18 lines per agent); the dashboard line-truncates large tool results to a `«N earlier lines hidden»\n…` preview before handing it to the renderer, and `FlowAgentsToolRenderer` calls `JSON.parse(result)` on that marker string. The parse throws, the catch sets `parsed = null`, `Array.isArray(null)` is false, so the catalog collapses to `[]` and the card shows `0`. The model channel receives the full, untruncated result, so the agent works — only the dashboard card lies. This makes the authoring UI look broken and contradicts the `flow-authoring-renderers` spec, which requires the card to show the real count.

## What Changes

- `FlowAgentsToolRenderer` SHALL stop deriving the agent count by `JSON.parse`-ing a possibly-truncated text result. When the result is the truncation-marker form (`«N earlier lines hidden»…`) or otherwise unparseable, the card SHALL NOT report `0`; it SHALL indicate the output was truncated/expandable rather than fabricate a count.
- The renderer SHALL prefer a non-truncated structured source for the count when available (the `toolDetails` prop, which is not line-truncated), falling back to parsing the text only when it is valid JSON.
- Scope: **dashboard-side renderer fix only**, fully contained in `packages/flows-plugin`. It resolves the displayed bug without a cross-repo change.
- Complementary (out of scope, tracked separately in the `pi-flows` repo): have the `flow_agents` tool emit `details: { count, names }` so the renderer can read an authoritative count from `toolDetails`. This change makes the renderer *ready* to consume that, but does not require it — the marker-aware fallback stands alone.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `flow-authoring-renderers`: the "flow_agents list renders the catalog" requirement gains truncation-aware behavior — the card must never render a false `0` when the underlying result was truncated for display, and must derive the count from a non-truncated source when one exists.

## Impact

- **Code**: `packages/flows-plugin/src/client/FlowAgentsToolRenderer.tsx` (count derivation + truncation handling). Possible read of the existing `toolDetails` prop already threaded through `ToolCallStep.tsx`.
- **Tests**: `packages/flows-plugin/src/__tests__/authoring-renderers.test.tsx` (add truncated-result and toolDetails-count cases).
- **Specs**: `flow-authoring-renderers` delta.
- **No server/bridge/protocol change.** No pi-flows change required for this fix. Client-only; production requires `npm run build` + restart.

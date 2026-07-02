## Why

The `flow_agents op:"list"` authoring card is unreadable. Even after the truncation fix (`fix-flow-agents-renderer-truncation`), the card shows only a flat `name · name · …` string, and only after the user clicks "Show full output" — because the catalog data lives in the line-truncated text result. Every rich field the tool already returns (`description, tools, inputs, outputs, source_type, source_path, architect`) is discarded. Users cannot scan what agents exist, what each does, or where it comes from without reading raw JSON. Option B (chosen from a design mock) makes the card an always-visible, expandable per-agent list by moving the catalog into the tool's structured `details` channel, which is never line-truncated.

## What Changes

- **pi-flows** (`../pi-flows`, separate repo): `flow_agents op:"list"` SHALL populate `details` with a structured catalog `{ count, agents: [{ name, description, source_type, source_path?, tools?, inputs?, outputs?, use_when? }] }` in addition to the existing `content[0].text`. The text payload stays for the model channel; `details` is the display source. **This is the load-bearing dependency for the dashboard change** and lands in the pi-flows OpenSpec.
- **bridge** (`packages/extension/src/bridge.ts`): pi's live `tool_execution_end` extension event exposes the full ToolResult (`{ content, details }`) on `event.result` but does not surface a top-level `details`. The bridge SHALL lift `event.result.details` onto the forwarded event so the client reducer's `toolDetails` is populated LIVE (not only on replay). No-op when the result carries no details. Without this, the renderer's `toolDetails.agents` only arrives via replay/refresh.
- **flows-plugin** (`FlowAgentsToolRenderer`): render the `op:"list"` card from `toolDetails.agents` (the non-truncated source), falling back to parsing `result` text when `details` is absent (older pi-flows). The card SHALL show one row per agent — `name — description` + a `source_type` badge — always visible, no "Show full output" required. Each row SHALL be expandable to reveal `tools / inputs / outputs / use_when`.
- Rows SHALL render collapsed by default (`▸`); expanding one shows its detail block.
- The truncation-marker fallback from the prior change SHALL remain for the case where `details` is unavailable AND the text is truncated.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `flow-authoring-renderers`: the `flow_agents` list card gains a structured, always-visible, expandable per-agent list sourced from `toolDetails`, superseding the flat names-only render.

## Impact

- **pi-flows repo** (`extensions/flow-engine/tools/flow-agents.ts`): emit `details` catalog on `op:"list"`. Depends-on for this change; tracked as a linked pi-flows OpenSpec change.
- **Code (this repo)**: `packages/flows-plugin/src/client/FlowAgentsToolRenderer.tsx` — expandable-row list + `details` consumption.
- **Tests**: `packages/flows-plugin/src/__tests__/authoring-renderers.test.tsx` — details-sourced list, per-row expand, text-fallback.
- **Specs**: `flow-authoring-renderers` delta.
- **Bridge change required** (`packages/extension/src/bridge.ts`, detail-lift) — discovered during live verification: without it `details` only reaches the client on replay. No protocol/server change. Client requires `npm run build` + restart; bridge + pi-flows changes require session reload.
- **Builds on** `fix-flow-agents-renderer-truncation` (the `toolDetails` prop + truncation guard already added there).

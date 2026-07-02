## Context

`FlowAgentsToolRenderer` (in `packages/flows-plugin/src/client`) renders the `flow_agents` authoring card. After `fix-flow-agents-renderer-truncation` it: reads an optional `toolDetails` prop, guards the `«N earlier lines hidden»` truncation marker, and renders a flat `name · name · …` string plus a count. The rich per-agent fields the tool already computes — `description, tools, inputs, outputs, card, source_type, source_path, architect` — are discarded, and the catalog is only recoverable from the line-truncated `content[0].text`, so nothing shows until the user clicks the host "Show full output".

`flow_agents op:"list"` (in `../pi-flows/extensions/flow-engine/tools/flow-agents.ts`) currently returns `{ content:[{type:"text", text: JSON.stringify(catalog,null,2)}], details: {} }`. The `details` object is empty and is NOT subject to the display line-truncation. `ToolCallStep.tsx` already threads `toolDetails={toolDetails}` into the plugin renderer.

**Live-path finding (verified during implementation):** pi's live `tool_execution_end` extension event is `{ toolCallId, toolName, result, isError }` — it does NOT include a top-level `details`. `event.result` IS the full ToolResult object `{ content, details }` (confirmed by bridge probe: `rkeys: ["content","details"], hasDetails: true`). The client reducer reads `data.details` at `tool_execution_end` (the field the replay path synthesizes from the persisted entry). So without bridge help, `details` reaches the client ONLY on replay/refresh, not on the live tool call. The persisted session entry DOES carry `message.details`, so the replay path already works.

Option B (chosen from a visual mock) = move the catalog into `details` and render an always-visible, expandable per-agent list.

## Goals / Non-Goals

**Goals:**
- The list card is readable at a glance: one row per agent (`name — description` + source badge), always visible, no "Show full output" dance.
- Each row expands to the agent's `tools / inputs / outputs / use_when`.
- Truncation stops mattering for display because the catalog rides the non-truncated `details` channel.
- Graceful degradation on older pi-flows that still emit `details: {}`.

**Non-Goals:**
- Fetching/rendering the raw agent `.md` file (that was Option C — deferred).
- Any change to `FlowWriteToolRenderer`, the flow card grid, the manifest claims, or the running-flow cards.
- Server/bridge/protocol changes.

## Decisions

**Decision 1 — Catalog rides `details.agents`, text stays for the model.**
pi-flows `op:"list"` returns `details: { count, agents: [{ name, description, source_type, source_path?, tools?, inputs?, outputs?, use_when? }] }` alongside the existing `content[0].text`. Rationale: `details` is not line-truncated, so the card always has the full catalog; the text payload is unchanged so the model channel and existing behavior are untouched. `use_when` is flattened from `architect.use_when` (falling back to `description`) so the renderer needs no nested-shape knowledge. Alternative: exempt this tool's text from truncation host-side — rejected, host-wide blast radius and still a fragile text-parse path.

**Decision 2 — Renderer source order: `toolDetails.agents` → parsed text → truncation guard.**
`deriveListCatalog` returns full entry objects (not just names). Prefer `toolDetails.agents`; else parse `result` text into entries; else the truncation-marker guard from the prior change. Rationale: one code path serves new pi-flows (details) and old (text), and keeps the "never render a false 0" invariant.

**Decision 3 — Row = summary + lazy detail block; collapsed by default.**
Each agent renders a summary row (chevron, mono name, description, `source_type` badge). Local `useState` set of expanded names toggles a per-row detail block listing only the present fields. Rationale: matches the existing view-file toggle idiom in this renderer; collapsed-default keeps a 10-agent list scannable. Alternative: expand-all — rejected, noisy for large catalogs.

**Decision 4 — Entry type is duck-typed and fully optional.**
Define a local `AgentListEntry` interface with every field optional. The renderer renders whatever is present. Rationale: pi-flows may add/drop fields; the card must never throw on a partial entry. Absent fields are simply omitted from the expanded block (per spec).

**Decision 5 — Keep the change to the one renderer + its test (dashboard side).**
The pi-flows edit is a separate, small change in its own repo/OpenSpec; this change's dashboard code degrades gracefully until it lands, so the two can ship independently.

**Decision 6 — Bridge lifts `result.details` onto the live event (added during implementation).**
In `bridge.ts`'s enriched `tool_execution_end` handler, when `event.result` is an object carrying `details` and no top-level `event.details` exists, copy it: `event.details = event.result.details`. `mapEventToProtocol` then forwards it and the reducer's existing `endDetails = data.details` path populates `toolDetails`. Rationale: closes the live-path gap generically (any tool returning structured `details` benefits), no protocol/pi changes, and is a safe no-op when absent. Verified live: the flow_agents card renders the 7-row expandable list on the interactive call, not just on refresh. Alternative rejected: stream details via `tool_execution_update` partialResult (requires the tool to stream; flow_agents returns once).

## Risks / Trade-offs

- [pi-flows change not yet deployed] Renderer sees `details: {}` → falls back to text parse → behaves like the prior change (flat, expand-gated). Mitigation: fallback path retained + tested; no hard dependency at runtime.
- [Large catalog height] 10+ expanded rows could be tall. Mitigation: collapsed-by-default; only the summary rows show initially.
- [`source_type` values drift] pi-flows classifies `local`/`package`/`built-in`. Mitigation: render the string as-is in the badge; unknown values still display, no enum coupling.
- [Field-shape mismatch text-vs-details] Text entries nest `architect.use_when`; details entries flatten to `use_when`. Mitigation: `deriveListCatalog` normalizes both into the same `AgentListEntry` (read `use_when ?? architect?.use_when ?? description`).

## Migration Plan

Client-only on the dashboard side: `npm run build` + `POST /api/restart` (dev mode hot-reloads). pi-flows side: edit the tool, `npm run reload` to refresh connected sessions. No data migration. Rollback = revert the renderer + test (and the pi-flows tool edit independently).

## Open Questions

- Should the summary row also show a compact tool/inputs hint before expanding? Deferred — keep the summary to name/description/source; details on expand.

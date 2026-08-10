# CollapsedToolGroup.tsx — index

Renders collapsed group of repeated tool calls. Exports `CollapsedToolGroup`. Expanded view iterates `group.rendered` — `toolResult`→`ToolCallStep`; `thinking`/non-empty `assistant`→inline text (`data-testid=collapsed-group-narration`); empty/separator skipped. Count badge = `group.messages` (toolResult-only). See change: collapse-tool-calls-across-narration. → see `CollapsedToolGroup.tsx.AGENTS.md`

# tool-summary.ts — index

One-line tool-call summaries (`$ <cmd>`, `Read <path>`, `Grep …`, `git …`, `kb_search …`, `ctx_* …`). Exports `toolSummaries` map + `getSummary(toolName,args)`. Also `toolIcons` map + `getToolIcon(toolName)` → mdi icon path per kind (generic `mdiWrenchOutline` fallback), used by `ToolBurstGroup` single-member glyph + multi breakdown chips. Single source shared by `ToolCallStep`/`CollapsedToolGroup`/`ToolBurstGroup`. DRY. See changes: group-tool-call-bursts, enhance-tool-call-grouping.

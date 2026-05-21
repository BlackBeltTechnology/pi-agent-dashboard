## 1. Scaffold the new module in client-utils

- [x] 1.1 Create directory `packages/client-utils/src/minimal-chat/`
- [x] 1.2 Add `packages/client-utils/src/minimal-chat/types.ts` exporting `MinimalChatMode`, `MinimalChatStatus`, `MinimalChatEntry`, `MinimalChatViewProps` per design §Decision 5
- [x] 1.3 Add subpath export `"./minimal-chat"` to `packages/client-utils/package.json` `exports` map; mirror the existing per-component pattern (`./AgentCardShell`, `./Popover`, etc.)
- [x] 1.4 Verify TypeScript can resolve `import { MinimalChatView } from "@blackbelt-technology/pi-dashboard-client-utils/minimal-chat"` from any sibling workspace package (compile a throwaway import in `packages/subagents-plugin/src/`, observe no error, revert)

## 2. Implement MinimalChatView

- [x] 2.1 Create `packages/client-utils/src/minimal-chat/MinimalChatView.tsx` — top-level component with the props from design §Decision 5
- [x] 2.2 Implement status icon + color resolver `statusVisualsFor(status: MinimalChatStatus)` returning `{ iconPath, colorClass }` mapped per spec scenario "Status icon and color are driven by the normalized enum"
- [x] 2.3 Implement the entry renderers as local components in the same file: `ToolCallEntry`, `TextEntry`, `ThinkingEntry`, `ErrorEntry` (literal port of the existing implementations from `FlowAgentDetail.tsx` and `SubagentDetailView.tsx`; pick the one with the cleaner code as the seed)
- [x] 2.4 Implement `extractInputPreview(toolName, input)` helper (literal port)
- [x] 2.5 Implement the header: status icon, back-button slot, title row, optional subtitle path row, optional model badge, optional `↑tokens.input ↓tokens.output · duration` meta
- [x] 2.6 Implement the three modes: `inline` (`max-h-[60vh] overflow-hidden`), `popout` (`flex h-full overflow-hidden`), `row` (single-line summary, no body)
- [x] 2.7 Pull `MarkdownContent`, `formatTokens`, `formatDuration` via `useUiPrimitive(UI_PRIMITIVE_KEYS.*)` — NO direct shell imports (spec requirement "UI primitives accessed via the registry")
- [x] 2.8 Wire optional `footer?: ReactNode` prop below the entries (used by `FlowAgentDetail` for the "Summary" markdown block)
- [x] 2.9 Wire optional `activity?: string` per design open-question resolution: render under title in inline/popout when status is `running`
- [x] 2.10 Wire optional `emptyMessage?: string` and a mode-aware default (inline/popout: "No activity yet"; row: nothing)
- [x] 2.11 Add the file's header docblock referencing change `extract-minimal-chat-view`

## 3. Add unit tests for MinimalChatView

- [x] 3.1 Create `packages/client-utils/src/minimal-chat/__tests__/MinimalChatView.test.tsx`
- [x] 3.2 Use `withUiPrimitiveProvider` (from `@blackbelt-technology/dashboard-plugin-runtime/test-support`) to supply mock primitives
- [x] 3.3 Test: each of the four entry kinds renders the expected text/elements (spec scenario "Component renders entry kinds")
- [x] 3.4 Test: status enum → icon + color mapping for all five values (spec scenario "Status icon and color are driven by the normalized enum")
- [x] 3.5 Test: three modes apply the expected root container classes (spec scenario "Three modes adjust layout")
- [x] 3.6 Test: header meta is hidden when `meta` is omitted (spec scenario "No meta supplied")
- [x] 3.7 Test: header meta renders `↑/↓/duration` row when supplied (spec scenario "Tokens and duration supplied")
- [x] 3.8 Test: subtitle renders monospace path under title (spec scenario "Subtitle path renders below title")
- [x] 3.9 Test: tool entry without `output` shows no expand toggle (spec scenario "Tool entry without output")
- [x] 3.10 Test: tool entry with `output` toggles open on click (spec scenario "Tool entry with output is collapsible")
- [x] 3.11 Test: tool entry with `isError: true` paints the row border + name red (spec scenario "isError styles the tool row")
- [x] 3.12 Test: rendering without the primitive provider throws a hook-resolution error (spec scenario "Test wrapper supplies primitives" — negative case)
- [x] 3.13 Run the new test file and confirm all assertions pass: `npx vitest run packages/client-utils/src/minimal-chat/`

## 4. Rewrite SubagentDetailView as a shim

- [x] 4.1 Open `packages/subagents-plugin/src/client/SubagentDetailView.tsx`
- [x] 4.2 Delete the inline `ToolCallEntry`, `TextEntry`, `ThinkingEntry`, `ErrorEntry`, `extractInputPreview`, `statusIconPath`, `statusColor` declarations
- [x] 4.3 Delete the inline header JSX, the three-mode branching, and the tier-1/3/4 body branching
- [x] 4.4 Add `import { MinimalChatView } from "@blackbelt-technology/pi-dashboard-client-utils/minimal-chat"`
- [x] 4.5 Add a `mapSubagentStatus(status: SubagentState["status"]): MinimalChatStatus` adapter (exhaustive switch with `never` default — design §Risks)
- [x] 4.6 Add a `mapSubagentEntries(entries?: SubagentTimelineEntry[]): MinimalChatEntry[]` adapter that drops the `ts` field
- [x] 4.7 Rewrite the component body to map `SubagentState` → `MinimalChatViewProps` and render `<MinimalChatView .../>`
- [x] 4.8 Preserve the existing tier branching at the shim level: tier-1 entries-present → pass entries to view; tier-3 completed without entries → synthesize a single `{ kind: "text", text: result ?? "(no output)" }` entry; tier-4 placeholder → pass empty entries + `emptyMessage`
- [x] 4.9 Keep the existing exports (`SubagentDetailView`, `SessionStateLike`, `SubagentDetailMode`, `SubagentDetailViewProps`) so consumer imports do not move
- [x] 4.10 Run `npx vitest run packages/subagents-plugin/src/client/__tests__/SubagentDetailView.test.tsx` — all existing assertions SHALL pass with no test edits beyond unavoidable mount-point references

## 5. Rewrite FlowAgentDetail as a shim

- [x] 5.1 Open `packages/flows-plugin/src/client/FlowAgentDetail.tsx`
- [x] 5.2 Delete the inline `ToolCallEntry`, `TextEntry`, `ThinkingEntry`, `extractInputPreview`, and the local status icon/color resolution
- [x] 5.3 Delete the inline header JSX and the detail-history loop
- [x] 5.4 Add `import { MinimalChatView } from "@blackbelt-technology/pi-dashboard-client-utils/minimal-chat"`
- [x] 5.5 Add `mapFlowStatus(status: FlowAgentStatus): MinimalChatStatus` adapter (exhaustive switch with `never` default)
- [x] 5.6 Add `mapFlowEntries(detailHistory: FlowDetailEntry[]): MinimalChatEntry[]` adapter (effectively identity, but explicit for type safety)
- [x] 5.7 Build the `footer` from the existing summary block: when `agent.summary` is set, pass `<div className="mt-3 pt-2 border-t ..."> ... <MarkdownContent content={agent.summary} /></div>` as the `footer` prop
- [x] 5.8 Render `<MinimalChatView .../>` with mapped props (`title: label ?? agentName`, `status`, `entries`, `meta: { modelName: model, tokens, durationMs: duration }`, `mode: "popout"`)
- [x] 5.9 Keep the existing export `FlowAgentDetail` so `FlowAgentCard` (and the future `FlowAgentPopoutPage` from `add-flow-agent-popout`) keep working
- [x] 5.10 Run flows-plugin tests: `npx vitest run packages/flows-plugin/src/` — all existing assertions SHALL pass

## 6. Verify no duplicate helpers remain (spec scenario)

- [x] 6.1 Run `rg -n "function (ToolCallEntry|TextEntry|ThinkingEntry|extractInputPreview|statusIconPath|statusColor)" packages/subagents-plugin/src packages/flows-plugin/src` — output SHALL be empty
- [x] 6.2 Run `rg -n "@blackbelt-technology/pi-dashboard-client-utils/minimal-chat" packages/subagents-plugin/src/client/SubagentDetailView.tsx packages/flows-plugin/src/client/FlowAgentDetail.tsx` — each file SHALL appear once

## 7. Wire-up cleanup

- [x] 7.1 Search for any direct importers of the removed inline helpers across the repo: `rg -n "extractInputPreview|statusIconPath" packages/` — fix or remove orphan imports
- [x] 7.2 If `packages/subagents-plugin/src/client/index.tsx` re-exports any of the deleted symbols, drop those re-exports
- [x] 7.3 If `packages/flows-plugin/src/client/index.tsx` re-exports any of the deleted symbols, drop those re-exports

## 8. Build verification

- [x] 8.1 `npm run build` — confirms the new subpath export resolves under the bundler and emits to dist
- [x] 8.2 `npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` — all suites green
- [x] 8.3 `curl -X POST http://localhost:8000/api/restart` — restart server to pick up changes
- [x] 8.4 `npm run reload` — reload bridges (no extension changes here, but harmless and matches the standard cycle)

## 9. Manual smoke test

- [x] 9.1 Spawn a subagent via the `Agent` tool in a session; confirm the inline expanded card renders identically to before extraction (title, status pill, tool/text/thinking entries, header meta)
- [x] 9.2 Open the subagent popout URL `/session/<sid>/subagent/<aid>` (note: this requires `fix-subagent-popout-desktop-dispatch` to also be applied on desktop); confirm rendering matches inline view
- [x] 9.3 Start a flow that runs at least one agent step; click the eye button on a `FlowAgentCard`; confirm the popover shows the same detail layout as before (title, tools, summary footer)
- [x] 9.4 Diff a screenshot of the inline subagent card before/after — pixel-identical or within anti-aliasing noise

## 10. Documentation

- [x] 10.1 Add file-index row for `packages/client-utils/src/minimal-chat/MinimalChatView.tsx` to the appropriate split (delegate to a subagent per the AGENTS.md "Documentation Update Protocol")
- [x] 10.2 Update file-index rows for `packages/subagents-plugin/src/client/SubagentDetailView.tsx` and `packages/flows-plugin/src/client/FlowAgentDetail.tsx` to note "shim over `MinimalChatView`; see change: extract-minimal-chat-view"
- [x] 10.3 No AGENTS.md backbone changes (per the protocol: this is internal refactor, not architectural backbone)

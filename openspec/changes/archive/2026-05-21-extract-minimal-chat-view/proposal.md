## Why

`packages/subagents-plugin/src/client/SubagentDetailView.tsx` and `packages/flows-plugin/src/client/FlowAgentDetail.tsx` independently implement the **same** subagent / agent timeline renderer. Side-by-side they share: `ToolCallEntry`, `TextEntry`, `ThinkingEntry`, `extractInputPreview`, status-icon / status-color maps, and the header layout (status pill · displayName · model · `↑/↓` tokens · duration). Only the input data shape differs (`SubagentState` vs `FlowAgentState`).

Two copies guarantee drift. Worse, the next surfaces that already need this renderer — flow agent popout (`/session/:sid/flow/:flowId/agent/:agentId`) and any future plugin that shows a subagent-style timeline — would each fork a third / fourth copy. Extracting once now prevents that.

## What Changes

- **NEW** `packages/client-utils/src/minimal-chat/` module exporting a single `MinimalChatView` component plus its `MinimalChatEntry` / `MinimalChatStatus` data-shape types.
  - `MinimalChatView` owns: header (back button, status icon+color, title, optional sub-title path, model badge, tokens+duration meta), timeline body (tool / text / thinking / error entries), three modes (`inline`, `popout`, `row`), empty-state fallback.
  - Status icon + color map is data-driven (`MinimalChatStatus = "pending" | "running" | "complete" | "error" | "blocked" | "stopped"`) so consumers do not need a status enum lock-in.
  - Entry kinds: `{ kind: "tool" | "text" | "thinking" | "error", ... }` — superset of what both call sites need today.
  - Pulls `MarkdownContent`, `formatTokens`, `formatDuration` via the existing UI primitive registry — no new top-level dependencies.
- `packages/subagents-plugin/src/client/SubagentDetailView.tsx` becomes a **thin shim**: maps `SubagentState` → `MinimalChatView` props, keeps its current public API (`session`, `agentId`, `mode`, `onBack`) so `AgentToolRenderer` and `SubagentPopoutPage` call sites do not move.
- `packages/flows-plugin/src/client/FlowAgentDetail.tsx` becomes a **thin shim**: maps `FlowAgentState` → `MinimalChatView` props, keeps its current public API (`agent`, `onBack`) so `FlowAgentCard`'s eye-button popover does not move.
- Inline duplicates removed from both plugin packages: `ToolCallEntry`, `TextEntry`, `ThinkingEntry`, `extractInputPreview`, `statusIconPath`, `statusColor`.

No user-visible behavior change. No protocol change. No server change. No new exported plugin API.

## Capabilities

### New Capabilities

- `shared-timeline-view`: A shared subagent/agent timeline renderer (`MinimalChatView`) plus its data contract — status enum (`MinimalChatStatus`), entry-kind union (`MinimalChatEntry`), and mode (`inline`/`popout`/`row`). The contract is what dashboard plugins must adapt to when surfacing a per-agent timeline. No user-visible behavior change; the contract codifies what the two existing call sites already do.

### Modified Capabilities

_None._ No requirement-level behavior changes to existing capabilities. (The two consumer plugins' visible behavior is identical pre/post extraction.)

## Impact

- **Affected code**:
  - `packages/client-utils/src/minimal-chat/` — new directory (component + types + tests)
  - `packages/client-utils/src/index.ts` (or equivalent barrel) — new export
  - `packages/subagents-plugin/src/client/SubagentDetailView.tsx` — rewritten as shim
  - `packages/flows-plugin/src/client/FlowAgentDetail.tsx` — rewritten as shim
- **Tests**: existing `SubagentDetailView.test.tsx` and any flow-detail tests should pass unchanged post-shim (the shims preserve external behavior). New unit tests added for `MinimalChatView` covering: each entry kind renders, status icon/color mapping, three modes, empty state, optional header bits (model/tokens/path) omitted when absent.
- **Dependencies**: no new npm dependencies. `@blackbelt-technology/pi-dashboard-client-utils` already supplies UI primitive hooks; both plugins already depend on it.
- **APIs / protocol**: none. Internal-only refactor.
- **Risk**: low. The shims preserve every call-site contract; the change is mostly file moves + a small adapter layer. Watch for: subtle status-enum mismatches between `SubagentState.status` (`"created" | "running" | "completed" | "failed"`) and `FlowAgentState.status` (`"pending" | "running" | "complete" | "error" | "blocked"`) — the shims must normalize both to the shared `MinimalChatStatus`.

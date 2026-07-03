# DOX — packages/client-utils/src/minimal-chat

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Barrel for `./minimal-chat` subpath export. Re-exports `MinimalChatView`, `statusVisualsFor`, `extractInputPreview` from `MinimalChatView.js`; re-exports types `MinimalChatEntry`, `MinimalChatMeta`, `MinimalChatMode`, `MinimalChatStatus`, `MinimalChatViewProps` from `types.js`. Import path: `@blackbelt-technology/pi-dashboard-client-utils/minimal-chat`. |
| `MinimalChatView.tsx` | Shared subagent/agent timeline renderer. Exports `MinimalChatView` (props `MinimalChatViewProps`), `statusVisualsFor(status)` → `{ iconPath, colorClass }`, `extractInputPreview(toolName, input)` → preview string. Modes: `inline` (body `h-[60vh]`), `popout` (`h-full`), `row` (single-line, no body). Resolves `MarkdownContent`, `formatTokens`, `formatDuration`, `toolCallStep`, `thinkingBlock` via `useUiPrimitive`/`useUiPrimitiveOrNull`; falls back to inline renderers when primitive absent. Entry kinds: `tool`, `text`, `thinking`, `error`. Single source of truth replacing duplicated timeline UI in `SubagentDetailView` and `FlowAgentDetail`. |
| `types.ts` | Type contracts for `MinimalChatView`. Exports `MinimalChatMode` (`"inline" | "popout" | "row"`), `MinimalChatStatus` (`"pending" | "running" | "complete" | "error" | "blocked"`), `MinimalChatEntry` (discriminated union `tool | text | thinking | error`), `MinimalChatMeta` (`modelName?`, `tokens?`, `durationMs?`), `MinimalChatViewProps`. Producer adapters map plugin-specific state into these structural types at shim boundary. |

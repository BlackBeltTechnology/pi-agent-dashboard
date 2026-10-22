# DOX — packages/client/src/lib/util

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `artifact-view-gate.ts` | Pure viewport gate `openArtifactForViewport(isMobile, ref, handlers)`: non-mobile→`openDialog`, mobile→`navigateToPreview`. Shared by App + unit tests. See change: openspec-artifact-dialog-desktop. |
| `attr-escape.ts` | `attrEscape(value)` escapes `"` and `\` for quoted attribute selectors (jsdom has no `CSS.escape`). See change: add-session-actions-flyout. |
| `clipboard.ts` | Re-export of `copyText` from `@blackbelt-technology/dashboard-plugin-runtime` (impl in runtime `secure-context.ts`). See change: audit-plugin-bundles-non-secure-context. |
| `cwd-visibility.ts` | Pure `isVisibleCwd(cwd, {pinnedDirectories, workspaces, sessions, platform?})`. → see `cwd-visibility.ts.AGENTS.md` |
| `dock-collapsed.ts` | Per-session composer-dock collapsed bit. `loadDockCollapsed`/`saveDockCollapsed`/`useDockCollapsed(sessionId, persist?)` under `pi-dashboard:composer-dock-collapsed:<sessionId>` (`collapsed`; expanded removes the key). Default expanded; empty id or throwing storage never reads/writes/throws; session switch is derived in render (no one-frame flash); `persist=false` (non-live dock) reads only. A peek is not stored. See change: composer-dock-collapse-and-file-open. |
| `folder-encoding.ts` | Base64url encode/decode for cwd paths in URL routes. Exports `encodeFolderPath(cwd)` (UTF-8 safe, URL-safe… → see `folder-encoding.ts.AGENTS.md` |
| `format.ts` | Display formatting utils. `formatTokens` (12400→"12.4k"), `formatMessageTime` (today/yesterday/weekday/full-date HH:MM:SS), `formatRelativeTime` (ms→"3m"/"2h"/"1d"). |
| `fx-visibility.ts` | `observeFx(el)` — IntersectionObserver-based visibility gate returning a disconnect fn (pauses effects/animations off-screen). |
| `lineDelta.ts` | Per-turn +/- line-delta derivation from Edit/Write events (jsdiff `structuredPatch`, no git). → see `lineDelta.ts.AGENTS.md` |
| `link-origin.ts` | Pure browser-safe link path resolution. Exports `resolveLinkOrigin(cwd,path,absolute)`,… → see `link-origin.ts.AGENTS.md` |
| `normalize-path.ts` | `normalizeUnderCwd(rawPath, cwd)`: absolute-under-cwd → relative-posix; else unchanged. Mirrors server `session-diff.ts::normalizePath` so change-summary rows + `openDiffTab` match `data.files` keys. See change: fix-session-diff-open-nongit-and-preview. `isOutOfCwd(rawPath, cwd)`: true when a path is absolute AND not under cwd (residual absoluteness after normalize) — the client suppression signal for out-of-cwd rows. See change: opt-in-out-of-cwd-session-diffs. |
| `parse-host-input.ts` | Pure parser: user-supplied host string → `{ host, port }`. Exports `parseHostInput(input, defaultPort=8000)`. → see `parse-host-input.ts.AGENTS.md` |
| `random-uuid.ts` | Re-export of `randomUuid` from `@blackbelt-technology/dashboard-plugin-runtime` (impl in runtime `secure-context.ts`). See change: audit-plugin-bundles-non-secure-context. |
| `tree-visible.ts` | `useTreeVisible(sessionId)` + load/save. Persists editor-pane rail show/hide boolean under… → see `tree-visible.ts.AGENTS.md` |
| `truncate-path.ts` | Pure middle-truncation of filesystem path. Exports `truncatePathMiddle(path, maxLen)`. → see `truncate-path.ts.AGENTS.md` |

## 1. Pure re-rooting helper (TDD)

- [x] 1.1 Add a browser-safe pure helper `resolveLinkOrigin(cwd, path, absolute)` (new module `packages/client/src/lib/link-origin.ts`) with `stripWorktreeSegment(cwd)` deriving `<parentRoot>` by stripping a trailing `/.worktrees/<slug>` (and `\.worktrees\<slug>`) segment. No `node:path`, no async, no fetch.
- [x] 1.2 Implement the D2 decision table: non-absolute → existing `resolveAgainstCwd`; non-worktree cwd → verbatim; absolute already under `cwd` → verbatim; absolute under `<parentRoot>` → swap prefix `<parentRoot>` → `cwd`; foreign absolute → verbatim. Normalize separators + drive-letter case before the `under()` compare (D-risk: Windows).
- [x] 1.3 Write unit tests (`packages/client/src/lib/__tests__/link-origin.test.ts`) covering every spec scenario: parent-rooted remap, already-worktree no-op, foreign absolute verbatim, non-worktree cwd verbatim, relative passthrough, Windows separators/drive-case. Verify they fail before 1.1/1.2.

## 2. Wire the helper into FileLink

- [x] 2.1 In `packages/client/src/components/tool-renderers/FileLink.tsx`, compute `origin = resolveLinkOrigin(cwd, path, absolute)` once; feed `origin` to the tooltip `title` (replacing the current `resolved`).
- [x] 2.2 Apply D3: change the click handler to call `openFile(origin, line)` (was raw `path`) and pass `origin` to the preview overlay target, so the open-in-editor and preview targets are the worktree copy — not just the tooltip.
- [x] 2.3 Update the `FileLink` doc comment that asserts absolute tokens are "never re-rooted under cwd" to note the worktree origin carve-out (reference the spec requirement).

## 3. Verify

- [x] 3.1 Add/adjust a `FileLink` component test asserting a worktree-session absolute token under `<parentRoot>` opens the re-rooted worktree path via `POST /api/open-editor`, and a foreign absolute token still opens verbatim.
- [x] 3.2 Run `npm test` (client suite green) and `npm run quality:changed`; confirm no regression in existing `tool-output-linkification` / `open-in-editor` tests.

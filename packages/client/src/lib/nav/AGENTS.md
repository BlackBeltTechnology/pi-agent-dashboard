# DOX — packages/client/src/lib/nav

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `back-target.ts` | Pure `computeBackTarget(route): string \| null` — maps route to parent route one shell depth up. → see `back-target.ts.AGENTS.md` |
| `document-title.ts` | Exports `buildDocumentTitle(session, folderCwd?)` — derives `<projectDir>` from `cwd` last segment, composes `"<name> (<dir>) — PI Dashboard"` title. Falls back to folder cwd or `"PI Dashboard"`. |
| `history-back.ts` | Exports `goBack(navigate, currentRoute, tracker)` — depth-aware mobile/overlay back action. → see `history-back.ts.AGENTS.md` |
| `move-tracker.ts` | In-flight package-move state tracker, keyed by `moveId`. Exports `MovePhase`, `MoveState`, `moveTracker`… → see `move-tracker.ts.AGENTS.md` |
| `nav-tracker.ts` | In-app depth-tagged nav stack. `Array<{url, depth}>` via `routeDepth`. → see `nav-tracker.ts.AGENTS.md` |
| `overlay-background.ts` | Route-backed overlay underlay + dismissal target. Exports `captureBackground`, `clearBackground`, `peekBackground`, `resolveBackground`, `recordLauncher`, `resolveDismissTarget`, `isOverlayRoute`, `splitLocation`. Launchers = STACK: overlay→other-surface pushes `from`; arriving on top launcher's surface pops (return ≠ new launch — fixes settings⇄tunnel-setup flip loop). Base-route landing clears stack. See change: add-route-backed-overlay-dialogs, fix-overlay-dismiss-flip-loop. `openspec/archive/:entry` (5 segments) is not an overlay route. See change: resolve-archived-attached-proposal. |
| `route-builders.ts` | URL builders for shell overlay routes: `buildOpenSpecPreviewUrl`, `buildOpenSpecArchiveUrl`,… → see `route-builders.ts.AGENTS.md` |
| `useArchiveRoute.ts` | `useArchiveRoute()` matches `/folder/:cwd/openspec/archive[/:entry[/:artifact]]` → `{cwd, entry?, artifact?}`; shared by App + ShellContent. See change: resolve-archived-attached-proposal. |
| `useTrackedNavigate.ts` | `useTrackedNavigate()` push-navigate that records into the nav tracker so Back returns to the launching view. See change: resolve-archived-attached-proposal. |
| `view-route.ts` | `/view` route helpers: `viewTargetToEditorPath(ViewTarget)` maps a view target to an editor-pane path. See change: open-view-command-in-editor-pane, fold-oversized-agents-directories. |

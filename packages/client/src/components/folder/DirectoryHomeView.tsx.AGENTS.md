# DirectoryHomeView.tsx — index

Directory home page for the bare `/folder/:encodedCwd` route. Centered spawn prompt → `onSpawnSession(cwd, undefined, {initialPrompt})`. Eligibility guard: renders when cwd in `pinnedDirectories` OR in `workspaceFolders: Set<string>`; cold-load loading gate on `pinnedDirectoriesLoaded && workspacesLoaded` (both flags, separate WS messages); else neutral miss notice + pin CTA (`directory-home-not-pinned`). Exports `DirectoryHomeView`, `DirectoryHomeViewProps`. See change: add-directory-home-page, enable-workspace-folder-home-page (workspace-folder eligibility + `workspacesLoaded` gate + de-pinned notice copy).

## fix-popover-pane-bounded-height

- Mounts `PopoverBoundaryProvider value={paneRef}` on its own `directory-home` scroll pane (`flex-1 flex flex-col min-w-0 min-h-0 overflow-auto`), so the focal `CommandInput`'s popovers (composer dropdown, model / thinking selectors) measure the pane instead of the viewport.

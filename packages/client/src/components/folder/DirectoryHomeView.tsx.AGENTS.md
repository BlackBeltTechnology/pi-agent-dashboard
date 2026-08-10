# DirectoryHomeView.tsx — index

Directory home page for the bare `/folder/:encodedCwd` route. Centered spawn prompt → `onSpawnSession(cwd, undefined, {initialPrompt})`. Renders for ANY groupable cwd. Exports `DirectoryHomeView`, `DirectoryHomeViewProps`. See change: add-directory-home-page, enable-workspace-folder-home-page.

See change: redesign-folder-workspace-add-flow — the eligibility guard is REMOVED. Gone: the `pinnedDirectories`/`workspaceFolders`/`pinnedDirectoriesLoaded`/`workspacesLoaded`/`onPinDirectory` props, the cold-load loading gate (`directory-home-loading`), the miss notice + pin CTA (`directory-home-not-pinned`), and the `directoryHome.notPinnedTitle`/`notPinnedBody`/`pinCta` i18n keys. Props are now just `cwd`, `sessions`, `onSpawnSession`, `onSelectSession`, and the quick-action openers. App drops the `workspaceFolderSet` memo + the two loaded flags (`pinnedDirsLoaded`/`workspacesLoaded` and their `useMessageHandler` setters).

## fix-popover-pane-bounded-height

- Mounts `PopoverBoundaryProvider value={paneRef}` on its own `directory-home` scroll pane (`flex-1 flex flex-col min-w-0 min-h-0 overflow-auto`), so the focal `CommandInput`'s popovers (composer dropdown, model / thinking selectors) measure the pane instead of the viewport.

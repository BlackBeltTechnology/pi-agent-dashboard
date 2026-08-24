# DOX — packages/client/src/components/resource

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `ScopedResourceGrid.tsx` | Single wiring for both resource entry points. Exports `ScopedResourceGrid`, `RESOURCE_PAGE_TYPE`, `ResourcePageId`, `isResourcePage`. Reads the scope PRESET off the matched route (`/folder/:cwd/settings/:page` → local+global with filter; else global with `◇ global` pill) and owns the `/pi-resource` file-view navigation, so `SettingsPanel` and `DirectorySettings` no longer hand-assemble the same props or keep rival page→type maps. Caller still owns the `usePiResources` fetch (folder nav counts share it). NOTE: two `ResourceType` unions exist in the repo — use `ResourceCardGrid`'s (`resources-api.ts` omits `agent`). See change: add-route-backed-overlay-dialogs. |
| `resource-tree.tsx` | Activation primitives reused by `ResourceCard`. Exports `ActivationToggle` (`role=switch`) +… → see `resource-tree.tsx.AGENTS.md` |
| `ResourceCard.tsx` | One pi-resource as a card. Exports `ResourceCard`. Scope/source badges, path line, `ActivationToggle`… → see `ResourceCard.tsx.AGENTS.md` |
| `ResourceCardGrid.tsx` | Auto-fill grid of `ResourceCard` for one type. Exports `ResourceCardGrid`, `ResourceType`, `countResources`. → see `ResourceCardGrid.tsx.AGENTS.md` |
| `ResourceGridPanel.tsx` | Loading/error/refresh chrome + `ResourceReloadBanner` around `ResourceCardGrid`. Exports `ResourceGridPanel`. → see `ResourceGridPanel.tsx.AGENTS.md` |
| `ResourceTrustDialog.tsx` | Project-trust dialog for a folder-scope toggle. Exports `ResourceTrustDialog`. → see `ResourceTrustDialog.tsx.AGENTS.md` |

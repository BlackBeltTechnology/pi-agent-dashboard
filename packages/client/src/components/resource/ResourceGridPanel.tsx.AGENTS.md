# ResourceGridPanel.tsx — index

Loading/error/refresh chrome + `ResourceReloadBanner` around `ResourceCardGrid`. Exports `ResourceGridPanel`. Shared by Directory Settings (local+global, filter) + Settings (global-only, `◇ global` pill). Caller owns the `usePiResources` fetch. Folder surface (scopes include `local`) also renders `resource-repo-scope-notice` (the tracked `.pi/settings.json` is shared; each toggle is a whole-file diff), the `resource-toggle-error` banner (`data-kind` server|network), and `ResourceTrustDialog` from `activation.trustPrompt`. See changes: resources-card-tabs, project-scope-disable-global-resources.

New optional `cwd` prop; renders `<ResourcePageSectionSlot resourceType scope cwd>` above the grid (`scope` = surface, folder|global). See change: add-skill-atlas-screen.
Forwards trust prompt `preselected`/`dashboardSource`. See change: mirror-dashboard-trust-to-pi.

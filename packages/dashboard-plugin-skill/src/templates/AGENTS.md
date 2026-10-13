# DOX — packages/dashboard-plugin-skill/src/templates

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `app-client-section.tsx.tmpl` | Client-entry section: lazy `<Pascal>AppRoute` export + optional folder entry. See change: add-project-scoped-apps. |
| `app-folder-entry.tsx.tmpl` | Folder predicate export (`folderHasProjectType/Id`) + state-only `<Pascal>FolderEntry`. See change: add-project-scoped-apps. |
| `app-route.tsx.tmpl` | Lazy route module rendering `<EmbeddedApp>`; scoped apps pass `projectScope`, never a standalone URL. See change: add-project-scoped-apps. |
| `app.tsx.tmpl` | `defineDashboardApp` app (home + `/sub` views), derived from demo-plugin. See change: add-project-scoped-apps. |
| `slot-sections.ts` | Per-slot React stub templates. Exports `SLOT_SECTIONS` (map slot id → `{ componentName, render(ctx) }`), `SLOT_RENDER_ORDER` (stable 10-slot order). Each stub annotates `SlotProps<...>` prop contract. `command-route` reuses `ContentView` component name (claim-only, no extra component). |

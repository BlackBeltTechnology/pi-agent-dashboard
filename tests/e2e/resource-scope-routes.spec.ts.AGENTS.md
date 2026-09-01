# resource-scope-routes.spec.ts — index

S-25 scope × path decision table: the 10 resource destinations (5 global `/settings/<page>` + 5 folder `/folder/<cwd>/settings/<page>`). Asserts each renders exactly one `resource-grid-panel` of the `data-type` its own path names, the URL is unchanged, and the scope preset matches the entry point (folder → `resource-scope-filter`; global → `resource-global-pill`). See change: add-route-backed-overlay-dialogs.

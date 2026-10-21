# editor-pane-tab.tsx — index

`editor-pane-tab` consumers + opener: `findEditorPaneTabClaim(registry,path)`, `useEditorPaneTabClaim`, `EditorPaneTabSlot` (body; `fallback` when unclaimed), `EditorPaneTabLabelSlot`, `openPluginTabRoute(navigate, sessionId, paths[])` (ONE navigation to `/session/<id>/editor?tab=…` with fresh `openNonce`; drops invalid/built-in paths), `pluginTabRouteHref`. See change: add-browser-editor-pane-tab. `renderPaneClaim` wraps body/label in `Suspense fallback={null}` (lazy `module` claims). See change: lazy-plugin-claim-modules.

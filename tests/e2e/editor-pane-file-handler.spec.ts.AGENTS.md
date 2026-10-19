# editor-pane-file-handler.spec.ts — index

L3 plugin file-handler modes in the editor pane (change: add-editor-pane-file-handlers, test-plan F1–F3, F11, F12, X9). Drives the demo-plugin fixture claim `demo/docx` (harness builds with `PI_DASHBOARD_FIXTURE_PLUGINS=1`): textarea handler exposing `data-instance-id` + `window.__demoHandlerMounts` so "same instance" is proven by id + mount counter, not visibility. `report.docx` is seeded/rewritten out of band via `docker exec` in the container and removed in `afterEach`.

F1 tab switch / F2 `layout-mode-closed`→`split` / F3 session switch keep the instance and its edits. F11 save with a `touch` in flight → no `changed-on-disk-banner` after the settle + catch-up windows. F12 out-of-band rewrite → banner; Refresh → `file-handler-guard-dialog`; Cancel keeps banner + edits, confirm remounts (+1 mount). X9 save over a rewrite → `file-handler-conflict-dialog` (edits kept, disk untouched); Save as copy → `report.demo.docx`.

Written, NOT run by the author (the parent runs the harness). See change: add-editor-pane-file-handlers.

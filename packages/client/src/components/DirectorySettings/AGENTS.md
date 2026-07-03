# DOX — packages/client/src/components/DirectorySettings

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `DirectorySettings.tsx` | Directory-scoped settings page. Mirrors SettingsPanel left-nav, mobile hierarchy. Props `{cwd,page,onBack,onViewFile}`. Pages instructions/packages/resources; default packages. Route `/folder/:cwd/settings/:page?`. See change: directory-settings-page-and-scoped-md-editing. |
| `FilePicker.tsx` | Scope-bounded `.md`/`.mdx` candidate picker. Fetches `GET /api/file/md-candidates` (omit cwd = global). Scope chip + substring filter. No free-form path input. See change: directory-settings-page-and-scoped-md-editing. |
| `InstructionsEditorPane.tsx` | Presentational editor pane for Instructions page. Renders file tab, conflict banner, lazy Monaco `MarkdownEditor`, dirty-gated Save Bar. Exports `InstructionsEditorPane`. Split from `InstructionsPage` (container holds state machine, pane holds view). |
| `InstructionsPage.tsx` | Edits markdown. FilePicker + lazy Monaco MarkdownEditor + dirty-gated Save Bar. Reads `GET /api/file/md-read`, writes `POST /api/file/write`. 409 conflict banner (Reload/Overwrite). beforeunload + Confirm on dirty file-switch. Props `{cwd?}`; cwd present = directory scope, absent = global (~/.pi/agent). See change: directory-settings-page-and-scoped-md-editing. |
| `PackagesPage.tsx` | Reuses PackageBrowser scope="local" install/update/uninstall. See change: directory-settings-page-and-scoped-md-editing. |
| `ResourcesPage.tsx` | Browse-only `usePiResources` tree via MergedScopeSection. Click leaf → onViewFile. See change: directory-settings-page-and-scoped-md-editing. |

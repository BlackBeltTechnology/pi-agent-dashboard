# DOX — packages/server/src/editor-keeper

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `keeper-manager.ts` | Server-side helper. Exports `editorIdFromCwd(cwd)` = `sha256(cwd).slice(0,12)`. `createEditorKeeperManager` returns `spawnKeeperFor`, `probe` (sidecar + PID alive + socket present + TCP ready), `writeCommand`, `onChildExit`, `killKeeper`, `discoverExistingKeepers` (4-way adoption sweep). See change: add-editor-keeper-sidecar. |

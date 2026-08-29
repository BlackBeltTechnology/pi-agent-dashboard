# DOX — packages/kb-plugin/src/shared

Files in this directory. One row per source file. See change: add-kb-folder-slot.

| File | Purpose |
|------|---------|
| `kb-plugin-types.ts` | Client⇄server REST contract types. `KbStats {files,chunks,indexed,staleCount,indexing,jobStatus,lastError?}`, `KbConfigResponse` (`config: ResolvedConfig` — the server always returned `loadConfig(cwd)` cast wide; carries `resolvedSources`), `KbConfigPatch`, `KB_PLUGIN_ID`. type-only import KbConfig/ResolvedConfig/SourceConfig from kb engine. TRAP: engine exports TWO `ResolvedSource` — wide `sources.ts` (identity/revision, the public re-export) vs narrow `config.ts` (id/dir/priority) which `ResolvedConfig.resolvedSources` composes; the wire carries the NARROW one. See change: add-kb-folder-slot; fix-kb-settings-reindex-gate. |

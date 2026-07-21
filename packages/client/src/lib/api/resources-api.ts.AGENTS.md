# resources-api.ts — index

Fetch helpers for pi-resource activation (distinct from `packages-api`). Exports `toggleResource(args)` → POST `/api/resources/toggle`, returns `{ok,affectedSessions,status,error}`; `reloadResourceSessions(scope,cwd?)` → POST `/api/resources/reload`, returns `{ok,reloaded,...}`. Never throw on HTTP errors. Types `ResourceScope`/`ResourceType`/`ToggleResourceArgs`. See change: folder-resource-activation-toggle.

# DOX — packages/kb-plugin/src/server

Files in this directory. One row per source file. See change: add-kb-folder-slot.

| File | Purpose |
|------|---------|
| `index.ts` | Server entry `registerPlugin`. Mounts `/api/kb/*` routes via `mountKbRoutes`. Consumes host service `host.knownFolderCwds` for cwd validation; falls back to session cwds. See change: add-kb-folder-slot. |
| `job-registry.ts` | `KbJobRegistry`. Per-cwd reindex coalescing. `start` sets running synchronously; concurrent start coalesced onto in-flight promise. `statusFor` → `idle|running|error`. Failed job retains `error`; later success clears to idle. See change: add-kb-folder-slot. |
| `kb-routes.ts` | `mountKbRoutes(fastify, {knownCwds, registry})`. Routes GET `/api/kb/stats`, POST `/api/kb/reindex`, GET/PUT `/api/kb/config`. Reuses `loadConfig`/`SqliteFtsStore`/`indexSource`/`validateConfig`. Validates cwd ∈ knownCwds (403 else, 400 missing). `countStale` reads `dox-staleness.json` (source-file drift only). `applyConfigPatch` merges path fields over project file, validateConfig then atomic tmp+rename write; sparse merged object persisted (untouched fields round-trip). Reindex session-less (no pi session). See change: add-kb-folder-slot. |

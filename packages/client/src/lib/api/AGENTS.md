# DOX — packages/client/src/lib/api

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `api-context.ts` | React context + module-level store for HTTP API base URL. → see `api-context.ts.AGENTS.md` |
| `browse-api.ts` | Client-side browse API helper for PathPicker → see `browse-api.ts.AGENTS.md` |
| `doctor-api.ts` | Typed `fetchDoctorReport(): Promise<DoctorReport>` against `/api/doctor` via auth-aware fetch wrapper. |
| `fetch-json.ts` | Shared client transport guard. Exports `ApiHttpError` class (`status`, `statusText`, `contentType`,… → see `fetch-json.ts.AGENTS.md` |
| `grep-api.ts` | `grepContents(cwd,q,regex)` → `GET /api/grep`. Returns `GrepMatch[]`. Best-effort. See change: split-editor-workspace. |
| `known-servers-api.ts` | Client fetch helpers for known-servers management. Exports `listKnownServers`, `addKnownServer(host, port,… → see `known-servers-api.ts.AGENTS.md` |
| `live-server-api.ts` | Client helper for live-server REST. `listLiveServers()`, `startLiveServer({host,port,label})` (pre-validates… → see `live-server-api.ts.AGENTS.md` |
| `model-proxy-api.ts` | Fetch helpers for `/api/model-proxy/api-keys` endpoints. Exports `ProxyApiKeyEntry`, `ApiKeysListResult`,… → see `model-proxy-api.ts.AGENTS.md` |
| `pi-core-api.ts` | `fetchPiChangelog(pkg, from, to, signal?)` helper against `/api/pi-core/changelog`. See change: pi-update-whats-new-panel. |
| `providers-api.ts` | Fetch helper for custom-LLM-provider management. Exports `TestProviderInput`, `TestProviderResult`… → see `providers-api.ts.AGENTS.md` |
| `resolve-mention-api.ts` | NEW. Client transport for the lazy resolver. `resolveFileMention(cwd, mention): Promise<{resolved: string\|null, kind?}>` POSTs `/api/file/resolve-mention` via `fetchJson`. `resolved:null` = no in-scope file; a transport failure (5xx/network/non-JSON) THROWS `ApiHttpError` so callers fall back to client-side open (D5), never treat failure as absent. See change: server-side-file-mention-resolution. |
| `resources-api.ts` | Fetch helpers for pi-resource activation (distinct from `packages-api`). → see `resources-api.ts.AGENTS.md` |
| `server-error.ts` | Zone-3 coded-message resolver: server/extension failures `{code,vars?,message?}` → i18n key via `errKeyForCode(code)`; `CodedMessage`. See change: make-all-ui-text-i18n. |
| `server-switch.ts` | `performServerSwitch(target, deps)` — extracted two-phase transaction (stage → commit) from `App.tsx`'s… → see `server-switch.ts.AGENTS.md` |
| `staging-socket.ts` | `openStagingSocket(url, {timeoutMs}): Promise<WebSocket>` — single-settle helper that resolves on first… → see `staging-socket.ts.AGENTS.md` |
| `tools-api.ts` | Client-side fetch helpers for `/api/tools*` (`fetchTools`, `rescanAll`, `rescanOne`, `setOverride`,… → see `tools-api.ts.AGENTS.md` |

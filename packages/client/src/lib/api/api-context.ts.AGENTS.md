# api-context.ts — index

React context + module-level store for HTTP API base URL. Exports `ApiContext`, `useApiBase`, `deriveApiBase` (ws→http origin, `""` when same-origin), `setGlobalApiBase`/`getApiBase` for non-React fetch callers, `VITE_API_URL` build-time default.

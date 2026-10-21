# live-server-manager.ts — index

Live-server-preview allowlist registry + SSRF gate. `createLiveServerManager(preferencesStore)`. `start()` validates via shared `validateLiveTarget` (loopback-only), registers (idempotent by host:port), persists allowlist. `get/list/remove`. Seeds from `preferencesStore.getLiveServers()` on load. See change: improve-content-editor.

`addedBy`: `user` (persisted), `legacy` (persisted, no field; written back without it), `preset` (in-memory, ≤16/session LRU via `startPreset`). `startStatic(cwd,root)` in-memory ≤32/cwd LRU, id `st-…`, never listed. `get` = port only, `getStatic`, `has`, `use` (LRU mark), `setEvictionListener` (server revokes tokens). `ownPorts` option refuses dashboard ports for every port target. See change: improve-canvas-html-and-url-ux.


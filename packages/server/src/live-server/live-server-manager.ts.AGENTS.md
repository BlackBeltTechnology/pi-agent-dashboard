# live-server-manager.ts — index

Live-server-preview allowlist registry + SSRF gate. `createLiveServerManager(preferencesStore)`. `start()` validates via shared `validateLiveTarget` (loopback-only), registers (idempotent by host:port), persists allowlist. `get/list/remove`. Seeds from `preferencesStore.getLiveServers()` on load. See change: improve-content-editor.

# DOX — packages/client/src/chat-embed

Files in this directory. One row per source file. Subpath export `@blackbelt-technology/pi-dashboard-web/chat-embed` (workspace-only, raw `src`). Full contract: `docs/embedding-chat-view.md`.

| File | Purpose |
|------|---------|
| `EmbedProviders.tsx` | `EmbedProviders({apiBase, children})`: `ApiContext` + wouter `Router` + `ThemeProvider` + `MobileProvider` + `SessionAssetsProvider` + `DisplayPrefsProvider`. NO `UiPrimitiveProvider` (caller supplies it), NO `ModelConfigContext` → `ui:model-selector` runs context-less (no favorites/refresh/provider-settings link; caller's list renders). See change: decouple-plugins-from-core. |
| `index.ts` | Curated embed surface: `ChatView`, `CommandInput`, `QueuePanel`, `ChatViewMenu`, headless `useSessionState`/`applySessionMessage`/`createSessionAccumulator`, providers, `UiPrimitiveProvider`. Adds `createHostPrimitiveRegistry` (re-export from `lib/plugins/host-primitives.tsx`) + `EmbedProviders` so embeds stop copying `main.tsx`. See change: add-embeddable-chat-view; decouple-plugins-from-core. |
| `__tests__/embed-providers.test.tsx` | `createHostPrimitiveRegistry()` takes no params, registers exactly `UI_PRIMITIVE_KEYS`; `ui:model-selector` in `EmbedProviders`: lists a,b, `onSelect("p/b")` once, no favorites toggle / refresh / settings link. See change: decouple-plugins-from-core. |

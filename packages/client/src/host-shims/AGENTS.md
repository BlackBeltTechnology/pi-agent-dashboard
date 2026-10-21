# DOX — packages/client/src/host-shims

Files in this directory. One row per source file. Each shim is a rollup `input` of `vite.config.ts`, built as `dist/host/<name>.js` and named by the server's static import map (`shared/.../host-import-map.ts`). Shims re-export the app's OWN module instance (shared chunk) so a runtime plugin and the shell share one React / one runtime.

| File | Purpose |
|------|---------|
| `__tests__/host-shims.test.ts` | Parity: each shim's named exports == package's, same object identities; `runtime.ts` names == `public.ts` names (never the `./host` surface); every import-map target has a shim source. See change: decouple-plugins-from-core. |
| `react-dom-client.ts` | `react-dom/client` shim (`createRoot`, `hydrateRoot`, `version`, default). See change: decouple-plugins-from-core (task 6.3). |
| `react-dom.ts` | `react-dom` shim: explicit named list (React is CJS; `export *` drops names) + default. See change: decouple-plugins-from-core (task 6.3). |
| `react-jsx-runtime.ts` | `react/jsx-runtime` shim (`Fragment`, `jsx`, `jsxs`). See change: decouple-plugins-from-core (task 6.3). |
| `react.ts` | `react` shim: explicit named list + default. See change: decouple-plugins-from-core (task 6.3). |
| `runtime.ts` | `export *` of `dashboard-plugin-runtime/src/public.ts` ONLY. See change: decouple-plugins-from-core (task 6.3). |

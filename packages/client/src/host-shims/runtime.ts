/**
 * Host shim for `@blackbelt-technology/dashboard-plugin-runtime` — built as `dist/host/runtime.js` (rollup `input`, vite.config.ts) and
 * mapped by the host import map. Re-exports the SAME module instance the app bundles, so a runtime
 * plugin and the shell share ONE the dashboard-plugin-runtime. Names are listed explicitly because React ships
 * CJS (`export *` would drop them); `__tests__/host-shims.test.ts` pins parity with the package.
 *
 * See change: decouple-plugins-from-core (task 6.3).
 */
// Public surface ONLY (never `./host`): the import map must not widen the plugin API.
export * from "../../../dashboard-plugin-runtime/src/public.js";

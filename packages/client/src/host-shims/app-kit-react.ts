/**
 * Host shim for `@blackbelt-technology/pi-dashboard-app-kit/react` — built as `dist/host/app-kit-react.js`
 * (rollup `input`, vite.config.ts) and mapped by the host import map. Re-exports the SAME app-kit React module
 * instance the shell bundles (`defineDashboardApp`, `useAppHost`, contexts…), so a runtime app and `<EmbeddedApp>`
 * share ONE `AppHostProvider` context. `export *` is safe: app-kit ships ESM. `__tests__/host-shims.test.ts` pins parity.
 *
 * See change: decouple-plugins-from-core (task 7.1).
 */
// Relative path = the file the app's own alias resolves `…/pi-dashboard-app-kit/react` to (one module instance).
export * from "../../../app-kit/src/react/index.js";

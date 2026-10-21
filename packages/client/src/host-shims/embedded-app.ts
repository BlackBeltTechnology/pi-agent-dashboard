/**
 * Host shim for `@blackbelt-technology/dashboard-plugin-runtime/embedded-app` — built as `dist/host/embedded-app.js`
 * (rollup `input`, vite.config.ts) and mapped by the host import map. Re-exports the SAME `<EmbeddedApp>` module
 * the shell bundles, so a runtime `shell-overlay-route` claim shares the shell's app-kit host, wouter router and React.
 * Named exports only (the module has no default).
 *
 * See change: decouple-plugins-from-core (task 7.1).
 */
export { EmbeddedApp, type EmbeddedAppProps } from "../../../dashboard-plugin-runtime/src/embedded-app.js";

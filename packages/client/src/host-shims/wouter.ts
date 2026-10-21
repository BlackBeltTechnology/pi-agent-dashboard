/**
 * Host shim for `wouter` — built as `dist/host/wouter.js` (rollup `input`, vite.config.ts) and mapped by the host
 * import map. Re-exports the SAME wouter module instance the shell bundles, so a runtime app's `<Route>`/`useLocation`
 * read the router context `<EmbeddedApp>` provides (a second copy would see no context). `export *` is safe: wouter
 * ships ESM; `__tests__/host-shims.test.ts` pins parity.
 *
 * See change: decouple-plugins-from-core (task 7.1).
 */
export * from "wouter";

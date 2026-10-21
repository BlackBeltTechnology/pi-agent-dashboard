/**
 * Host shim for `react/jsx-runtime` — built as `dist/host/react-jsx-runtime.js` (rollup `input`, vite.config.ts) and
 * mapped by the host import map. Re-exports the SAME module instance the app bundles, so a runtime
 * plugin and the shell share ONE react/jsx-runtime. Names are listed explicitly because React ships
 * CJS (`export *` would drop them); `__tests__/host-shims.test.ts` pins parity with the package.
 *
 * See change: decouple-plugins-from-core (task 6.3).
 */
export { Fragment, jsx, jsxs } from "react/jsx-runtime";

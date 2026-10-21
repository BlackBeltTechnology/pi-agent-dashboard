/**
 * Host shim for `react-dom/client` — built as `dist/host/react-dom-client.js` (rollup `input`, vite.config.ts) and
 * mapped by the host import map. Re-exports the SAME module instance the app bundles, so a runtime
 * plugin and the shell share ONE react-dom/client. Names are listed explicitly because React ships
 * CJS (`export *` would drop them); `__tests__/host-shims.test.ts` pins parity with the package.
 *
 * See change: decouple-plugins-from-core (task 6.3).
 */
import ReactDOMClient from "react-dom/client";

export default ReactDOMClient;
export { createRoot, hydrateRoot } from "react-dom/client";

// `version` is present at runtime but absent from @types/react-dom/client.
export const version = (ReactDOMClient as unknown as { version: string }).version;

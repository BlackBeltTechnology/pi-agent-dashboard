/**
 * Host shim for `react-dom` — built as `dist/host/react-dom.js` (rollup `input`, vite.config.ts) and
 * mapped by the host import map. Re-exports the SAME module instance the app bundles, so a runtime
 * plugin and the shell share ONE react-dom. Names are listed explicitly because React ships
 * CJS (`export *` would drop them); `__tests__/host-shims.test.ts` pins parity with the package.
 *
 * See change: decouple-plugins-from-core (task 6.3).
 */
import ReactDOM from "react-dom";

export default ReactDOM;

// Present at runtime but absent from @types/react-dom: read off the same module object.
export const __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = (ReactDOM as unknown as Record<string, unknown>).__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
export {
  createPortal,
  flushSync,
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preload,
  preloadModule,
  requestFormReset,
  unstable_batchedUpdates,
  useFormState,
  useFormStatus,
  version,
} from "react-dom";

/**
 * Host shim for `react` — built as `dist/host/react.js` (rollup `input`, vite.config.ts) and
 * mapped by the host import map. Re-exports the SAME module instance the app bundles, so a runtime
 * plugin and the shell share ONE react. Names are listed explicitly because React ships
 * CJS (`export *` would drop them); `__tests__/host-shims.test.ts` pins parity with the package.
 *
 * See change: decouple-plugins-from-core (task 6.3).
 */
import React from "react";

export default React;

// Present at runtime but absent from @types/react: read off the same React object.
const untyped = React as unknown as Record<string, unknown>;
export const __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = untyped.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
export const __COMPILER_RUNTIME = untyped.__COMPILER_RUNTIME;
export const unstable_useCacheRefresh = untyped.unstable_useCacheRefresh;
export {
  Activity,
  act,
  Children,
  Component,
  cache,
  cacheSignal,
  captureOwnerStack,
  cloneElement,
  createContext,
  createElement,
  createRef,
  Fragment,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  startTransition,
  use,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} from "react";

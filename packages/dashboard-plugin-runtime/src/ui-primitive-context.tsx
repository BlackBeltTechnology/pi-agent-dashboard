/**
 * UI primitive registry — React context provider + lookup hooks.
 *
 * Pairs with `ui-primitive-registry.ts`. The dashboard wraps `<App>` in
 * `<UiPrimitiveProvider value={registry}>`; plugin slot contributions call
 * `useUiPrimitive(key)` to look up impls.
 *
 * See change: add-plugin-ui-primitive-registry.
 */

import type {
  UiPrimitiveKey,
  UiPrimitiveMap,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import React, { createContext, type ReactNode, useContext } from "react";
import { getUiPrimitiveImpl, type UiPrimitiveRegistry } from "./ui-primitive-registry.js";

const UiPrimitiveContext = createContext<UiPrimitiveRegistry | null>(null);

export interface UiPrimitiveProviderProps {
  value: UiPrimitiveRegistry;
  children: ReactNode;
}

/**
 * Provides a `UiPrimitiveRegistry` to descendant components. Every plugin
 * slot contribution must be a descendant of one of these. The dashboard
 * mounts exactly one provider, around `<App>`, in `packages/client/src/main.tsx`.
 */
export function UiPrimitiveProvider({ value, children }: UiPrimitiveProviderProps) {
  return <UiPrimitiveContext.Provider value={value}>{children}</UiPrimitiveContext.Provider>;
}

function useRegistryFromContext(): UiPrimitiveRegistry {
  const reg = useContext(UiPrimitiveContext);
  if (!reg) {
    throw new Error(
      "useUiPrimitive must be called inside <UiPrimitiveProvider>. The dashboard's " +
        "main.tsx wraps <App> in this provider; plugin slot contributions are " +
        "automatically descendants. If you're seeing this error in a test, wrap your " +
        "rendered tree in withUiPrimitiveProvider({ ... }) from " +
        "@blackbelt-technology/dashboard-plugin-runtime/test-support.",
    );
  }
  return reg;
}

/**
 * Look up a registered UI primitive by key. STRICT — throws a clear error
 * if the key is not registered.
 *
 * Use this for primitives that the dashboard is required to provide. Plugin
 * authors typically reach for this hook because a missing primitive
 * indicates a bug (the dashboard's main.tsx forgot to register it), not a
 * graceful-degradation case.
 *
 * Per-claim error boundaries (see `slot-error-boundary.tsx`) catch the
 * throw and isolate the failing claim. Sibling slot contributions render
 * unaffected.
 *
 * Public host API (`public.ts`): trusted plugin client code (bundled or
 * runtime-loaded) may call this directly; intents remain the path for bridge-
 * or server-originated UI. See change: decouple-plugins-from-core (D8).
 *
 * @example
 *   function FlowAgentDetail({ agent }) {
 *     const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
 *     return <MarkdownContent content={agent.summary} />;
 *   }
 */
export function useUiPrimitive<K extends UiPrimitiveKey>(key: K): UiPrimitiveMap[K] {
  const reg = useRegistryFromContext();
  const impl = getUiPrimitiveImpl(reg, key);
  if (impl === undefined) {
    throw new Error(
      `UI primitive "${key}" is not registered. The dashboard's main.tsx is ` +
        "missing a registerUiPrimitive(registry, key, impl) call for this key. " +
        "If this is a test, ensure withUiPrimitiveProvider({ ... }) includes the key.",
    );
  }
  return impl;
}

/**
 * Look up a registered UI primitive by key. SOFT — returns `null` if the
 * key is not registered.
 *
 * Use this only when the plugin has a meaningful fallback (e.g. render
 * plain text instead of markdown). Most primitives should use the strict
 * hook so missing registrations surface as build/test errors rather than
 * blank UI.
 *
 * Like the strict hook, throws if called outside a `<UiPrimitiveProvider>`.
 */
export function useUiPrimitiveOrNull<K extends UiPrimitiveKey>(key: K): UiPrimitiveMap[K] | null {
  const reg = useRegistryFromContext();
  const impl = getUiPrimitiveImpl(reg, key);
  return impl === undefined ? null : impl;
}

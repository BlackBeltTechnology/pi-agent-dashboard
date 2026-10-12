/**
 * Test helper: wrap a render in a UiPrimitiveProvider with mock impls.
 *
 * Plugin tests that render components calling `useUiPrimitive(key)` need a
 * provider in scope. This helper builds an ad-hoc registry, registers any
 * impls the caller supplies, and wraps the children. Keys NOT supplied in
 * `partialImpls` are unregistered — strict-hook lookups will throw, soft-hook
 * lookups return null (matches production behavior on missing registrations).
 *
 * Usage in a test:
 *   render(
 *     withUiPrimitiveProvider(
 *       { "ui:markdown-content": MockMarkdown },
 *       <FlowAgentDetail agent={fakeAgent} />,
 *     ),
 *   );
 *
 * See change: add-plugin-ui-primitive-registry.
 */

import {
  UI_PRIMITIVE_KEYS,
  type UiPrimitiveKey,
  type UiPrimitiveMap,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type React from "react";
import type { ReactNode } from "react";
import { UiPrimitiveProvider } from "../ui-primitive-context.js";
import {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
} from "../ui-primitive-registry.js";

/**
 * Wrap `children` in a `<UiPrimitiveProvider>` populated with the provided
 * impls. Keys absent from `partialImpls` remain unregistered so the test
 * matches production semantics for missing registrations (strict-hook throw,
 * soft-hook null).
 */
export function withUiPrimitiveProvider(
  partialImpls: Partial<UiPrimitiveMap>,
  children: ReactNode,
): React.ReactElement {
  const registry = createUiPrimitiveRegistry();

  // Iterate the canonical key set so impls are registered exactly once each
  // (avoids unintended duplication if the caller's object has stray keys).
  for (const key of Object.values(UI_PRIMITIVE_KEYS) as UiPrimitiveKey[]) {
    const impl = partialImpls[key];
    if (impl !== undefined) {
      // Type-narrowed: the value at partialImpls[key] is UiPrimitiveMap[key].
      registerUiPrimitive(registry, key, impl as UiPrimitiveMap[typeof key]);
    }
  }

  return <UiPrimitiveProvider value={registry}>{children}</UiPrimitiveProvider>;
}

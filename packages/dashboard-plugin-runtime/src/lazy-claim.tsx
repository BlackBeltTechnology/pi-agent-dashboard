/**
 * `lazyClaim` — memoized `React.lazy` for a plugin claim whose component lives
 * in its own `module` (manifest `claims[].module`).
 *
 * The generated plugin registry binds `Component` to `lazyClaim(() =>
 * import("<module>"), "<component>")`. The module is fetched the first time
 * the claim renders, at most once per page; rendering sites wrap claims in a
 * `Suspense` boundary nested inside the per-claim error boundary.
 *
 * See change: lazy-plugin-claim-modules.
 */
import React from "react";

type Loader = () => Promise<Record<string, unknown>>;
type ClaimComponent = React.ComponentType<Record<string, unknown>>;

// Keyed by loader identity (a distinct `() => import(...)` arrow per claim),
// then export name — two claims that share one module still get one fetch
// because dynamic `import()` is itself cached by the module system.
const cache = new WeakMap<Loader, Map<string, ClaimComponent>>();

export function lazyClaim(load: Loader, name: string): ClaimComponent {
  let byName = cache.get(load);
  if (!byName) {
    byName = new Map();
    cache.set(load, byName);
  }
  let comp = byName.get(name);
  if (!comp) {
    comp = React.lazy(() =>
      load().then((m) => {
        const c = m[name];
        if (typeof c !== "function" && (typeof c !== "object" || c === null)) {
          throw new Error(`[lazyClaim] module does not export component "${name}"`);
        }
        return { default: c as ClaimComponent };
      }),
    );
    byName.set(name, comp);
  }
  return comp;
}

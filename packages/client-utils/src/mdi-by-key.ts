/**
 * Lazy MDI icon-by-key resolver.
 *
 * Resolving an icon from a runtime key string (`"mdiRefresh"`) needs the FULL
 * `@mdi/js` namespace (~2.78 MB raw), which must stay off the cold landing
 * load (iOS Safari WebContent memory kills, #712). The set is fetched on
 * demand, the first time a key is resolved, and shared by every resolver.
 *
 * The dynamic import targets `@mdi/js/commonjs/mdi.js` — a DISTINCT module
 * identity from the `@mdi/js` ESM entry that named imports use. Rollup cannot
 * split one module across chunks, so importing `@mdi/js` itself would keep the
 * whole namespace in the eager graph.
 *
 * While loading, and for unknown keys, resolvers return `null` (render
 * nothing). A failed import resolves to `null` and clears the memo, so a
 * later call retries.
 *
 * See change: harden-ios-safari-memory-and-ws-diagnostics (design D1).
 */
import { useEffect, useState } from "react";

type IconSet = Record<string, unknown>;
type Importer = () => Promise<unknown>;

const defaultImporter: Importer = () => import("@mdi/js/commonjs/mdi.js");

let importer: Importer = defaultImporter;
let loaded: IconSet | null = null;
let pending: Promise<IconSet | null> | null = null;

/** Load (once) and return the full icon set, or `null` if the import failed. */
export function loadMdiIconSet(): Promise<IconSet | null> {
  if (loaded) return Promise.resolve(loaded);
  if (pending) return pending;
  pending = importer().then(
    (mod) => {
      const m = mod as { default?: unknown };
      const set = (m && typeof m.default === "object" && m.default !== null ? m.default : mod) as IconSet;
      loaded = set;
      return set;
    },
    () => {
      pending = null; // retry on the next call
      return null;
    },
  );
  return pending;
}

/** Synchronous lookup: the SVG path if the set is loaded and the key is known, else `null`. */
export function resolveMdiIconSync(key: string | undefined | null): string | null {
  if (!loaded || !key || typeof key !== "string" || !key.startsWith("mdi")) return null;
  const path = loaded[key];
  return typeof path === "string" && path.length > 0 ? path : null;
}

/** Hook: resolves `key`, triggering the lazy load and re-rendering once it lands. */
export function useMdiIconByKey(key: string | undefined | null): string | null {
  const [, setTick] = useState(0);
  const path = resolveMdiIconSync(key);
  const needsLoad = !loaded && !!key;
  useEffect(() => {
    if (!needsLoad) return;
    let alive = true;
    void loadMdiIconSet().then((set) => {
      if (alive && set) setTick((t) => t + 1);
    });
    return () => {
      alive = false;
    };
  }, [needsLoad]);
  return path;
}

/** Test seam: replace the dynamic importer. */
export function __setMdiIconSetImporterForTests(fn: Importer): void {
  importer = fn;
}

/** Test seam: forget the loaded set and restore the real importer. */
export function __resetMdiIconSetForTests(): void {
  importer = defaultImporter;
  loaded = null;
  pending = null;
}

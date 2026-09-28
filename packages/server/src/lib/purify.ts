/**
 * Shared lazy loader for server-side DOMPurify (`isomorphic-dompurify`).
 *
 * Lazy: the package builds a jsdom window at import time, so a broken jsdom
 * install fails one sanitize request instead of server boot.
 *
 * Native `require`: under the server's `node --import jiti-register` loader, a
 * dynamic `import()` routes jsdom's CommonJS through jiti, which breaks jsdom's
 * interfaces.js <-> create-element.js require cycle
 * (`interfaces.getInterfaceWrapper is not a function`). `createRequire`
 * bypasses the ESM hook and keeps Node's native CJS cycle semantics.
 */
import { createRequire } from "node:module";

type DomPurify = (typeof import("isomorphic-dompurify"))["default"];

const nativeRequire = createRequire(import.meta.url);
let cached: DomPurify | null = null;

export async function loadPurify(): Promise<DomPurify> {
  if (cached) return cached;
  const mod = nativeRequire("isomorphic-dompurify") as { default?: DomPurify } & DomPurify;
  const purify = mod.default ?? mod;
  // Never cache a half-initialised instance: retry on the next call instead.
  if (typeof purify?.sanitize !== "function") {
    throw new Error("DOMPurify unavailable: sanitize() missing (jsdom failed to initialise)");
  }
  cached = purify;
  return purify;
}

// Pure tier selector for the Node-native TypeScript loader (design D4). No side
// effects, so tests can import it with a stubbed `node:module`.
//
//   tier 1: registerHooks + stripTypeScriptTypes   (22.15+, 23.5+)  sync, in-thread
//   tier 2: register      + stripTypeScriptTypes   (23.2-23.4)      async, off-thread
//   tier 3: register      + bundled amaro          (23.0-23.1)      no native stripper
//
// See change: strip-only-native-ts-loader.

/** @param {{ registerHooks?: unknown, stripTypeScriptTypes?: unknown }} mod @returns {1 | 2 | 3} */
export function selectLoaderTier(mod) {
  const hasHooks = typeof mod.registerHooks === "function";
  const hasStrip = typeof mod.stripTypeScriptTypes === "function";
  if (hasHooks && hasStrip) return 1;
  if (hasStrip) return 2;
  return 3;
}

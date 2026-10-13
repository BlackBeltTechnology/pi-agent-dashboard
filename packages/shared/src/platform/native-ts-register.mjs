// Node-native TypeScript loader — the dashboard server's `--import` loader.
// Strips types (strip-only) and registers the resolve/load hooks in
// `native-ts-hooks.mjs` on the best API this Node offers (tier, design D4):
// `module.registerHooks` (sync, in-thread), else `module.register` with the
// native stripper, else `module.register` with the bundled `amaro` (EOL 23.0-23.1).
// No transpile cache, so a read-only bundle (FUSE-mounted AppImage) boots as
// fast as a writable one.
//
// Plain `.mjs` on purpose: it runs before any TypeScript loader exists.
// See change: fix-appimage-cold-boot-latency (design D3);
//             strip-only-native-ts-loader (design D4).
import nodeModule from "node:module";
import { loadSync, resolveSync } from "./native-ts-hooks.mjs";
import { selectLoaderTier } from "./native-ts-tier.mjs";

const tier = selectLoaderTier(nodeModule);
// The tier names the registration API it needs; fail with a readable message when
// that exact API is missing (never happens inside the engines range).
if (typeof (tier === 1 ? nodeModule.registerHooks : nodeModule.register) !== "function") {
  throw new Error(
    `pi-dashboard: this Node (${process.version}) lacks the module hook registration API ` +
      "(module.registerHooks / module.register) the native TypeScript loader needs. Use a supported Node (>=22.19.0 <27).",
  );
}

if (tier === 1) {
  nodeModule.registerHooks({ resolve: resolveSync, load: loadSync });
} else {
  nodeModule.register("./native-ts-hooks.mjs", import.meta.url, { data: { tier } });
}

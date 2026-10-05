// Node-native TypeScript loader — the dashboard server's default `--import`
// loader (opt out with PI_DASHBOARD_TS_LOADER=jiti). Registers the
// resolve/load hooks in `native-ts-hooks.mjs`. No transpile cache, so a
// read-only bundle (FUSE-mounted AppImage) boots as fast as a writable one.
//
// Plain `.mjs` on purpose: it runs before any TypeScript loader exists.
// See change: fix-appimage-cold-boot-latency (design D3).
import nodeModule from "node:module";

if (typeof nodeModule.stripTypeScriptTypes !== "function") {
  throw new Error(
    `pi-dashboard: this Node (${process.version}) lacks module.stripTypeScriptTypes, ` +
      "which the native TypeScript loader needs. Use Node >= 22.13, or set " +
      "PI_DASHBOARD_TS_LOADER=jiti to boot with the jiti loader.",
  );
}

nodeModule.register("./native-ts-hooks.mjs", import.meta.url);

import { defineConfig } from "vite";
import { builtinModules } from "node:module";

const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  "electron",
];

export default defineConfig({
  build: {
    outDir: ".vite/build",
    lib: {
      entry: "src/preload.ts",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: nodeExternals,
      // Pin the `.js` filename. Forge 8's Vite plugin defaults preload output to
      // `[name].cjs`, but main.ts / remote-connect-window.ts load `preload*.js`
      // and silently run with NO preload when the file is missing. The plugin
      // merges this user config last, so the pin wins. Vite 6 warns "Unknown
      // output options: codeSplitting" for the plugin's Rolldown-only option;
      // harmless (single chunk, no dynamic imports).
      // See change: refresh-electron-bundled-components (design D2).
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
});

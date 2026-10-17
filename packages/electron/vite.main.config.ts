import { defineConfig } from "vite";
import { builtinModules } from "node:module";

// Externalize all Node.js builtins (node:fs, node:path, etc.) and Electron
const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  "electron",
  "electron-updater",
];

export default defineConfig({
  // `ws` is bundled (operator browser host shim). Vite stubs its optional peer
  // deps `bufferutil` / `utf-8-validate` as an EMPTY object, which ws would then
  // call (`unmask is not a function`). Statically disable them → pure-JS path.
  // See change: add-operator-browser-relay.
  define: {
    "process.env.WS_NO_BUFFER_UTIL": '"1"',
    "process.env.WS_NO_UTF_8_VALIDATE": '"1"',
  },
  build: {
    outDir: ".vite/build",
    lib: {
      entry: "src/main.ts",
      formats: ["es"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      external: nodeExternals,
    },
  },
});

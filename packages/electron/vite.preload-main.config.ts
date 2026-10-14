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
      entry: "src/preload-main.ts",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: nodeExternals,
    },
  },
});

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Minimal Vitest config for the Astro marketing site. Mirrors the `~` -> src
// path alias from tsconfig.json so unit tests resolve the same imports the
// Astro/Vite build uses (e.g. github-release.ts -> ~/data/latest-release.json).
export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Don't load site/tsconfig.json (it `extends astro/tsconfigs/strict`, which
  // is only resolvable after a full install). Tests don't need those options.
  esbuild: { tsconfigRaw: "{}" },
  test: {
    environment: "node",
    include: ["src/**/__tests__/*.test.ts"],
  },
});

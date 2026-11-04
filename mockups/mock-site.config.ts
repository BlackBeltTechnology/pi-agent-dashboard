// pi-agent-dashboard mock site: real client components in Current | Proposed frames.
// Run: serve_mock_site{} (or `npm run mocks`). Isolated port 5299, never 8000.
// Installed consumers import "@blackbelt-technology/frontend-mockup-loop/src/mock-site/plugin.mjs";
// this repo ships that package, so it imports the source path.
// See change: add-live-component-mock-site (design D2, D8).
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mockSite } from "../packages/mockup-loop/src/mock-site/plugin.mjs";

const repo = path.resolve(__dirname, "..");
const pkg = (p: string) => path.join(repo, "packages", p);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    mockSite({
      projectRoot: repo,
      appRoot: pkg("client"),
      title: "Dashboard mocks",
      app: "./mock-site.app.tsx",
      // First entry is the default; "system" follows prefers-color-scheme like the dashboard (useTheme).
      themes: [
        { id: "system", label: "System", system: { dark: "dark", light: "light" } },
        { id: "dark", label: "Dark", attrs: { "data-theme": null } },
        { id: "light", label: "Light", attrs: { "data-theme": "light" } },
      ],
      // Mirrors packages/client/vite.config.ts resolve.alias (app-kit/react before app-kit).
      aliases: {
        "@app": pkg("client/src"),
        // Plugin sources for plugin-surface mocks (package `exports` block deep imports).
        "@flows": pkg("flows-plugin/src"),
        "@blackbelt-technology/pi-dashboard-shared": pkg("shared/src"),
        "@blackbelt-technology/pi-dashboard-client-utils": pkg("client-utils/src"),
        "@blackbelt-technology/pi-dashboard-app-kit/react": pkg("app-kit/src/react/index.ts"),
        "@blackbelt-technology/pi-dashboard-app-kit": pkg("app-kit/src/index.ts"),
      },
    }),
  ],
  build: { target: "es2022" },
  esbuild: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});

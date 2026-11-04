// GENERIC site config + PROJECT values (MOCK_CONFIG block). Isolated port, never 8000.
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// ---- project values (would live in mockup.config.ts) ----
const APP_ROOT = "/Users/bmiller/Projects/Pi-Packages/pi-agent-dashboard";
const MOCK_CONFIG = {
  title: "Dashboard mocks",
  // First entry is the default. "system" follows prefers-color-scheme, like the dashboard's own default.
  themes: [
    { id: "system", label: "System", system: { dark: "dark", light: "light" } },
    { id: "dark", label: "Dark", attrs: { "data-theme": null } },
    { id: "light", label: "Light", attrs: { "data-theme": "light" } },
  ],
};
const PORT = 5299;
// ----------------------------------------------------------

const here = path.dirname(new URL(import.meta.url).pathname);
const decisionsFile = path.join(here, "mocks/decisions.json");

/** Accept/Reject endpoint: writes frame decisions to mocks/decisions.json (git-visible). */
function mockDecisions(): Plugin {
  return {
    name: "mock-decisions",
    resolveId: (id) => (id === "virtual:mock-config" ? "\0mock-config" : null),
    load: (id) => (id === "\0mock-config" ? `export const MOCK_CONFIG = ${JSON.stringify(MOCK_CONFIG)};` : null),
    configureServer(server) {
      // Agent decisions (CLI edits decisions.json) push live to every open tab.
      server.watcher.add(decisionsFile);
      server.watcher.on("change", (f) => { if (f === decisionsFile) server.ws.send({ type: "custom", event: "mock:decisions" }); });
      server.middlewares.use("/__mock/decisions", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(fs.existsSync(decisionsFile) ? fs.readFileSync(decisionsFile) : "{}");
      });
      server.middlewares.use("/__mock/decide", (req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const { key, status, note } = JSON.parse(body);
          const d = fs.existsSync(decisionsFile) ? JSON.parse(fs.readFileSync(decisionsFile, "utf8")) : {};
          if (status === "open") delete d[key]; else d[key] = { status, by: "user", ...(note ? { note } : {}), at: new Date().toISOString() };
          fs.writeFileSync(decisionsFile, JSON.stringify(d, null, 2) + "\n");
          res.end("ok");
        });
      });
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss(), mockDecisions()],
  resolve: {
    alias: {
      "@app": path.join(APP_ROOT, "packages/client/src"),
      "@blackbelt-technology/pi-dashboard-shared": path.join(APP_ROOT, "packages/shared/src"),
      "@blackbelt-technology/pi-dashboard-client-utils": path.join(APP_ROOT, "packages/client-utils/src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: { port: PORT, strictPort: true, host: true, fs: { allow: [here, APP_ROOT] } },
  build: { target: "es2022" },
  esbuild: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});

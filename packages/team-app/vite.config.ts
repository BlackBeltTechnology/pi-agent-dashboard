import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { aliases } from "./vite.aliases";

// Same-origin build served by team-plugin at /apps/team/ (D14): base is fixed
// in every deployment. Proxy /api + /ws to a running dashboard in dev.
const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://localhost:8000";

export default defineConfig({
  base: "/apps/team/",
  plugins: [react({ include: [/\.[tj]sx?$/] }), tailwindcss()],
  resolve: { alias: aliases, dedupe: ["react", "react-dom", "wouter"] },
  server: {
    proxy: {
      "/ws": { target: DASHBOARD_URL, ws: true, changeOrigin: true },
      "/api": { target: DASHBOARD_URL, changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  root: path.resolve(__dirname),
});

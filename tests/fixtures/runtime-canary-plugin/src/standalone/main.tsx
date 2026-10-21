/**
 * Standalone half of the canary app ("one app, two builds"): the SAME `canaryApp` served by `ctx.serveApp` at
 * `/apps/runtime-canary/`, with its OWN React and the app-kit standalone host (`mode: "standalone"`,
 * `capabilities.dashboard: false`). Built by `scripts/build-runtime-canary.mjs` into `dist/standalone/`.
 */
import { AppHostProvider, createStandaloneHost } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { canaryApp } from "../client/canary-app.js";

const BASE = "/apps/runtime-canary";
const App = canaryApp.App;

async function main(): Promise<void> {
  const host = await createStandaloneHost({ appId: "runtime-canary", basePath: BASE, config: {} });
  createRoot(document.getElementById("root") as HTMLElement).render(
    <AppHostProvider host={host}>
      <Router base={BASE}>
        <App />
      </Router>
    </AppHostProvider>,
  );
}

void main();

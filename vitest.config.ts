import { defineConfig } from "vitest/config";

/**
 * Root Vitest config (Vitest 4+).
 *
 * Vitest 4 dropped `vitest.workspace.ts` support — projects must live under
 * `test.projects` here. Each entry points at a per-package vitest.config.ts
 * which carries the package-specific `environment` (jsdom for client, node
 * for server/shared/extension), include globs, and pool settings.
 */
export default defineConfig({
  test: {
    projects: [
      "packages/shared",
      "packages/document-converter",
      "packages/session-distiller",
      "packages/server",
      "packages/extension",
      "packages/image-fit-extension",
      "packages/mockup-loop",
      "packages/client",
      "packages/client-utils",
      "packages/dashboard-plugin-runtime",
      "packages/automation-plugin",
      "packages/flows-plugin",
      "packages/flows-anthropic-bridge-plugin",
      "packages/roles-plugin",
      "packages/subagents-plugin",
      "scripts",
      // NOTE: packages/electron is intentionally NOT included here — it has
      // pre-existing orphaned tests that depend on ambient PATH/mocks never
      // wired up. Offline-packages tests are runnable via
      // `cd packages/electron && npm test`. Bringing electron into the
      // main run is tracked as a separate cleanup.
    ],
  },
});

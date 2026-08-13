import { defineConfig } from "vitest/config";

/**
 * Root Vitest config (Vitest 4+).
 *
 * Vitest 4 dropped `vitest.workspace.ts` support — projects must live under
 * `test.projects` here. Each entry points at a per-package vitest.config.ts
 * which carries the package-specific `environment` (jsdom for client, node
 * for server/shared/extension), include globs, and pool settings.
 *
 * `globalSetup` lives HERE, at root, on purpose: it reconciles leftovers from a
 * killed mutation-harness run, and must complete before ANY project fork loads
 * a source file. Projects run concurrently, so a per-project reconcile would
 * race them. See scripts/mutation-journal-global-setup.mjs.
 */
export default defineConfig({
  test: {
    globalSetup: ["./scripts/mutation-journal-global-setup.mjs"],
    projects: [
      "packages/shared",
      "packages/bus-client",
      "packages/document-converter",
      // kb + kb-extension carry the retrieval contract (source dedup, lane quota,
      // condensed render, kb_get truncation) and were previously collected by no
      // project. See change: fix-kb-search-retrieval-quality.
      "packages/kb",
      "packages/kb-extension",
      "packages/session-distiller",
      "packages/server",
      "packages/extension",
      "packages/image-fit-extension",
      "packages/mockup-loop",
      "packages/nano-banana",
      "packages/video-production",
      "packages/video-transcription",
      "packages/client",
      "packages/client-utils",
      "packages/shell",
      "packages/dashboard-plugin-runtime",
      "packages/automation-plugin",
      "packages/flows-plugin",
      "packages/flows-anthropic-bridge-plugin",
      "packages/roles-plugin",
      "packages/subagents-plugin",
      "packages/goal-plugin",
      "packages/blackhole-plugin",
      "scripts",
      // ship-it's pure decision helpers. Added by wire-local-review-gate: they
      // gate real ship decisions but were collected by no project before.
      ".pi/skills/ship-it",
      // NOTE: packages/electron is intentionally NOT included here — it has
      // pre-existing orphaned tests that depend on ambient PATH/mocks never
      // wired up. Offline-packages tests are runnable via
      // `cd packages/electron && npm test`. Bringing electron into the
      // main run is tracked as a separate cleanup.
    ],
  },
});

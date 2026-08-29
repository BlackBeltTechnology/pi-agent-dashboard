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
      // Pure payload-accounting helpers. The meter itself needs a live pi turn,
      // but the attribution/diff/budget math is unit-tested here — it is what
      // catches a context trim that applied cleanly and changed nothing.
      "packages/context-budget",
      "packages/session-distiller",
      "packages/cost-estimator",
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
      "packages/grammar-plugin",
      // kb-plugin carries the KB folder slot's state→menu-item contract; it was
      // collected by no project, so its suite never ran. A gate no CI job runs
      // is not a gate. See change: move-slot-actions-to-menu.
      "packages/kb-plugin",
      "packages/blackhole-plugin",
      "packages/mcp-server-plugin",
      "scripts",
      // Pure helpers under tests/e2e/helpers/. NOT the Playwright specs — the
      // project's include glob is scoped to `e2e/helpers/__tests__/`. Added
      // because the evidence-path resolver is used only by opt-in specs, so
      // normal CI could never execute it. See issue #549.
      "tests",
      // ship-it's pure decision helpers. Added by wire-local-review-gate: they
      // gate real ship decisions but were collected by no project before.
      ".pi/skills/ship-it",
      // NOTE: packages/electron as a WHOLE is intentionally NOT included here
      // — it has pre-existing orphaned tests that depend on ambient PATH/mocks
      // never wired up. Offline-packages tests are runnable via
      // `cd packages/electron && npm test`. Bringing electron into the
      // main run is tracked as a separate cleanup.
      //
      // Its BUILD-CONTRACT tests are the exception: they pin the shipped
      // Electron version, the macOS support floor and the update-stream gate,
      // and a gate no CI job runs is not a gate. That config collects a
      // hand-listed set of pure config/predicate tests with no ambient deps.
      // See change: upgrade-electron-runtime.
      "packages/electron/vitest.build-contract.config.ts",
    ],
  },
});

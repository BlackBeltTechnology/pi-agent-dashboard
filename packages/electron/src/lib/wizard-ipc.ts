/**
 * IPC handlers for the first-run wizard.
 * Registered in the main process, called from the wizard renderer via preload bridge.
 */
import { ipcMain, type BrowserWindow } from "electron";
import { detectPi, detectOpenSpec, detectDashboardPackage, detectSystemNode, detectBridgeExtension, detectPiDashboardCli } from "./dependency-detector.js";
import { installStandalone, installDashboardGlobal, installRecommendedExtensions, installBundledExtensions, type InstallProgress } from "./dependency-installer.js";
import { readModeFile, writeModeFile, isApiKeyConfigured, writeApiKey, readRecommendedWizardState, writeRecommendedWizardState } from "./wizard-state.js";
import { registerBundledBridgeExtension } from "./bridge-register.js";

/**
 * Register all wizard IPC handlers. Call once from main.ts.
 */
export function registerWizardIpc(getWizardWindow: () => BrowserWindow | null): void {
  ipcMain.handle("wizard:detect", async () => {
    const [pi, openspec, dashboard, node, bridge, piDashboardCli] = await Promise.all([
      Promise.resolve(detectPi()),
      Promise.resolve(detectOpenSpec()),
      Promise.resolve(detectDashboardPackage()),
      Promise.resolve(detectSystemNode()),
      Promise.resolve(detectBridgeExtension()),
      Promise.resolve(detectPiDashboardCli()),
    ]);
    return {
      pi: { found: pi.found, source: pi.source },
      openspec: { found: openspec.found, source: openspec.source },
      dashboard: { found: dashboard.found, source: dashboard.source },
      node: { found: node.found, source: node.source },
      bridge: { found: bridge.found, source: bridge.source },
      piDashboardCli: { found: piDashboardCli.found, source: piDashboardCli.source },
      apiKeyConfigured: isApiKeyConfigured(),
    };
  });

  ipcMain.handle("wizard:install-standalone", async (_event, skipPackages?: string[]) => {
    const win = getWizardWindow();
    await installStandalone((progress) => {
      win?.webContents.send("wizard:progress", progress);
    }, skipPackages);
  });

  ipcMain.handle("wizard:install-dashboard-global", async () => {
    const win = getWizardWindow();
    await installDashboardGlobal((progress) => {
      win?.webContents.send("wizard:progress", progress);
    });
  });

  ipcMain.handle("wizard:register-bundled-bridge", async () => {
    registerBundledBridgeExtension();
  });

  ipcMain.handle("wizard:save-api-key", async (_event, provider: string, key: string) => {
    writeApiKey(provider, key);
  });

  ipcMain.handle("wizard:complete", async (_event, mode: "standalone" | "power-user") => {
    writeModeFile(mode);
    // Power-user: ensure the bundled bridge extension is registered in pi's settings
    if (mode === "power-user") {
      try {
        registerBundledBridgeExtension();
      } catch { /* non-fatal — server will re-register on start */ }
    }
  });

  // ── Recommended extensions ────────────────────────────────

  /**
   * Return the static manifest entries plus the previously-persisted
   * skipped list. The renderer enriches via the server's
   * /api/packages/recommended route once the server is reachable; this
   * IPC is the bootstrap view available during first-launch when the
   * server isn't up yet.
   */
  ipcMain.handle("wizard:get-recommended", async () => {
    const { RECOMMENDED_EXTENSIONS } = await import(
      "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js"
    );
    const { enrichRecommendedEntries } = await import("./recommended-enricher.js");
    const state = readRecommendedWizardState();
    // Enrichment is pi-gated + global-scope only. If pi isn't installed,
    // enriched fields are undefined and the renderer behaves as before.
    const recommended = enrichRecommendedEntries(RECOMMENDED_EXTENSIONS);
    return {
      recommended,
      skipped: state.skippedRecommended,
    };
  });

  /**
   * Install the selected recommended extensions. `ids` are manifest ids.
   * Progress is forwarded to the wizard renderer via the same
   * `wizard:progress` channel used by `installStandalone`.
   */
  ipcMain.handle(
    "wizard:install-recommended",
    async (_event, ids: string[]) => {
      const win = getWizardWindow();
      const forward = (progress: InstallProgress) => {
        win?.webContents.send("wizard:progress", progress);
      };
      // Activate bundled extensions first (no-op in dev builds / without
      // the BUNDLE_RECOMMENDED_EXTENSIONS opt-in). Their ids are fed into
      // installRecommendedExtensions as skipPackages so the dynamic
      // installer reports them as "Already installed (bundled)".
      const bundledIds = await installBundledExtensions(forward);
      const skipSet = new Set(bundledIds);
      const installed = await installRecommendedExtensions(
        ids,
        forward,
        skipSet,
      );
      return { installed, bundled: bundledIds };
    },
  );

  /**
   * Persist the wizard's recommended-extensions state — the list of
   * manifest ids the user explicitly skipped. Marks the step complete so
   * it isn't shown again on next launch (though the Packages tab's
   * Recommended section always surfaces current state).
   */
  ipcMain.handle(
    "wizard:persist-recommended-skipped",
    async (_event, skippedIds: string[]) => {
      writeRecommendedWizardState({
        skippedRecommended: Array.isArray(skippedIds) ? skippedIds : [],
      });
    },
  );
}

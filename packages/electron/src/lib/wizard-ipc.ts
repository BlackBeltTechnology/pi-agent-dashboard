/**
 * IPC handlers for the first-run wizard.
 * Registered in the main process, called from the wizard renderer via preload bridge.
 */
import { ipcMain, type BrowserWindow } from "electron";
import { detectPi, detectOpenSpec, detectDashboardPackage, detectSystemNode, detectBridgeExtension, detectPiDashboardCli } from "./dependency-detector.js";
import { installStandalone, installDashboardGlobal, installRecommendedExtensions, installBundledExtensions, type InstallProgress } from "./dependency-installer.js";
import { isApiKeyConfigured, writeApiKey, readRecommendedWizardState, writeRecommendedWizardState } from "./wizard-state.js";
// TODO(simplify-electron-bootstrap-derived-state Phase C): writeModeFile/readModeFile removed from
// V2 path. Legacy path (LAUNCH_SOURCE_V2=false) still writes mode.json via wizard:complete below.
// Remove when the legacy path is deleted in a follow-up change.
import { registerBundledBridgeExtension } from "./bridge-register.js";
import {
  readInstallableList,
  writeInstallableList,
  type InstallableList,
} from "@blackbelt-technology/pi-dashboard-shared/installable-list.js";

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
    // TODO(Phase C): mode.json write is legacy-path only (LAUNCH_SOURCE_V2=false).
    // The V2 path does not open the wizard for mode selection; remove when legacy path drops.
    const { writeModeFile: legacyWrite } = await import("./wizard-state.js");
    legacyWrite(mode);
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

  // ── V2 handlers (behind LAUNCH_SOURCE_V2 flag) ─────────────────────────
  // See change: simplify-electron-bootstrap-derived-state (tasks 7.1–7.3).

  /**
   * Read installable.json and return the package list.
   * Returns null when the file is absent (legacy/Bridge/Standalone parity).
   */
  ipcMain.handle("wizard:v2:get-installable", async (): Promise<InstallableList | null> => {
    return readInstallableList();
  });

  /**
   * Save an updated installable.json (for optional package toggles).
   * Required packages cannot be deselected — the renderer enforces this;
   * the main process accepts and persists the list as-is.
   */
  ipcMain.handle(
    "wizard:v2:save-installable",
    async (_event, list: InstallableList): Promise<void> => {
      await writeInstallableList(list);
    },
  );

  /**
   * Fetch the current bootstrap status from the running server.
   * Returns null when the server is not reachable.
   */
  ipcMain.handle(
    "wizard:v2:get-server-bootstrap",
    async (
      _event,
      serverUrl: string,
    ): Promise<{ status: string; installable?: { total: number; installed: number; failed: string[] }; progress?: { step: string; output?: string } } | null> => {
      try {
        const res = await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return null;
        const data = await res.json() as any;
        return {
          status: data.bootstrapStatus ?? (data.ok ? "ready" : "unknown"),
          installable: data.installable,
          progress: data.progress,
        };
      } catch {
        return null;
      }
    },
  );

  /**
   * Trigger a bootstrap retry on the running server.
   * Returns true on success, false on failure.
   */
  ipcMain.handle(
    "wizard:v2:retry-bootstrap",
    async (_event, serverUrl: string): Promise<boolean> => {
      try {
        const res = await fetch(`${serverUrl}/api/bootstrap/retry`, {
          method: "POST",
          signal: AbortSignal.timeout(5000),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  );
}

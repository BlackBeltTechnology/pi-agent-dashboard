/**
 * Shows native OS notifications when dependency updates are available.
 * Uses Electron's Notification API.
 */
import { Notification, dialog } from "electron";
import { type OutdatedPackage, updatePackage } from "./update-checker.js";

let dismissed = false;

/**
 * Show a notification for available updates.
 * Only shows once per check cycle (dismissed resets on next interval).
 */
export function notifyUpdatesAvailable(packages: OutdatedPackage[], starter?: string | null): void {
  if (dismissed) return;

  const names = packages.map(p => p.name.split("/").pop()).join(", ");
  const body = packages.map(p => `${p.name.split("/").pop()}: ${p.current} → ${p.latest}`).join("\n");

  const notification = new Notification({
    title: "PI Dashboard: Updates Available",
    body: `${names}\n${body}`,
    actions: [{ type: "button", text: "Update" }],
  });

  notification.on("action", async () => {
    const result = await dialog.showMessageBox({
      type: "question",
      title: "Update Dependencies",
      message: `Update ${names}?`,
      detail: body,
      buttons: ["Update", "Cancel"],
      defaultId: 0,
    });

    if (result.response === 0) {
      for (const pkg of packages) {
        try {
          updatePackage(pkg.name, starter ?? null);
        } catch (err: any) {
          dialog.showErrorBox("Update Failed", `Failed to update ${pkg.name}: ${err.message}`);
        }
      }
      new Notification({
        title: "PI Dashboard",
        body: "Dependencies updated successfully.",
      }).show();
    }
  });

  notification.on("close", () => {
    dismissed = true;
    // Reset dismissed flag for next check cycle
    setTimeout(() => { dismissed = false; }, 24 * 60 * 60 * 1000);
  });

  notification.show();
}

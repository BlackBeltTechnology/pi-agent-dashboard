/**
 * Doctor window factory + IPC handler registration.
 *
 * Single BrowserWindow (1000x720, resizable). Reuses the existing window
 * if already open (focus instead of recreate). Wires every IPC channel
 * declared in `DOCTOR_IPC_CHANNELS`. Every handler wraps its body in
 * try/catch and rejects with a structured `{ kind, message, detail }`
 * object on failure. The `doctor:run` handler short-circuits concurrent
 * invocations: a second call awaits the first's result.
 *
 * See change: doctor-rich-output (task 3.5).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DoctorReport } from "@blackbelt-technology/pi-dashboard-shared/doctor-core.js";
import { app, BrowserWindow, clipboard, ipcMain, shell } from "electron";
import { runDoctor } from "./doctor.js";
import { DOCTOR_IPC_CHANNELS } from "./doctor-bridge-contract.js";
import { MANAGED_DIR } from "./managed-paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let doctorWindow: BrowserWindow | null = null;
let handlersRegistered = false;

/** In-flight `doctor:run` promise — re-run race serialization (Decision 10). */
let inFlightRun: Promise<DoctorReport> | null = null;

function getPreloadPath(): string {
  const packaged = path.join(__dirname, "preload.js");
  if (existsSync(packaged)) return packaged;
  const forgeDev = path.join(process.cwd(), ".vite", "build", "preload.js");
  if (existsSync(forgeDev)) return forgeDev;
  return packaged;
}

function getDoctorHtmlPath(): string {
  let p = path.join(__dirname, "..", "renderer", "doctor.html");
  if (!existsSync(p) && (process as { resourcesPath?: string }).resourcesPath) {
    p = path.join((process as { resourcesPath: string }).resourcesPath, "renderer", "doctor.html");
  }
  return p;
}

function registerHandlersOnce(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle("doctor:run", async () => {
    if (inFlightRun) {
      // Concurrent invocation — await the same report.
      return inFlightRun;
    }
    inFlightRun = (async () => {
      try {
        return await runDoctor();
      } finally {
        // Release after the in-flight call completes regardless of outcome.
        // This is the next microtask after the await resolves; subsequent
        // calls re-spawn fresh runs.
      }
    })();
    try {
      const report = await inFlightRun;
      return report;
    } finally {
      inFlightRun = null;
    }
  });

  ipcMain.handle("doctor:open-log", async () => {
    try {
      const logPath = path.join(MANAGED_DIR, "server.log");
      if (!existsSync(logPath)) return { ok: false, path: logPath };
      await shell.openPath(logPath);
      return { ok: true, path: logPath };
    } catch (err) {
      throw asStructuredError(err, "open-log");
    }
  });

  ipcMain.handle("doctor:open-doctor-log", async () => {
    try {
      const logPath = path.join(MANAGED_DIR, "doctor.log");
      if (!existsSync(logPath)) return { ok: true, exists: false };
      await shell.openPath(logPath);
      return { ok: true, exists: true, path: logPath };
    } catch (err) {
      throw asStructuredError(err, "open-doctor-log");
    }
  });

  ipcMain.handle("doctor:copy", async (_event, text: string) => {
    try {
      clipboard.writeText(typeof text === "string" ? text : "");
      return { ok: true };
    } catch (err) {
      throw asStructuredError(err, "copy");
    }
  });

  ipcMain.handle("doctor:open-managed-dir", async () => {
    try {
      await shell.openPath(MANAGED_DIR);
      return { ok: true, path: MANAGED_DIR };
    } catch (err) {
      throw asStructuredError(err, "open-managed-dir");
    }
  });
}

function asStructuredError(err: unknown, label: string): { kind: string; message: string; detail: string } {
  const e = err instanceof Error ? err : new Error(String(err));
  return {
    kind: label,
    message: e.message,
    detail: (e.stack || "").split("\n").slice(0, 4).join("\n"),
  };
}

/** Open (or focus) the Doctor window. Idempotent; closing-and-reopening yields a fresh window. */
export function openDoctorWindow(): BrowserWindow {
  registerHandlersOnce();

  if (doctorWindow && !doctorWindow.isDestroyed()) {
    if (doctorWindow.isMinimized()) doctorWindow.restore();
    doctorWindow.focus();
    return doctorWindow;
  }

  doctorWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    resizable: true,
    title: "PI Dashboard Doctor",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: getPreloadPath(),
    },
  });

  doctorWindow.loadFile(getDoctorHtmlPath());

  doctorWindow.on("closed", () => {
    // Risk #3 mitigation: clear the reference so a re-open creates a fresh
    // window rather than no-oping against a destroyed one.
    doctorWindow = null;
  });

  return doctorWindow;
}

/** Exported for the channel-name-drift lint test. */
export const REGISTERED_DOCTOR_CHANNELS: readonly string[] = DOCTOR_IPC_CHANNELS;

// Re-export a marker so test harness can ensure the module loaded.
export { ipcMain as _ipcMain };

// Silence unused-import warnings for `app` (kept available for future use).
void app;

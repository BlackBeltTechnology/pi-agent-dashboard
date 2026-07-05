/**
 * Electron-E2E lifecycle helpers.
 *
 * Distinct from the web-client E2E harness (`tests/e2e/`, Docker + :18000).
 * This suite launches the REAL packaged Electron app via Playwright's
 * `_electron` and drives the native-surface flows that unit tests cannot reach:
 * the zombie-adoption modal (native `dialog.showMessageBox`) and the Doctor
 * version-skew row (DOM in the doctor window).
 *
 * Determinism strategy:
 *  - A `FakeHealthServer` stands in for the dashboard server. Electron's
 *    bootstrap health-probes it, takes the `attach` arm, and reads a CRAFTED
 *    `/api/health` payload (zombie-shaped or version-mismatched).
 *  - A throwaway HOME dir carries `~/.pi/dashboard/config.json` (port pinned to
 *    the fake server) + the first-run marker (skips the wizard).
 *  - Native `dialog.showMessageBox` is stubbed in the main process via
 *    `electronApp.evaluate` (native modals cannot be clicked by automation).
 *    A small fake-health response delay guarantees the stub is installed
 *    before the attach-arm zombie check fires.
 *
 * See change: electron-attach-ownership-fixes (Electron-E2E harness).
 */

import fs from "node:fs";
import { createServer, type Server } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, _electron as electron } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const ELECTRON_DIR = path.join(REPO_ROOT, "packages", "electron");

/**
 * The dashboard port the fake server binds. The Doctor version-skew check
 * fetches a HARD-CODED `http://localhost:8000/api/health` (matches the existing
 * doctor `probeServer`), so the fake MUST live on 8000 for the Doctor spec.
 * The zombie spec pins the same port via config for symmetry.
 */
export const FAKE_PORT = Number(process.env.PW_ELECTRON_PORT ?? 8000);

/** Health payload shape the fake server serves. All fields optional. */
export interface FakeHealth {
  ok?: boolean;
  pid?: number;
  version?: string;
  launchSource?: string;
  launchSourceEffective?: string;
  starter?: string;
  bootParentPid?: number;
  ppid?: number;
  bootParentAlive?: boolean;
  activeBridgeCount?: number;
  platform?: string;
  mode?: string;
}

export interface FakeHealthServer {
  port: number;
  /** Requests received, for assertions (e.g. POST /api/shutdown). */
  readonly requests: Array<{ method: string; url: string }>;
  setHealth(next: FakeHealth): void;
  close(): Promise<void>;
}

/**
 * Start a fake dashboard server. Serves `/api/health` (with a small delay so
 * the dialog stub installs first), a minimal HTML page for any other GET (so
 * `createMainWindow().loadURL` succeeds), and records POST /api/shutdown.
 */
export async function startFakeHealthServer(
  initial: FakeHealth,
  opts: { port?: number; healthDelayMs?: number } = {},
): Promise<FakeHealthServer> {
  const port = opts.port ?? FAKE_PORT;
  const healthDelayMs = opts.healthDelayMs ?? 400;
  let health: FakeHealth = { ok: true, ...initial };
  const requests: Array<{ method: string; url: string }> = [];

  const server: Server = createServer((req, res) => {
    requests.push({ method: req.method ?? "", url: req.url ?? "" });
    const url = req.url ?? "";
    if (url.startsWith("/api/health")) {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...health }));
      }, healthDelayMs);
      return;
    }
    if (url.startsWith("/api/shutdown") && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    // Anything else (the BrowserWindow URL, loading page assets) → minimal HTML.
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><html><head><title>fake</title></head><body>fake dashboard</body></html>");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    port,
    requests,
    setHealth(next) { health = { ok: true, ...next }; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** True when `port` is already bound (used to skip locally without nuking a live dashboard). */
export async function isPortInUse(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const tester = net.createServer();
    tester.once("error", (err: NodeJS.ErrnoException) => resolve(err.code === "EADDRINUSE"));
    tester.once("listening", () => tester.close(() => resolve(false)));
    tester.listen(port, "127.0.0.1");
  });
}

/**
 * Create a throwaway HOME with `~/.pi/dashboard/config.json` (port pinned) and
 * the first-run marker (skips the wizard so the app takes the attach arm).
 * Returns the HOME path (caller removes it after).
 */
export function makeThrowawayHome(port: number): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-elec-e2e-"));
  const dashDir = path.join(home, ".pi", "dashboard");
  fs.mkdirSync(dashDir, { recursive: true });
  fs.writeFileSync(
    path.join(dashDir, "config.json"),
    JSON.stringify({ port, piPort: port + 999, knownServers: [] }),
  );
  // First-run marker: getFirstRunMarkerPath() → ~/.pi/dashboard/first-run-done.
  fs.writeFileSync(path.join(dashDir, "first-run-done"), new Date().toISOString());
  return home;
}

/**
 * Resolve the packaged Electron binary produced by `electron-forge package`
 * under `packages/electron/out/`. Override with PW_ELECTRON_BINARY.
 */
export function resolvePackagedBinary(): string {
  const override = process.env.PW_ELECTRON_BINARY;
  if (override) return override;
  const outDir = path.join(ELECTRON_DIR, "out");
  if (!fs.existsSync(outDir)) {
    throw new Error(
      `[electron-e2e] No packaged app at ${outDir}. Run \`npm run -w packages/electron package\` first ` +
        "(or set PW_ELECTRON_BINARY).",
    );
  }
  const appDir = fs.readdirSync(outDir).map((d) => path.join(outDir, d)).find((p) => fs.statSync(p).isDirectory());
  if (!appDir) throw new Error(`[electron-e2e] No app dir under ${outDir}.`);
  if (process.platform === "darwin") {
    const app = fs.readdirSync(appDir).find((d) => d.endsWith(".app"));
    if (!app) throw new Error(`[electron-e2e] No .app under ${appDir}.`);
    const name = app.replace(/\.app$/, "");
    return path.join(appDir, app, "Contents", "MacOS", name);
  }
  if (process.platform === "win32") {
    const exe = fs.readdirSync(appDir).find((d) => d.endsWith(".exe"));
    if (!exe) throw new Error(`[electron-e2e] No .exe under ${appDir}.`);
    return path.join(appDir, exe);
  }
  // linux: the app binary is forge's executableName ("pi-dashboard"). Prefer it
  // by name — the app dir also contains OTHER extensionless executables
  // (notably `chrome-sandbox`), so a "first executable without a dot" heuristic
  // can grab the wrong file and yield "Process failed to launch".
  const named = path.join(appDir, "pi-dashboard");
  if (fs.existsSync(named)) return named;
  const NON_APP = new Set(["chrome-sandbox", "chrome_crashpad_handler"]);
  const bin = fs.readdirSync(appDir).find((d) => {
    if (NON_APP.has(d)) return false;
    const p = path.join(appDir, d);
    return fs.statSync(p).isFile() && (fs.statSync(p).mode & 0o111) !== 0 && !d.includes(".");
  });
  if (!bin) throw new Error(`[electron-e2e] No app executable under ${appDir}.`);
  return path.join(appDir, bin);
}

/**
 * Launch the packaged app against the fake server. `zombiePrompt: false` adds
 * the `--no-zombie-prompt` switch. Clears DASHBOARD_STARTER so the launch
 * source is whatever the fake reports.
 */
export async function launchElectron(opts: {
  home: string;
  zombiePrompt?: boolean;
}): Promise<ElectronApplication> {
  // --no-sandbox is required for Electron to launch on CI Linux (no SUID
  // chrome-sandbox helper under xvfb); harmless on macOS/Windows. Mirrors the
  // repo's qa `08-electron-real-launch.sh`.
  const args: string[] = ["--no-sandbox"];
  if (opts.zombiePrompt === false) args.push("--no-zombie-prompt");
  const env: Record<string, string> = {
    ...process.env,
    HOME: opts.home,
    USERPROFILE: opts.home,
    ELECTRON_ENABLE_LOGGING: "1",
  };
  delete env.DASHBOARD_STARTER;
  return await electron.launch({
    executablePath: resolvePackagedBinary(),
    args,
    env,
  });
}

/**
 * Stub `dialog.showMessageBox` in the main process to auto-return `responseIndex`
 * and record every call on `globalThis.__zombieDialogCalls`. Retrieve the calls
 * later via `readDialogCalls`.
 */
export async function stubDialog(app: ElectronApplication, responseIndex: number): Promise<void> {
  await app.evaluate(async ({ dialog }, index) => {
    const g = globalThis as any;
    g.__zombieDialogCalls = [];
    dialog.showMessageBox = (async (...callArgs: any[]) => {
      const opts = callArgs.length === 1 ? callArgs[0] : callArgs[1];
      g.__zombieDialogCalls.push(opts);
      return { response: index, checkboxChecked: false };
    }) as any;
  }, responseIndex);
}

/** Read the recorded `dialog.showMessageBox` option objects from the main process. */
export async function readDialogCalls(app: ElectronApplication): Promise<Array<{ detail?: string; message?: string; buttons?: string[] }>> {
  return await app.evaluate(() => (globalThis as any).__zombieDialogCalls ?? []);
}

/** One captured tray/app menu template: the plain (serializable) item shape. */
export type CapturedMenuItem = { label?: string; enabled?: boolean; type?: string };

/**
 * Monkeypatch `Menu.buildFromTemplate` in the main process to record every
 * template built (as plain {label,enabled,type} — click handlers are dropped so
 * the result is serializable across `evaluate`) on `globalThis.__menuTemplates`,
 * while still returning a real Menu so the tray keeps working. The tray rebuilds
 * on each 3s ownership poll, so the "foreign" template is captured once
 * ownership resolves. Install BEFORE the tray's foreign rebuild fires (the fake
 * server's health delay widens that window).
 */
export async function captureMenuTemplates(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const g = globalThis as any;
    g.__menuTemplates = [];
    const orig = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = ((template: any[]) => {
      try {
        g.__menuTemplates.push(
          (template ?? []).map((i) => ({ label: i?.label, enabled: i?.enabled, type: i?.type })),
        );
      } catch { /* ignore capture errors */ }
      return orig(template);
    }) as any;
  });
}

/** Read the recorded menu templates (array of item arrays) from the main process. */
export async function readMenuTemplates(app: ElectronApplication): Promise<CapturedMenuItem[][]> {
  return await app.evaluate(() => (globalThis as any).__menuTemplates ?? []);
}

/**
 * Open the Doctor window by emitting the `dashboard:open-doctor` IPC in the main
 * process (the handler is registered by `registerPiDashboardIpc`). Robust
 * against the loading page redirecting to the (healthy) fake server's URL,
 * which discards the transient `#doctor-btn` control.
 */
export async function openDoctorViaIpc(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.emit("dashboard:open-doctor");
  });
}

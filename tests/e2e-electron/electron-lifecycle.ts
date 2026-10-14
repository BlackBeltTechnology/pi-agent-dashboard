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

import crypto from "node:crypto";
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
    const macOsDir = path.join(appDir, app, "Contents", "MacOS");
    // The inner Mach-O is named after forge's `executableName`
    // ("pi-dashboard"), NOT after the .app bundle ("PI-Dashboard.app") — the
    // two differ in case. Deriving the name from the bundle yields ENOENT.
    // Same trap the linux branch below already documents. This went unnoticed
    // because ci-e2e-electron.yml has no macOS leg, so the darwin branch had
    // never run. See change: upgrade-electron-runtime.
    const named = path.join(macOsDir, "pi-dashboard");
    if (fs.existsSync(named)) return named;
    const only = fs
      .readdirSync(macOsDir)
      .filter((d) => fs.statSync(path.join(macOsDir, d)).isFile());
    if (only.length === 0) throw new Error(`[electron-e2e] No executable under ${macOsDir}.`);
    if (only.length > 1) {
      // Picking only[0] here would silently launch whichever helper readdir
      // happened to list first and fail somewhere far less legible.
      throw new Error(
        `[electron-e2e] Ambiguous darwin binary: expected 'pi-dashboard' under ${macOsDir}, ` +
          `found ${only.length} candidates (${only.join(", ")}). ` +
          "Set PW_ELECTRON_BINARY, or align forge's executableName.",
      );
    }
    return path.join(macOsDir, only[0]);
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
  // macOS: `safeStorage` (the server keyring) would otherwise block the main thread on a Keychain
  // authorisation prompt in an unsigned build. The mock keychain keeps the app unattended-runnable.
  if (process.platform === "darwin") args.push("--use-mock-keychain");
  if (opts.zombiePrompt === false) args.push("--no-zombie-prompt");
  const env: Record<string, string> = {
    ...process.env,
    HOME: opts.home,
    USERPROFILE: opts.home,
    ELECTRON_ENABLE_LOGGING: "1",
  };
  delete env.DASHBOARD_STARTER;
  // PW_ELECTRON_DEV=1: run the WORKING TREE with the workspace's Electron binary instead of a
  // packaged app — the fast local loop. Builds what forge would (main + both preloads, via the
  // package's own vite/esbuild) into `packages/electron/.vite/build` and mirrors `renderer/`.
  if (process.env.PW_ELECTRON_DEV) {
    const { createRequire } = await import("node:module");
    const { execFileSync } = await import("node:child_process");
    const electronBinary = createRequire(import.meta.url)("electron") as string;
    const bin = (name: string) => path.join(REPO_ROOT, "node_modules", ".bin", name);
    const outDir = path.join(ELECTRON_DIR, ".vite", "build");
    execFileSync(bin("vite"), ["build", "-c", "vite.main.config.ts", "--logLevel", "error"], { cwd: ELECTRON_DIR });
    for (const name of ["preload", "preload-main"]) {
      execFileSync(bin("esbuild"), [path.join(ELECTRON_DIR, "src", `${name}.ts`), "--bundle", "--platform=node", "--format=cjs", "--external:electron", `--outfile=${path.join(outDir, `${name}.js`)}`, "--log-level=error"]);
    }
    fs.cpSync(path.join(ELECTRON_DIR, "src", "renderer"), path.join(ELECTRON_DIR, ".vite", "renderer"), { recursive: true });
    return await electron.launch({
      executablePath: electronBinary,
      args: [path.join(outDir, "main.js"), ...args],
      env: { ...env, ELECTRON_DEV: "1" },
      cwd: ELECTRON_DIR,
    });
  }
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
  // The handler is sender-gated (harden-electron-renderer-boundary): synthesize
  // the event a real call from the local loading page would carry.
  await app.evaluate(({ app: electronApp, ipcMain }) => {
    // No `require` in this ESM evaluate context: build the file URL by hand.
    const resourcesDir = electronApp.isPackaged
      ? process.resourcesPath
      : `${electronApp.getAppPath()}/resources`;
    const filePath = `${resourcesDir}/loading.html`.replace(/\\/g, "/").replace(/^\/+/, "");
    const url = new URL(`file:///${filePath}`).href;
    ipcMain.emit("dashboard:open-doctor", { senderFrame: { url } });
  });
}

// ── Fake remote dashboard (add-electron-server-windows) ────────────────────────

interface FakeRemoteRequest {
  method: string;
  url: string;
  authorization?: string;
  cookie?: string;
}

export interface FakeRemoteDashboard {
  /** `http://<non-loopback IPv4>:<port>` — a non-internal address, since manual loopback URLs are refused. */
  origin: string;
  host: string;
  port: number;
  /** Current identity fingerprint (`sha256:…`). */
  fingerprint: string;
  /** The bearer handed out on approval. */
  token: string;
  /** Every request, in order (for ordering/credential assertions). */
  readonly requests: FakeRemoteRequest[];
  /** Replace the identity key (an address taken over by a different dashboard). */
  swapKey(): void;
  /** Make `/api/device-session` answer 403 `network_not_allowed` (revoked device). */
  revokeDevice(): void;
  close(): Promise<void>;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function newIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return { privateKey, publicKeyB64: b64url(der), fingerprint: `sha256:${b64url(crypto.createHash("sha256").update(der).digest())}` };
}

/** First non-internal IPv4 address of this machine (the knock/loopback rules need a real LAN-style address). */
export function firstNonInternalIPv4(): string | undefined {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return undefined;
}

/**
 * Start a fake REMOTE dashboard with a REAL Ed25519 identity: `/api/pair/challenge`
 * (signs the nonce), `/api/pair/request` (knock → code `48217730`), `/api/pair/poll`
 * (approved on the 2nd poll), `/api/device-session` (bearer → `pi_dash_device` cookie),
 * and an HTML page for any other GET. Bound to the first non-internal IPv4.
 * `knock: { refuse: "knock_disabled" }` makes the knock refuse instead.
 */
export async function startFakeRemoteDashboard(
  opts: { knock?: { refuse?: string }; token?: string } = {},
): Promise<FakeRemoteDashboard> {
  const host = firstNonInternalIPv4();
  if (!host) throw new Error("[electron-e2e] no non-internal IPv4 address on this machine");
  let identity = newIdentity();
  const token = opts.token ?? `B1-${crypto.randomBytes(12).toString("hex")}`;
  let revoked = false;
  let polls = 0;
  const requests: FakeRemoteRequest[] = [];

  type Req = import("node:http").IncomingMessage;
  type Res = import("node:http").ServerResponse;
  const readBody = (req: Req): Promise<string> =>
    new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data));
    });
  const json = (res: Res, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  // One handler per `POST` route — kept flat so each stays trivially readable.
  const routes = new Map<string, (req: Req, res: Res) => Promise<void>>(Object.entries({
    "/api/pair/challenge": async (req, res) => {
      const { nonce } = JSON.parse((await readBody(req)) || "{}") as { nonce?: string };
      const signature = crypto.sign(null, Buffer.from(String(nonce), "utf-8"), identity.privateKey);
      json(res, 200, { success: true, data: { fingerprint: identity.fingerprint, publicKey: identity.publicKeyB64, signature: b64url(signature), v: 1 } });
    },
    "/api/pair/request": async (req, res) => {
      await readBody(req);
      if (opts.knock?.refuse) return json(res, 403, { success: false, error: opts.knock.refuse });
      polls = 0;
      json(res, 200, { success: true, data: { pendingId: "p1", confirmCode: "48217730", expiresAt: Date.now() + 300_000, fingerprint: identity.fingerprint } });
    },
    "/api/pair/poll": async (req, res) => {
      await readBody(req);
      polls++;
      json(res, 200, { success: true, data: polls >= 2 ? { status: "approved", token } : { status: "pending" } });
    },
    "/api/device-session": async (req, res) => {
      if (revoked) return json(res, 403, { success: false, error: "network_not_allowed" });
      if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { success: false, error: "invalid bearer" });
      json(res, 200, { success: true }, { "set-cookie": `pi_dash_device=${token}; Path=/api/; HttpOnly; SameSite=Strict; Max-Age=34560000` });
    },
  }));

  const server: Server = createServer(async (req, res) => {
    const url = req.url ?? "";
    requests.push({
      method: req.method ?? "",
      url,
      ...(req.headers.authorization ? { authorization: String(req.headers.authorization) } : {}),
      ...(req.headers.cookie ? { cookie: String(req.headers.cookie) } : {}),
    });
    const route = req.method === "POST" ? routes.get(url) : undefined;
    if (route) return route(req, res);
    if (url.startsWith("/api/")) return json(res, 200, { success: true, cookie: req.headers.cookie ?? null });
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><html><head><title>fake remote</title></head><body>fake remote dashboard</body></html>");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve());
  });
  const port = (server.address() as net.AddressInfo).port;
  return {
    origin: `http://${host}:${port}`,
    host,
    port,
    get fingerprint() { return identity.fingerprint; },
    token,
    requests,
    swapKey() { identity = newIdentity(); },
    revokeDevice() { revoked = true; },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

/** Click an application-menu item by its label (searches submenus). */
export async function clickAppMenuItem(app: ElectronApplication, label: string): Promise<void> {
  const found = await app.evaluate(({ Menu }, wanted) => {
    const flat = (items: Electron.MenuItem[]): Electron.MenuItem[] => items.flatMap((i) => [i, ...(i.submenu ? flat(i.submenu.items) : [])]);
    const item = flat(Menu.getApplicationMenu()?.items ?? []).find((i) => i.label === wanted);
    item?.click();
    return !!item;
  }, label);
  if (!found) throw new Error(`[electron-e2e] app menu item not found: ${label}`);
}

/** Labels of the app menu's Servers submenu (rebuilt on keyring change). */
export async function readServersMenu(app: ElectronApplication): Promise<string[]> {
  return await app.evaluate(({ Menu }) => {
    const flat = (items: Electron.MenuItem[]): Electron.MenuItem[] => items.flatMap((i) => [i, ...(i.submenu ? flat(i.submenu.items) : [])]);
    const servers = flat(Menu.getApplicationMenu()?.items ?? []).find((i) => i.label === "Servers");
    return (servers?.submenu?.items ?? []).filter((i) => i.type !== "separator").map((i) => i.label);
  });
}

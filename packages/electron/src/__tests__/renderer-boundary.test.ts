/**
 * Renderer-boundary hardening (VD5/VD4): the MAIN window's preload exposes no
 * wizard bridge; the wizard preload keeps them; main.ts wires the sender-frame
 * gate + scheme allowlist.
 *
 * See change: harden-electron-renderer-boundary (T1, T2, T3, T5).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, "..", "..", rel), "utf-8");
const stripComments = (s: string) => s.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");

const exposed: string[] = [];
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (key: string) => { exposed.push(key); } },
  ipcRenderer: { invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}));

describe("preload split (VD5)", () => {
  beforeEach(() => {
    exposed.length = 0;
    vi.resetModules();
  });

  it("T1: main-window preload exposes ONLY piDashboard (no remoteConnect / electron.doctor)", async () => {
    await import("../preload-main.js");
    expect(exposed).toEqual(["piDashboard"]);
  });

  it("T5: wizard preload exposes only its trusted-page bridges (connecting, electron(doctor), remoteConnect), never piDashboard", async () => {
    await import("../preload.js");
    // `connecting` = the bundled pairing-progress page (add-electron-server-windows); trusted file:// pages only.
    expect([...exposed].sort()).toEqual(["connecting", "electron", "remoteConnect"]);
  });
});

/** @structural-pin main.ts imports electron and cannot be loaded; wiring is pinned on source. */
describe("main.ts wiring", () => {
  const main = stripComments(read("src/main.ts"));

  it("T1: the main BrowserWindow uses preload-main.js, never preload.js", () => {
    const fn = main.slice(main.indexOf("function getMainPreloadPath"), main.indexOf("function registerPiDashboardIpc"));
    expect(fn).toContain("preload-main.js");
    expect(fn).not.toMatch(/"preload\.js"/);
  });

  it("T5: wizard windows keep the bridge-carrying preload.js", () => {
    for (const f of ["src/lib/doctor-window.ts", "src/lib/remote-connect-window.ts"]) {
      expect(read(f), f).toContain('"preload.js"');
    }
  });

  it("T2: every gated channel is registered through the sender-frame wrapper", () => {
    for (const ch of ["request-launch", "read-server-log", "probe-server"]) {
      expect(main, ch).toMatch(new RegExp(`ipcMain\\.handle\\("dashboard:${ch}", trustedHandler\\(`));
    }
    expect(main).toMatch(/ipcMain\.on\("dashboard:open-doctor", trustedListener\(/);
    // no ungated registration of the four privileged channels
    expect(main).not.toMatch(/ipcMain\.handle\("dashboard:(request-launch|read-server-log|probe-server)", async/);
  });

  it("T3: shell.openExternal is only reachable through the scheme allowlist", () => {
    const calls = main.match(/shell\.openExternal\(/g) ?? [];
    expect(calls).toHaveLength(1); // the opener passed to openExternalIfAllowed
    expect(main).toContain("openExternalIfAllowed(url, open)");
    expect(main).toMatch(/setWindowOpenHandler\(\(details\) => \{\s*safeOpenExternal\(details\.url\)/);
    expect(main).toMatch(/decision === "open-external"\) \{\s*event\.preventDefault\(\);\s*safeOpenExternal\(url\)/);
  });

  it("forge builds a second preload entry for the main window", () => {
    const forge = read("forge.config.ts");
    expect(forge).toContain('entry: "src/preload-main.ts"');
    expect(forge).toContain('config: "vite.preload-main.config.ts"');
    expect(read("vite.preload-main.config.ts")).toContain('entry: "src/preload-main.ts"');
  });
});

// ── open-server-window capability gating (add-electron-server-windows, D9) ─────
describe("preload-main: openServerWindow only on the local dashboard origin", () => {
  const exposedApi: Array<Record<string, unknown>> = [];

  async function loadWith(origin: string | undefined, locationOrigin: string) {
    vi.resetModules();
    exposedApi.length = 0;
    vi.doMock("electron", () => ({
      contextBridge: { exposeInMainWorld: (_k: string, api: Record<string, unknown>) => { exposedApi.push(api); } },
      ipcRenderer: { invoke: vi.fn(async () => ({ ok: true })), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
    }));
    const argv = process.argv;
    process.argv = origin ? [...argv, `--pi-local-origin=${origin}`] : argv.filter((a) => !a.startsWith("--pi-local-origin="));
    (globalThis as { location?: unknown }).location = { origin: locationOrigin };
    try {
      await import("../preload-main.js");
    } finally {
      process.argv = argv;
    }
    return exposedApi[0]!;
  }

  it("present when location.origin equals the passed local origin", async () => {
    const api = await loadWith("http://localhost:8000", "http://localhost:8000");
    expect(typeof api.openServerWindow).toBe("function");
  });

  it("absent for a remote-origin document (remote mode), a different origin, or no passed origin", async () => {
    expect((await loadWith("http://localhost:8000", "http://192.168.16.204:8000")).openServerWindow).toBeUndefined();
    expect((await loadWith("http://localhost:8000", "http://localhost:9000")).openServerWindow).toBeUndefined();
    expect((await loadWith(undefined, "http://localhost:8000")).openServerWindow).toBeUndefined();
  });

  it("the bridge sends only host + port on servers:open-from-dashboard", async () => {
    const api = await loadWith("http://localhost:8000", "http://localhost:8000");
    const { ipcRenderer } = await import("electron");
    await (api.openServerWindow as (t: unknown) => Promise<unknown>)({ host: "192.168.16.204", port: 8000, partition: "evil", url: "http://x/" });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith("servers:open-from-dashboard", { host: "192.168.16.204", port: 8000 });
  });
});

// ── browserHost capability gating (add-operator-browser-relay, D1/D9, test-plan #E35) ─────
describe("preload-main: browserHost only on the local dashboard origin", () => {
  const exposedApi: Array<Record<string, unknown>> = [];

  async function loadWith(origin: string | undefined, locationOrigin: string) {
    vi.resetModules();
    exposedApi.length = 0;
    vi.doMock("electron", () => ({
      contextBridge: { exposeInMainWorld: (_k: string, api: Record<string, unknown>) => { exposedApi.push(api); } },
      ipcRenderer: { invoke: vi.fn(async () => undefined), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
    }));
    const argv = process.argv;
    process.argv = origin ? [...argv, `--pi-local-origin=${origin}`] : argv.filter((a) => !a.startsWith("--pi-local-origin="));
    (globalThis as { location?: unknown }).location = { origin: locationOrigin };
    try {
      await import("../preload-main.js");
    } finally {
      process.argv = argv;
    }
    return exposedApi[0]!;
  }

  it("defined for the local origin, with exactly the contract surface", async () => {
    const api = await loadWith("http://localhost:8000", "http://localhost:8000");
    expect(Object.keys(api.browserHost as object).sort()).toEqual(
      ["identity", "sign", "setTarget", "connect", "onConnect", "cancelConnect", "extSend", "extClose", "onExt", "tee", "onFrame", "setToken", "listConsents", "revokeConsent"].sort(),
    );
  });

  it("undefined for a remote-origin document (VD5), another origin, or no passed origin", async () => {
    expect((await loadWith("http://localhost:8000", "http://192.168.16.204:8000")).browserHost).toBeUndefined();
    expect((await loadWith("http://localhost:8000", "http://localhost:9000")).browserHost).toBeUndefined();
    expect((await loadWith(undefined, "http://localhost:8000")).browserHost).toBeUndefined();
  });

  it("connect forwards only the contract fields; channels are the shared names", async () => {
    const api = await loadWith("http://localhost:8000", "http://localhost:8000");
    const { ipcRenderer } = await import("electron");
    const { BROWSER_HOST_CHANNELS: CH } = await import("@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js");
    const bh = api.browserHost as Record<string, (...a: unknown[]) => unknown>;
    await bh.connect!({ requestId: "R", linkId: "L", instanceId: "I", profileDirectory: "Default", serverLabel: "s", token: "leak", guid: "leak" });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.connect, { requestId: "R", linkId: "L", instanceId: "I", profileDirectory: "Default", serverLabel: "s" });
    await bh.sign!("n", "I");
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.sign, "n", "I");
    await bh.extSend!("L", "data");
    expect(ipcRenderer.send).toHaveBeenCalledWith(CH.extSend, "L", "data");
  });

  it("push subscriptions return a working unsubscribe", async () => {
    const api = await loadWith("http://localhost:8000", "http://localhost:8000");
    const { ipcRenderer } = await import("electron");
    const off = (api.browserHost as { onFrame(cb: () => void): () => void }).onFrame(() => {});
    expect(ipcRenderer.on).toHaveBeenCalledWith("browser-host:frame", expect.any(Function));
    off();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith("browser-host:frame", expect.any(Function));
  });
});

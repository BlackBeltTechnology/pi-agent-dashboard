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

  it("T5: wizard preload still exposes remoteConnect + electron(doctor), and not piDashboard", async () => {
    await import("../preload.js");
    expect([...exposed].sort()).toEqual(["electron", "remoteConnect"]);
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
    expect(main).toContain("openExternalIfAllowed(url, (u) => shell.openExternal(u))");
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

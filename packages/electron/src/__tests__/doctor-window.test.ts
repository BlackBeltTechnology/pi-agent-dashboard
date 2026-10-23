/**
 * Channel-name-drift lint for the Doctor IPC bridge (risk #4 hardening).
 *
 * Asserts that every channel name registered in `doctor-window.ts` is
 * present in the `DoctorBridge` contract AND in `doctor-preload.ts`.
 *
 * See change: doctor-rich-output (task 3.10).
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCTOR_IPC_CHANNELS } from "../lib/doctor-bridge-contract.js";

const { created, openExternal } = vi.hoisted(() => ({
  created: [] as Array<{
    options: { webPreferences: Record<string, unknown> };
    openHandler?: (d: { url: string }) => { action: string };
    listeners: Map<string, (event: { preventDefault: () => void }, url: string) => void>;
    loaded: string[];
  }>,
  openExternal: vi.fn(),
}));

vi.mock("electron", () => {
  class BrowserWindow {
    private rec: (typeof created)[number];
    webContents: unknown;
    constructor(options: { webPreferences: Record<string, unknown> }) {
      this.rec = { options, listeners: new Map(), loaded: [] };
      created.push(this.rec);
      const rec = this.rec;
      this.webContents = {
        setWindowOpenHandler: (h: (d: { url: string }) => { action: string }) => {
          rec.openHandler = h;
        },
        on: (ev: string, cb: (event: { preventDefault: () => void }, url: string) => void) => {
          rec.listeners.set(ev, cb);
        },
      };
    }
    loadFile(f: string) {
      this.rec.loaded.push(f);
    }
    on() {}
    isDestroyed() {
      return false;
    }
    isMinimized() {
      return false;
    }
    restore() {}
    focus() {}
  }
  return {
    app: {},
    BrowserWindow,
    clipboard: { writeText: vi.fn() },
    ipcMain: { handle: vi.fn() },
    shell: { openExternal, openPath: vi.fn() },
  };
});
vi.mock("../lib/doctor.js", () => ({ runDoctor: vi.fn() }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(path.resolve(__dirname, "..", rel), "utf-8");
}

describe("Doctor IPC channel names", () => {
  it("every channel in DOCTOR_IPC_CHANNELS is registered with ipcMain.handle in doctor-window.ts", () => {
    const src = read("lib/doctor-window.ts");
    for (const ch of DOCTOR_IPC_CHANNELS) {
      expect(src.includes(`ipcMain.handle("${ch}"`)).toBe(true);
    }
  });

  it("every channel in DOCTOR_IPC_CHANNELS is consumed by ipcRenderer.invoke in doctor-preload.ts", () => {
    const src = read("preload/doctor-preload.ts");
    for (const ch of DOCTOR_IPC_CHANNELS) {
      expect(src.includes(`ipcRenderer.invoke("${ch}"`)).toBe(true);
    }
  });

  it("DoctorBridge interface has one method per channel (1-to-1 surface)", () => {
    // The interface lives in doctor-bridge-contract.ts; we count `\n  <name>(`
    // method declarations and assert N == DOCTOR_IPC_CHANNELS.length.
    const src = read("lib/doctor-bridge-contract.ts");
    // Match lines of the form `<spaces><name>(...): ...`
    const methodMatches = [...src.matchAll(/^\s{2}(\w+)\([^)]*\)\s*:/gm)].map((m) => m[1]);
    expect(methodMatches.length).toBe(DOCTOR_IPC_CHANNELS.length);
  });
});

describe("Doctor window hardening (BE34/BE35/BF3/BF4)", () => {
  async function open() {
    vi.resetModules();
    created.length = 0;
    openExternal.mockReset();
    const mod = await import("../lib/doctor-window.js");
    mod.openDoctorWindow();
    const rec = created[0];
    const docUrl = new URL(`file://${rec.loaded[0].startsWith("/") ? "" : "/"}${rec.loaded[0]}`).href;
    return { rec, docUrl };
  }

  beforeEach(() => {
    created.length = 0;
  });

  it("BE35 sandbox on, context isolation on, node integration off (same as the connecting window)", async () => {
    const { rec } = await open();
    expect(rec.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    const connecting = readFileSync(path.resolve(__dirname, "..", "lib/connecting-window.ts"), "utf-8");
    expect(connecting).toContain("sandbox: true");
  });

  it.each([
    ["https://example.com/a", true],
    ["http://example.com", true],
    ["HTTPS://EXAMPLE.COM", true],
    ["file:///etc/passwd", false],
    ["javascript:alert(1)", false],
    ["data:text/html,x", false],
    [" https://x", false],
    ["//evil.com", false],
    ["", false],
    ["http://", false],
  ])("BE34 window.open(%j) is always denied; external only when http(s)=%s", async (url, external) => {
    const { rec } = await open();
    expect(rec.openHandler?.({ url })).toEqual({ action: "deny" });
    if (external) expect(openExternal).toHaveBeenCalledWith(url);
    expect(openExternal).toHaveBeenCalledTimes(external ? 1 : 0);
  });

  it("BF3 an https link opens externally once and the window is not navigated", async () => {
    const { rec } = await open();
    expect(rec.openHandler?.({ url: "https://example.com/a" })).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/a");
    expect(rec.loaded).toHaveLength(1);
  });

  it.each(["https://evil.example", "file:///etc/passwd", "javascript:alert(1)", "about:blank"])(
    "BF4 will-navigate to %s is prevented",
    async (target) => {
      const { rec } = await open();
      const preventDefault = vi.fn();
      rec.listeners.get("will-navigate")?.({ preventDefault }, target);
      expect(preventDefault).toHaveBeenCalledTimes(1);
    },
  );

  it("BF4 reload and #hash change of the Doctor page are allowed", async () => {
    const { rec, docUrl } = await open();
    for (const target of [docUrl, `${docUrl}#top`]) {
      const preventDefault = vi.fn();
      rec.listeners.get("will-navigate")?.({ preventDefault }, target);
      expect(preventDefault).not.toHaveBeenCalled();
    }
    const preventDefault = vi.fn();
    rec.listeners.get("will-navigate")?.({ preventDefault }, `${docUrl}?x=1`);
    expect(preventDefault).toHaveBeenCalled();
  });
});

/**
 * BF5 (static half): a `sandbox: true` renderer only gets `require("electron")` in its
 * preload, so the shared wizard preload bundle must import nothing but `electron`, its
 * own `./preload/*` modules and type-only modules. The launched-window half was verified
 * in a real Electron smoke (sandboxed Doctor window, bridge exposed, report rendered).
 *
 * @structural-pin sandbox-safety of a preload is a property of its import graph; there is no runtime seam short of launching Electron
 */
describe("Doctor preload is sandbox-safe (BF5)", () => {
  const files = ["preload.ts", "preload/doctor-preload.ts", "preload/remote-connect-preload.ts", "preload/connecting-preload.ts"];
  it.each(files)("%s imports only electron, sibling preloads or types", (rel) => {
    const src = read(rel);
    const runtimeImports = [...src.matchAll(/^\s*import\s+(?!type\b)(?:[^"']*from\s+)?["']([^"']+)["']/gm)].map((m) => m[1]);
    for (const spec of runtimeImports) {
      expect(spec === "electron" || /^\.\/preload\/[\w-]+\.js$/.test(spec)).toBe(true);
    }
    expect(src).not.toMatch(/require\(\s*["'](?:node:)?(?:fs|path|child_process|os)["']/);
  });
});

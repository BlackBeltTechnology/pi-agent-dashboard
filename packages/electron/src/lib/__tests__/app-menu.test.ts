/**
 * Windows/Linux application menu structure + handlers (grouped Dashboard/Edit/View/Help).
 * Package-local vitest only. See change: electron-menu-submenus (test-plan S1–S31).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  app: { name: "PI Dashboard", getVersion: vi.fn(() => "9.9.9") },
  getFocusedWindow: vi.fn(),
  showMessageBox: vi.fn(),
  showOpenDialog: vi.fn(),
  buildFromTemplate: vi.fn(),
  setApplicationMenu: vi.fn(),
  showItemInFolder: vi.fn(),
  openPath: vi.fn(),
  checkForUpdatesNow: vi.fn(),
  getUpdateLogPath: vi.fn(),
  openDoctorWindow: vi.fn(),
  openRemoteConnectWindow: vi.fn(),
  useLocalDashboard: vi.fn(),
  pickLocalFolder: vi.fn(),
  stopUsingLocalFolder: vi.fn(),
  activationTarget: vi.fn(),
  getActiveRuntimeContext: vi.fn(),
  runRuntimeSwitch: vi.fn(),
}));

vi.mock("electron", () => ({
  app: m.app,
  BrowserWindow: { getFocusedWindow: m.getFocusedWindow },
  dialog: { showMessageBox: m.showMessageBox, showOpenDialog: m.showOpenDialog },
  Menu: { buildFromTemplate: m.buildFromTemplate, setApplicationMenu: m.setApplicationMenu },
  shell: { showItemInFolder: m.showItemInFolder, openPath: m.openPath },
}));
vi.mock("../app-updater.js", () => ({ checkForUpdatesNow: m.checkForUpdatesNow, getUpdateLogPath: m.getUpdateLogPath }));
vi.mock("../doctor-window.js", () => ({ openDoctorWindow: m.openDoctorWindow }));
vi.mock("../remote-connect-window.js", () => ({
  openRemoteConnectWindow: m.openRemoteConnectWindow,
  useLocalDashboard: m.useLocalDashboard,
}));
vi.mock("../runtime-overlay.js", () => ({
  activationTarget: m.activationTarget,
  pickLocalFolder: m.pickLocalFolder,
  stopUsingLocalFolder: m.stopUsingLocalFolder,
}));
vi.mock("../runtime-overlay-main.js", () => ({
  getActiveRuntimeContext: m.getActiveRuntimeContext,
  runRuntimeSwitch: m.runRuntimeSwitch,
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/runtime-overlay/state.js", () => ({
  getRuntimeOverlayDir: () => "/tmp/overlay",
}));

type Item = MenuItemConstructorOptions;
type Hooks = Parameters<typeof import("../servers-menu.js").setServersMenuHooks>[0];

const F = `sha256:${"A".repeat(43)}`;
const G = `sha256:${"B".repeat(43)}`;
const realPlatform = process.platform;
const realResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
const realElectronDev = process.env.ELECTRON_DEV;

const setPlatform = (p: string) => Object.defineProperty(process, "platform", { value: p, configurable: true });
const setResourcesPath = (v: string | undefined) => {
  if (v === undefined) Reflect.deleteProperty(process, "resourcesPath");
  else Object.defineProperty(process, "resourcesPath", { value: v, configurable: true, writable: true });
};
const setElectronDev = (on: boolean) => {
  if (on) process.env.ELECTRON_DEV = "1";
  else delete process.env.ELECTRON_DEV;
};

const flush = () => new Promise<void>((r) => setImmediate(r));
const subOf = (i: Item | undefined): Item[] => (Array.isArray(i?.submenu) ? (i?.submenu as Item[]) : []);
const top = (t: Item[], label: string): Item => {
  const hit = t.find((i) => i.label === label);
  if (!hit) throw new Error(`no top-level "${label}" in ${JSON.stringify(t.map((i) => i.label))}`);
  return hit;
};
const flatten = (items: Item[]): Item[] => items.flatMap((i) => [i, ...flatten(subOf(i))]);
const labelsOf = (items: Item[]) => items.map((i) => (i.type === "separator" ? "---" : (i.label ?? `role:${i.role}`)));
const shape = (t: unknown) => JSON.parse(JSON.stringify(t));
const click = (i: Item): unknown => (i.click as unknown as () => unknown)();

async function load(hooks?: Hooks) {
  const menu = await import("../app-menu.js");
  const servers = await import("../servers-menu.js");
  const consent = await import("../browser-host/consent.js");
  servers.setServersMenuHooks(hooks ?? { entries: () => [], open: vi.fn(), connectAnother: vi.fn() });
  return { ...menu, ...servers, ...consent };
}
const build = async (opts?: { isDev?: boolean }) => (await load()).buildWinLinuxMenuTemplate(opts);
const dashboard = (t: Item[]) => subOf(top(t, "Dashboard"));
const help = (t: Item[]) => subOf(top(t, "Help"));
const viewMenu = (t: Item[]) => subOf(top(t, "View"));
const helpItem = (t: Item[], label: string) => {
  const hit = help(t).find((i) => i.label === label);
  if (!hit) throw new Error(`no Help item "${label}"`);
  return hit;
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  m.buildFromTemplate.mockImplementation((template: Item[]) => ({ template }));
  m.showMessageBox.mockResolvedValue({ response: 0 });
  m.getActiveRuntimeContext.mockReturnValue(null);
  setElectronDev(false);
  setResourcesPath("/nonexistent/resources");
});

afterEach(() => {
  setPlatform(realPlatform);
  if (realResourcesPath) Object.defineProperty(process, "resourcesPath", realResourcesPath);
  else Reflect.deleteProperty(process, "resourcesPath");
  if (realElectronDev === undefined) delete process.env.ELECTRON_DEV;
  else process.env.ELECTRON_DEV = realElectronDev;
});

describe("Win/Linux grouped menu structure", () => {
  it("S1: top-level labels are Dashboard, Edit, View, Help in order", async () => {
    const t = await build({ isDev: false });
    expect(t.map((i) => i.label)).toEqual(["Dashboard", "Edit", "View", "Help"]);
    expect(t).toHaveLength(4);
  });

  it("S2: Dashboard group order, ending with a quit role", async () => {
    const t = await build({ isDev: false });
    const d = dashboard(t);
    expect(labelsOf(d)).toEqual([
      "Servers",
      "Connect to Remote Dashboard…",
      "Use Local Dashboard",
      "Runtime",
      "Browser relay",
      "---",
      "role:quit",
    ]);
    expect(Array.isArray(d[0]?.submenu)).toBe(true);
    expect(Array.isArray(d[3]?.submenu)).toBe(true);
    expect(Array.isArray(d[4]?.submenu)).toBe(true);
    expect(d.at(-1)).toEqual({ role: "quit" });
  });

  it("S3: Help group order with a plain 'Doctor' label", async () => {
    const t = await build({ isDev: false });
    expect(labelsOf(help(t))).toEqual(["Doctor", "Check for Updates…", "View Update Log", "---", "About"]);
  });

  it("S4: Check for Updates… is hidden in dev", async () => {
    const t = await build({ isDev: true });
    expect(labelsOf(help(t))).toEqual(["Doctor", "View Update Log", "---", "About"]);
    expect(flatten(t).some((i) => i.label === "Check for Updates…")).toBe(false);
  });

  it("S5: Edit group is exactly the standard roles", async () => {
    for (const opts of [{ isDev: false }, { isDev: true }]) {
      const e = subOf(top(await build(opts), "Edit"));
      expect(e).toEqual([
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ]);
    }
  });

  it("S6: View group keeps the previous items", async () => {
    const v = viewMenu(await build({ isDev: false }));
    expect(v).toHaveLength(9);
    expect(v[0]).toMatchObject({ label: "Reload", accelerator: "CmdOrCtrl+R" });
    expect(v[1]).toMatchObject({ label: "Force Reload", accelerator: "CmdOrCtrl+Shift+R" });
    expect(v.slice(2).map((i) => i.role ?? i.type)).toEqual([
      "toggleDevTools",
      "separator",
      "resetZoom",
      "zoomIn",
      "zoomOut",
      "separator",
      "togglefullscreen",
    ]);
  });

  it("S7: no flat top-level items — every top-level item is a submenu without click/role", async () => {
    for (const isDev of [false, true]) {
      for (const i of await build({ isDev })) {
        expect(Array.isArray(i.submenu)).toBe(true);
        expect(i.click).toBeUndefined();
        expect(i.role).toBeUndefined();
      }
    }
  });
});

describe("isDev resolution", () => {
  it("S8: default isDev follows ELECTRON_DEV × resourcesPath (decision table)", async () => {
    const cases: Array<[boolean, string | undefined, boolean]> = [
      [true, undefined, false],
      [true, "/res", false],
      [false, undefined, false],
      [false, "/res", true],
    ];
    for (const [env, rp, expectUpdates] of cases) {
      vi.resetModules();
      setElectronDev(env);
      setResourcesPath(rp);
      const t = (await load()).buildWinLinuxMenuTemplate();
      expect(flatten(t).some((i) => i.label === "Check for Updates…"), `env=${env} rp=${rp}`).toBe(expectUpdates);
    }
  });

  it("S9: explicit isDev wins over the environment both ways", async () => {
    setElectronDev(true);
    setResourcesPath("/res");
    expect(labelsOf(help(await build({ isDev: false })))).toContain("Check for Updates…");
    vi.resetModules();
    setElectronDev(false);
    expect(labelsOf(help(await build({ isDev: true })))).not.toContain("Check for Updates…");
  });
});

describe("setupAppMenu dispatch", () => {
  it.each(["win32", "linux"])("S10: %s uses the grouped builder", async (platform) => {
    setPlatform(platform);
    const { setupAppMenu } = await load();
    setupAppMenu();
    expect(m.buildFromTemplate).toHaveBeenCalledTimes(1);
    const template = m.buildFromTemplate.mock.calls[0]![0] as Item[];
    expect(template.map((i) => i.label)).toEqual(["Dashboard", "Edit", "View", "Help"]);
    expect(m.setApplicationMenu).toHaveBeenCalledTimes(1);
    expect(m.setApplicationMenu).toHaveBeenCalledWith(m.buildFromTemplate.mock.results[0]!.value);
  });

  it("S11: macOS template is unchanged", async () => {
    setPlatform("darwin");
    const { setupAppMenu } = await load();
    setupAppMenu();
    const template = m.buildFromTemplate.mock.calls[0]![0] as Item[];
    expect(template.map((i) => i.label)).toEqual(["PI Dashboard", "Edit", "View", "Window"]);
    const appMenu = subOf(template[0]);
    const labels = labelsOf(appMenu);
    for (const l of [
      "About PI Dashboard",
      "Doctor...",
      "Servers",
      "Connect to Remote Dashboard…",
      "Use Local Dashboard",
      "Runtime",
      "Browser relay",
      "role:hide",
      "role:hideOthers",
      "role:unhide",
      "role:quit",
    ])
      expect(labels).toContain(l);
    expect(template.some((i) => i.label === "Dashboard")).toBe(false);
  });

  it("S12: the builder is pure — fresh result each call, no Menu API use", async () => {
    const { buildWinLinuxMenuTemplate } = await load();
    const first = buildWinLinuxMenuTemplate({ isDev: false });
    const second = buildWinLinuxMenuTemplate({ isDev: false });
    first.push({ label: "Injected" });
    (first[0] as Item).label = "Renamed";
    subOf(first[3]).length = 0;
    const third = buildWinLinuxMenuTemplate({ isDev: false });
    expect(shape(second)).toEqual(shape(third));
    expect(second.map((i) => i.label)).toEqual(["Dashboard", "Edit", "View", "Help"]);
    expect(m.buildFromTemplate).not.toHaveBeenCalled();
    expect(m.setApplicationMenu).not.toHaveBeenCalled();
  });
});

describe("Dashboard group", () => {
  const entry = (fingerprint: string, label: string, needsPairing = false) => ({ fingerprint, label, needsPairing });

  it.each([
    ["0 entries", [], ["Connect to another dashboard…"]],
    ["1 entry", [entry(F, "home")], ["home", "---", "Connect to another dashboard…"]],
    [
      "2 entries",
      [entry(F, "home"), entry(G, "lab", true)],
      ["home", "lab — needs pairing", "---", "Connect to another dashboard…"],
    ],
  ])("S13: Servers submenu with %s", async (_n, entries, expected) => {
    const { buildWinLinuxMenuTemplate } = await load({ entries: () => entries, open: vi.fn(), connectAnother: vi.fn() });
    const d = dashboard(buildWinLinuxMenuTemplate({ isDev: false }));
    expect(d[0]?.label).toBe("Servers");
    expect(labelsOf(subOf(d[0]))).toEqual(expected);
  });

  it("S14: no duplicate labels or accelerators in the tree", async () => {
    const { buildWinLinuxMenuTemplate } = await load({
      entries: () => [entry(F, "home"), entry(G, "lab")],
      open: vi.fn(),
      connectAnother: vi.fn(),
    });
    const flat = flatten(buildWinLinuxMenuTemplate({ isDev: false })).filter((i) => i.type !== "separator");
    const labels = flat.map((i) => i.label).filter((l): l is string => !!l);
    expect(new Set(labels).size).toBe(labels.length);
    const accels = flat.map((i) => i.accelerator).filter((a): a is string => !!a);
    expect(new Set(accels).size).toBe(accels.length);
  });

  it("S15: Servers submenu stays live — a keyring change rebuilds the menu", async () => {
    setPlatform("linux");
    let entries = [entry(F, "alpha")];
    const { setupAppMenu, notifyServersMenuChanged } = await load({ entries: () => entries, open: vi.fn(), connectAnother: vi.fn() });
    setupAppMenu();
    entries = [entry(F, "alpha"), entry(G, "beta")];
    notifyServersMenuChanged();
    expect(m.setApplicationMenu).toHaveBeenCalledTimes(2);
    const rebuilt = (m.setApplicationMenu.mock.calls[1]![0] as { template: Item[] }).template;
    expect(labelsOf(subOf(dashboard(rebuilt)[0]))).toContain("beta");
  });

  it("S16: the rebuild listener is wired exactly once", async () => {
    setPlatform("linux");
    const { setupAppMenu, notifyServersMenuChanged } = await load();
    setupAppMenu();
    setupAppMenu();
    setupAppMenu();
    notifyServersMenuChanged();
    expect(m.setApplicationMenu).toHaveBeenCalledTimes(4);
  });

  it("S17: Connect / Use Local call only their handlers", async () => {
    const d = dashboard(await build({ isDev: false }));
    click(d.find((i) => i.label === "Connect to Remote Dashboard…")!);
    expect(m.openRemoteConnectWindow).toHaveBeenCalledTimes(1);
    expect(m.useLocalDashboard).not.toHaveBeenCalled();
    click(d.find((i) => i.label === "Use Local Dashboard")!);
    expect(m.useLocalDashboard).toHaveBeenCalledTimes(1);
    expect(m.openRemoteConnectWindow).toHaveBeenCalledTimes(1);
    expect(m.openDoctorWindow).not.toHaveBeenCalled();
  });

  it("S21: Browser relay → Revoke all still reaches the hook", async () => {
    const { buildWinLinuxMenuTemplate, setRevokeAllHook } = await load();
    const hook = vi.fn();
    setRevokeAllHook(hook);
    const relay = dashboard(buildWinLinuxMenuTemplate({ isDev: false })).find((i) => i.label === "Browser relay")!;
    click(subOf(relay).find((i) => i.label === "Revoke all")!);
    expect(hook).toHaveBeenCalledTimes(1);
    setRevokeAllHook(null);
  });

  it("S22: Exit is the quit role, not a custom click", async () => {
    const last = dashboard(await build({ isDev: false })).at(-1)!;
    expect(last.role).toBe("quit");
    expect(last.click).toBeUndefined();
  });

  it("S30: Runtime items with no active runtime context show 'not ready' only", async () => {
    const rt = dashboard(await build({ isDev: false })).find((i) => i.label === "Runtime")!;
    for (const label of ["Use Local Folder…", "Stop Using Local Folder"]) {
      m.showMessageBox.mockClear();
      click(subOf(rt).find((i) => i.label === label)!);
      await flush();
      expect(m.showMessageBox).toHaveBeenCalledTimes(1);
      expect(m.showMessageBox.mock.calls[0]![0]).toMatchObject({ title: "Runtime" });
    }
    expect(m.showOpenDialog).not.toHaveBeenCalled();
    expect(m.pickLocalFolder).not.toHaveBeenCalled();
    expect(m.runRuntimeSwitch).not.toHaveBeenCalled();
  });
});

describe("Help group handlers", () => {
  it("S18: Doctor opens the Doctor window", async () => {
    click(helpItem(await build({ isDev: false }), "Doctor"));
    await flush();
    expect(m.openDoctorWindow).toHaveBeenCalledTimes(1);
  });

  it("S24: update check error → warning dialog", async () => {
    m.checkForUpdatesNow.mockResolvedValue({ type: "error", message: "ENOTFOUND" });
    await click(helpItem(await build({ isDev: false }), "Check for Updates…"));
    expect(m.showMessageBox).toHaveBeenCalledTimes(1);
    expect(m.showMessageBox.mock.calls[0]![0]).toMatchObject({
      type: "warning",
      message: "Update check failed",
      detail: "ENOTFOUND",
    });
  });

  it("S25: up to date → info dialog with the version", async () => {
    m.checkForUpdatesNow.mockResolvedValue({ type: "up-to-date", version: "1.2.3" });
    await click(helpItem(await build({ isDev: false }), "Check for Updates…"));
    expect(m.showMessageBox).toHaveBeenCalledTimes(1);
    const arg = m.showMessageBox.mock.calls[0]![0] as { type: string; message: string; detail: string };
    expect(arg.type).toBe("info");
    expect(arg.message).toBe("You're up to date");
    expect(arg.detail).toContain("v1.2.3");
  });

  it("S26: update available → no dialog from the menu handler", async () => {
    m.checkForUpdatesNow.mockResolvedValue({ type: "update-available", version: "2.0.0" });
    await click(helpItem(await build({ isDev: false }), "Check for Updates…"));
    expect(m.showMessageBox).not.toHaveBeenCalled();
  });

  it("S27: View Update Log — missing path vs present path", async () => {
    const item = helpItem(await build({ isDev: false }), "View Update Log");
    m.getUpdateLogPath.mockReturnValue(null);
    click(item);
    expect(m.showMessageBox).toHaveBeenCalledTimes(1);
    expect(m.showMessageBox.mock.calls[0]![0]).toMatchObject({ message: "No update log available." });
    expect(m.showItemInFolder).not.toHaveBeenCalled();
    m.showMessageBox.mockClear();
    m.getUpdateLogPath.mockReturnValue("/tmp/u.log");
    click(item);
    expect(m.showItemInFolder).toHaveBeenCalledWith("/tmp/u.log");
    expect(m.showMessageBox).not.toHaveBeenCalled();
  });

  it("S28: About without a bundled git license", async () => {
    setResourcesPath(undefined);
    click(helpItem(await build({ isDev: false }), "About"));
    expect(m.showMessageBox).toHaveBeenCalledTimes(1);
    const arg = m.showMessageBox.mock.calls[0]![0] as { title: string; detail: string; buttons: string[] };
    expect(arg.title).toBe("About PI Dashboard");
    expect(arg.detail).toContain("Version 9.9.9");
    expect(arg.detail).toContain("© Blackbelt Technology");
    expect(arg.detail).not.toContain("Bundled Git");
    expect(arg.buttons).toEqual(["OK"]);
  });

  it("S29: About with a bundled git license offers the license button", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "app-menu-"));
    try {
      mkdirSync(path.join(dir, "git"));
      const file = path.join(dir, "git", "THIRD-PARTY-LICENSE.txt");
      writeFileSync(file, "Some header\nGit version: 2.45.1\n");
      setResourcesPath(dir);
      const about = helpItem(await build({ isDev: false }), "About");
      m.showMessageBox.mockResolvedValueOnce({ response: 1 });
      click(about);
      await flush();
      const arg = m.showMessageBox.mock.calls[0]![0] as { detail: string; buttons: string[] };
      expect(arg.buttons).toEqual(["OK", "Open Bundled Git License"]);
      expect(arg.detail).toContain("Bundled Git for Windows v2.45.1");
      expect(m.openPath).toHaveBeenCalledTimes(1);
      expect(m.openPath).toHaveBeenCalledWith(file);
      m.openPath.mockClear();
      m.showMessageBox.mockResolvedValueOnce({ response: 0 });
      click(about);
      await flush();
      expect(m.openPath).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("View group handlers", () => {
  it("S20: Reload and Force Reload hit the matching webContents methods", async () => {
    const win = { webContents: { reload: vi.fn(), reloadIgnoringCache: vi.fn() } };
    m.getFocusedWindow.mockReturnValue(win);
    const v = viewMenu(await build({ isDev: false }));
    click(v.find((i) => i.label === "Reload")!);
    expect(win.webContents.reload).toHaveBeenCalledTimes(1);
    expect(win.webContents.reloadIgnoringCache).not.toHaveBeenCalled();
    click(v.find((i) => i.label === "Force Reload")!);
    expect(win.webContents.reloadIgnoringCache).toHaveBeenCalledTimes(1);
    expect(win.webContents.reload).toHaveBeenCalledTimes(1);
  });

  it("S31: no focused window → Reload / Force Reload are no-ops", async () => {
    m.getFocusedWindow.mockReturnValue(null);
    const v = viewMenu(await build({ isDev: false }));
    expect(() => click(v.find((i) => i.label === "Reload")!)).not.toThrow();
    expect(() => click(v.find((i) => i.label === "Force Reload")!)).not.toThrow();
  });
});

/**
 * Servers submenu in the app menu and the tray menu.
 * See change: add-electron-server-windows (test-plan E33).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildServersSubmenu,
  notifyServersMenuChanged,
  onServersMenuChanged,
  type ServersMenuEntry,
  serversMenuItem,
  setServersMenuHooks,
} from "../servers-menu.js";
import { buildTrayMenuTemplate } from "../tray.js";

const F = `sha256:${"A".repeat(43)}`;
const G = `sha256:${"B".repeat(43)}`;
const noop = () => {};
const labels = (items: Array<{ label?: string; type?: string }>) => items.filter((i) => i.type !== "separator").map((i) => i.label);

let entries: ServersMenuEntry[];
const open = vi.fn();
const connectAnother = vi.fn();

beforeEach(() => {
  entries = [
    { fingerprint: F, label: "home-imac", needsPairing: false },
    { fingerprint: G, label: "lab-box", needsPairing: true },
  ];
  open.mockClear();
  connectAnother.mockClear();
  setServersMenuHooks({ entries: () => entries, open, connectAnother });
});

describe("Servers submenu (E33)", () => {
  it("lists entries by sanitised label with state in words, then Connect to another dashboard…", () => {
    const sub = serversMenuItem().submenu as Array<{ label?: string; type?: string; click?: () => void }>;
    expect(labels(sub)).toEqual(["home-imac", "lab-box — needs pairing", "Connect to another dashboard…"]);
    sub[0]!.click!();
    expect(open).toHaveBeenCalledWith(F);
    sub.at(-1)!.click!();
    expect(connectAnother).toHaveBeenCalled();
  });

  it("an untrusted label with a bidi override is sanitised in the menu", () => {
    const sub = buildServersSubmenu([{ fingerprint: F, label: "\u202Ecod.exe", needsPairing: false }], noop, noop);
    expect(JSON.stringify(sub)).not.toContain("\u202E");
  });

  it("no entries ⇒ only Connect to another dashboard…", () => {
    entries = [];
    expect(labels(serversMenuItem().submenu as never)).toEqual(["Connect to another dashboard…"]);
  });

  it("the tray template carries the same submenu, and a rebuild after forget drops the entry", () => {
    const tray = () =>
      buildTrayMenuTemplate({ ownership: "none", onLaunch: noop, onShow: noop, onQuit: noop, servers: serversMenuItem() });
    const submenuLabels = (t: ReturnType<typeof tray>) => labels(t.find((i) => i.label === "Servers")!.submenu as never);
    expect(submenuLabels(tray())).toContain("home-imac");
    entries = entries.filter((e) => e.fingerprint !== F); // user forgets home-imac
    const rebuilt = vi.fn();
    const off = onServersMenuChanged(rebuilt);
    notifyServersMenuChanged();
    expect(rebuilt).toHaveBeenCalled();
    expect(submenuLabels(tray())).not.toContain("home-imac");
    expect(submenuLabels(tray())).toContain("lab-box — needs pairing");
    off();
  });

  it("tray without a servers item keeps the legacy shape", () => {
    const t = buildTrayMenuTemplate({ ownership: "unknown", onLaunch: noop, onShow: noop, onQuit: noop });
    expect(t.map((i) => i.label).filter(Boolean)).toEqual(["Show", "Quit"]);
  });

  it("a throwing rebuild never breaks the notifier", () => {
    const off = onServersMenuChanged(() => {
      throw new Error("boom");
    });
    expect(() => notifyServersMenuChanged()).not.toThrow();
    off();
  });
});

describe("app menu carries the Servers submenu on every platform (E33)", () => {
  async function templateFor(platform: NodeJS.Platform) {
    vi.resetModules();
    let template: Array<Record<string, unknown>> = [];
    vi.doMock("electron", () => ({
      app: { name: "PI Dashboard", getVersion: () => "0", isPackaged: false },
      BrowserWindow: { getFocusedWindow: () => null },
      dialog: {},
      shell: {},
      Menu: { buildFromTemplate: (t: Array<Record<string, unknown>>) => (template = t), setApplicationMenu: vi.fn() },
    }));
    const orig = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: platform });
    try {
      const sm = await import("../servers-menu.js");
      sm.setServersMenuHooks({ entries: () => entries, open, connectAnother });
      const { setupAppMenu } = await import("../app-menu.js");
      setupAppMenu();
    } finally {
      Object.defineProperty(process, "platform", orig);
    }
    return template;
  }
  const find = (t: any[]): any => {
    for (const i of t) {
      if (i.label === "Servers") return i;
      if (Array.isArray(i.submenu)) {
        const f = find(i.submenu);
        if (f) return f;
      }
    }
    return undefined;
  };

  it.each(["darwin", "win32", "linux"] as const)("%s", async (platform) => {
    const servers = find(await templateFor(platform));
    expect(servers).toBeDefined();
    expect(labels(servers.submenu)).toEqual(["home-imac", "lab-box — needs pairing", "Connect to another dashboard…"]);
  });
});

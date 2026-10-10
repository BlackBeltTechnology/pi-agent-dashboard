/**
 * `<EmbeddedApp>` — embedded `AppHost`, board-style top bar, host navigation
 * validation, return pill, and the D9 states.
 *
 * See change: add-plugin-app-host (test-plan #E10, #E11, #E13, #E14, #E15,
 * #E17, #X1, #X2, #X3).
 */
import { type AppHost, type DashboardAppDefinition, useAppHost } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { EmbeddedApp } from "../embedded-app.js";
import {
  createReturnTargetStore,
  EmbeddedAppReturnPill,
  type EmbeddedAppShell,
  EmbeddedAppShellProvider,
} from "../embedded-app-shell.js";

function encodeFolder(cwd: string): string {
  return btoa(cwd).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeFolder(enc: string): string | null {
  try {
    const padded = enc.replace(/-/g, "+").replace(/_/g, "/");
    return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  } catch {
    return null;
  }
}

function makeShell(): EmbeddedAppShell {
  return {
    fetch: vi.fn(async () => new Response("ok")),
    wsUrl: vi.fn(async () => "ws://x/ws"),
    encodeFolder,
    decodeFolder,
    returnTarget: createReturnTargetStore(),
  };
}

const CWD = "/home/u/acme-erp";
const ENC = encodeFolder(CWD);
const BASE = `/folder/${ENC}/wall`;

let captured: AppHost | null = null;
let renders = 0;

function HostProbe({ onMount }: { onMount?: (h: AppHost) => void }) {
  const host = useAppHost();
  captured = host;
  renders++;
  useEffect(() => {
    onMount?.(host);
  }, [host, onMount]);
  return <div data-testid="probe-app">app</div>;
}

function app(over: Partial<DashboardAppDefinition> = {}, onMount?: (h: AppHost) => void): DashboardAppDefinition {
  return { id: "wall", title: "Wall", App: () => <HostProbe onMount={onMount} />, ...over };
}

let outerLocation = "";
function LocationSpy() {
  const [loc] = useLocation();
  outerLocation = loc;
  return null;
}

function mount(
  ui: React.ReactNode,
  { path = BASE, shell = makeShell() as EmbeddedAppShell | null } = {},
) {
  const mem = memoryLocation({ path, record: true });
  const r = render(
    <Router hook={mem.hook}>
      <LocationSpy />
      {shell ? <EmbeddedAppShellProvider shell={shell}>{ui}<EmbeddedAppReturnPill /></EmbeddedAppShellProvider> : ui}
    </Router>,
  );
  return { ...r, mem, shell };
}

beforeEach(() => {
  captured = null;
  renders = 0;
  outerLocation = "";
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("navigateDashboard validation (#E10)", () => {
  it.each(["/session/x", "/folder/abc"])("valid %s → one push", (path) => {
    const { mem } = mount(<EmbeddedApp app={app()} basePath={BASE} folderParam={ENC} onBack={() => {}} />);
    act(() => captured!.navigateDashboard(path));
    expect(mem.history).toEqual([BASE, path]);
  });

  it.each([
    "//evil.example/x",
    "/\\evil.example/x",
    "javascript:alert(1)",
    "https://a.b",
    "/apps/wall",
    "/a/../apps/x",
    "/a%2F..%2F..",
    "/a b",
    "/a\u0000",
    "",
  ])("invalid %j → no navigation, one warning naming the app", (path) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { mem } = mount(<EmbeddedApp app={app()} basePath={BASE} folderParam={ENC} onBack={() => {}} />);
    act(() => captured!.navigateDashboard(path));
    expect(mem.history).toEqual([BASE]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("wall");
  });
});

describe("openSession / openFolder encoding (#E11)", () => {
  it("encodes the session id and the folder", () => {
    const { mem } = mount(<EmbeddedApp app={app()} basePath={BASE} folderParam={ENC} onBack={() => {}} />);
    act(() => captured!.openSession("a/../../apps/x"));
    expect(mem.history!.at(-1)).toBe("/session/a%2F..%2F..%2Fapps%2Fx");
    act(() => captured!.openFolder("/home/u/acme erp"));
    expect(mem.history!.at(-1)).toBe(`/folder/${encodeFolder("/home/u/acme erp")}`);
  });
});

describe("embedded host fields + standaloneUrl (#E13)", () => {
  it("folder-scoped with standaloneUrl", () => {
    mount(<EmbeddedApp app={app()} basePath={BASE} folderParam={ENC} standaloneUrl="/apps/wall/" onBack={() => {}} />);
    expect(captured!.mode).toBe("embedded");
    expect(captured!.capabilities.dashboard).toBe(true);
    expect(captured!.capabilities.standaloneUrl).toBe("/apps/wall/");
    expect(captured!.basePath).toBe(BASE);
    expect(captured!.folder).toEqual({ cwd: CWD, name: "acme-erp" });
    expect(screen.getByTestId("embedded-app-open-standalone")).toBeTruthy();
  });

  it("folder name ignores trailing separators", () => {
    mount(<EmbeddedApp app={app()} basePath={BASE} folderParam={encodeFolder("/home/u/acme-erp//")} onBack={() => {}} />);
    expect(captured!.folder).toEqual({ cwd: "/home/u/acme-erp//", name: "acme-erp" });
  });

  it("without folderParam and standaloneUrl: no folder, no button", () => {
    mount(<EmbeddedApp app={app()} basePath="/team" onBack={() => {}} />, { path: "/team" });
    expect(captured!.folder).toBeUndefined();
    expect(captured!.capabilities.standaloneUrl).toBeUndefined();
    expect(screen.queryByTestId("embedded-app-open-standalone")).toBeNull();
  });

  it("api goes through the shell transport", async () => {
    const shell = makeShell();
    mount(<EmbeddedApp app={app()} basePath={BASE} folderParam={ENC} onBack={() => {}} />, { shell });
    await captured!.api.fetch("/api/x");
    expect(shell.fetch).toHaveBeenCalledWith("/api/x");
  });
});

describe("top bar zones and action overflow (#E14)", () => {
  const Chip = () => <span data-testid="ctx-chip">Q3</span>;
  const actions = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `a${i}`, label: `Act ${i}`, onSelect: vi.fn() }));

  it("folder breadcrumb, HeaderContext between breadcrumb and actions, 2 inline / no overflow", () => {
    mount(<EmbeddedApp app={app({ HeaderContext: Chip }, (h) => h.setActions(actions(2)))} basePath={BASE} folderParam={ENC} onBack={() => {}} />);
    expect(screen.getByTestId("embedded-app-breadcrumb").textContent).toBe("acme-erp › Wall");
    const bar = screen.getByTestId("embedded-app-topbar");
    const order = [...bar.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid"));
    const crumb = order.indexOf("embedded-app-breadcrumb");
    const chip = order.indexOf("embedded-app-header-context");
    const acts = order.indexOf("embedded-app-actions");
    expect(crumb).toBeGreaterThanOrEqual(0);
    expect(crumb).toBeLessThan(chip);
    expect(chip).toBeLessThan(acts);
    expect(screen.getByTestId("embedded-app-actions").querySelectorAll("button")).toHaveLength(2);
    // The overflow trigger exists only for the narrow fold; no wide overflow entries.
    fireEvent.click(screen.getByTestId("embedded-app-overflow"));
    const menu = screen.getByTestId("embedded-app-overflow-menu");
    expect(menu.querySelectorAll('[data-overflow="true"]')).toHaveLength(0);
  });

  it("3 actions → 2 inline + the 3rd in the overflow menu", () => {
    mount(<EmbeddedApp app={app({}, (h) => h.setActions(actions(3)))} basePath={BASE} folderParam={ENC} onBack={() => {}} />);
    const inline = screen.getByTestId("embedded-app-actions").querySelectorAll("button");
    expect([...inline].map((b) => b.textContent)).toEqual(["Act 0", "Act 1"]);
    fireEvent.click(screen.getByTestId("embedded-app-overflow"));
    const overflow = screen.getByTestId("embedded-app-overflow-menu").querySelectorAll('[data-overflow="true"]');
    expect([...overflow].map((b) => b.textContent)).toEqual(["Act 2"]);
  });

  it("no actions: no overflow trigger, even with a standalone URL", () => {
    mount(<EmbeddedApp app={app()} basePath={BASE} folderParam={ENC} standaloneUrl="/apps/wall/" onBack={() => {}} />);
    expect(screen.queryByTestId("embedded-app-overflow")).toBeNull();
    expect(screen.getByTestId("embedded-app-open-standalone")).toBeTruthy();
  });

  it("global app: breadcrumb shows only the title", () => {
    mount(<EmbeddedApp app={app()} basePath="/team" onBack={() => {}} />, { path: "/team" });
    expect(screen.getByTestId("embedded-app-breadcrumb").textContent).toBe("Wall");
  });
});

describe("openStandalone (#E15)", () => {
  it("defaults to the current app route, reuses one named window, validates appPath", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(<EmbeddedApp app={app()} basePath={BASE} folderParam={ENC} standaloneUrl="/apps/wall/" onBack={() => {}} />, {
      path: `${BASE}/graph`,
    });
    act(() => captured!.openStandalone());
    act(() => captured!.openStandalone());
    act(() => captured!.openStandalone("#/s/tok"));
    act(() => captured!.openStandalone("javascript:x"));
    expect(open.mock.calls).toEqual([
      ["/apps/wall/graph", "pi-app-wall"],
      ["/apps/wall/graph", "pi-app-wall"],
      ["/apps/wall/#/s/tok", "pi-app-wall"],
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("return pill (#E17)", () => {
  it("context = last setTitle; activation pushes the app path and clears", () => {
    const { mem } = mount(
      <EmbeddedApp app={app({}, (h) => h.setTitle("Q3 sync"))} basePath={BASE} folderParam={ENC} onBack={() => {}} />,
      { path: `${BASE}/graph` },
    );
    act(() => captured!.openSession("abc"));
    expect(outerLocation).toBe("/session/abc");
    const pill = screen.getByTestId("embedded-app-return-pill");
    expect(pill.textContent).toBe("← Wall · Q3 sync");
    act(() => fireEvent.click(pill));
    expect(mem.history!.at(-1)).toBe(`${BASE}/graph`);
    expect(screen.queryByTestId("embedded-app-return-pill")).toBeNull();
  });

  it("untitled folder app → folder name; navigating elsewhere clears", () => {
    const shell = makeShell();
    const { mem } = mount(<EmbeddedApp app={app()} basePath={BASE} folderParam={ENC} onBack={() => {}} />, { shell });
    act(() => captured!.openSession("abc"));
    expect(screen.getByTestId("embedded-app-return-pill").textContent).toBe("← Wall · acme-erp");
    act(() => mem.navigate("/settings"));
    expect(screen.queryByTestId("embedded-app-return-pill")).toBeNull();
    expect(shell.returnTarget.get()).toBeNull();
  });

  it("untitled global app → title only; a second navigation replaces the target", () => {
    const shell = makeShell();
    mount(<EmbeddedApp app={app({ title: "Team", id: "team" })} basePath="/team" onBack={() => {}} />, {
      path: "/team",
      shell,
    });
    const host = captured!;
    act(() => host.openSession("abc"));
    expect(screen.getByTestId("embedded-app-return-pill").textContent).toBe("← Team");
    act(() => host.openFolder("/x"));
    expect(shell.returnTarget.get()?.dest).toBe(`/folder/${encodeFolder("/x")}`);
  });
});

describe("states (#X1, #X2, #X3)", () => {
  it("X1: crash boundary shows Reload app + Back; Back → onBack; Reload remounts", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    let attempts = 0;
    const Boom = () => {
      attempts++;
      if (shouldThrow) throw new Error("boom");
      return <div data-testid="recovered">ok</div>;
    };
    const onBack = vi.fn();
    mount(<EmbeddedApp app={app({ App: Boom })} basePath={BASE} folderParam={ENC} onBack={onBack} />);
    const crashed = screen.getByTestId("embedded-app-crashed");
    expect(crashed.textContent).toContain("Reload app");
    fireEvent.click(screen.getAllByText("Back").find((el) => crashed.contains(el))!);
    expect(onBack).toHaveBeenCalledTimes(1);
    shouldThrow = false;
    const before = attempts;
    fireEvent.click(screen.getByText("Reload app"));
    expect(attempts).toBeGreaterThan(before);
    expect(screen.getByTestId("recovered")).toBeTruthy();
    // Shell chrome survives the crash.
    expect(screen.getByTestId("embedded-app-topbar")).toBeTruthy();
  });

  it("X2: undecodable folderParam → Folder not found + Back, app not rendered", () => {
    const onBack = vi.fn();
    mount(<EmbeddedApp app={app()} basePath={BASE} folderParam="%%%not-base64" onBack={onBack} />);
    expect(screen.getByTestId("embedded-app-folder-not-found").textContent).toContain("Folder not found");
    expect(screen.queryByTestId("probe-app")).toBeNull();
    fireEvent.click(screen.getByText("Back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("X3: no shell provider → error state, nothing thrown", () => {
    expect(() =>
      mount(<EmbeddedApp app={app()} basePath={BASE} folderParam={ENC} onBack={() => {}} />, { shell: null }),
    ).not.toThrow();
    expect(screen.getByTestId("embedded-app-no-shell")).toBeTruthy();
    expect(screen.queryByTestId("probe-app")).toBeNull();
  });
});

describe("app router is based at basePath", () => {
  it("the app sees its route relative to basePath", () => {
    let inner = "";
    const Inner = () => {
      inner = useLocation()[0];
      return null;
    };
    mount(<EmbeddedApp app={app({ App: Inner })} basePath={BASE} folderParam={ENC} onBack={() => {}} />, {
      path: `${BASE}/graph/node-1`,
    });
    expect(inner).toBe("/graph/node-1");
    expect(renders).toBe(0);
  });
});

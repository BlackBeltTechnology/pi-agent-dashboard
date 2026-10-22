/**
 * Connection chip + Access group of the ServerSelector menu.
 * See change: declutter-sidebar-header (test-plan #E6 #E7 #E8 #F1 #F2 #F3 #F10 #X2).
 */

import { mdiAccessPointNetwork, mdiCloudOffOutline, mdiDownload, mdiLaptop, mdiLaptopOff, mdiServerNetwork, mdiServerNetworkOff } from "@mdi/js";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listKnownServers } from "../../lib/api/known-servers-api.js";
import { type AccessItem, currentServerKind, ServerSelector } from "../connectivity/ServerSelector.js";

vi.mock("../../lib/api/known-servers-api.js", () => ({
  listKnownServers: vi.fn(async () => []),
  probeKnownServer: vi.fn(async () => null),
  acceptKnownServerMove: vi.fn(async () => true),
}));

beforeEach(() => {
  (globalThis as any).fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const known = (host: string, label: string) => ({ host, port: 8000, label, addedAt: "2024-01-01T00:00:00Z" });
const chip = () => screen.getByTestId("connection-chip") as HTMLButtonElement;
const pathD = (el: Element) => el.querySelector("path")?.getAttribute("d");

function accessItems(over: { install?: boolean; onSelect?: AccessItem["onSelect"]; pending?: number } = {}): AccessItem[] {
  const onSelect = over.onSelect ?? vi.fn();
  return [
    {
      id: "remote-access",
      label: "Remote access",
      sublabel: over.pending ? `listening on the network, ${over.pending} ${over.pending === 1 ? "device" : "devices"} waiting` : "this computer only",
      icon: mdiAccessPointNetwork,
      testId: "tunnel-btn",
      opensDialog: true,
      onSelect,
    },
    ...(over.install ? [{ id: "install-app", label: "Install as app", icon: mdiDownload, testId: "install-btn", onSelect }] : []),
  ];
}

const open = async (el = chip()) => {
  el.focus();
  fireEvent.keyDown(el, { key: "Enter" });
  await act(async () => {});
  return screen.findByRole("menu", { hidden: true });
};

describe("connection chip", () => {
  it("E6: remote-access tones differ by shape; local/network show none; the name says which", () => {
    const d: Record<string, string | null | undefined> = {};
    for (const tone of ["local", "network", "internet", "partial", "failed"] as const) {
      const { unmount } = render(
        <ServerSelector currentHost="my-pc" currentPort={8000} connected onSwitch={() => {}} remoteAccess={{ tone, state: tone, pending: 0 }} />,
      );
      const glyph = screen.queryByTestId("connection-chip-tone");
      d[tone] = glyph ? pathD(glyph) : null;
      if (tone === "local" || tone === "network") expect(glyph).toBeNull();
      else expect(chip().getAttribute("aria-label")).toContain(`remote access ${tone}`);
      unmount();
    }
    expect(new Set([d.internet, d.partial, d.failed]).size).toBe(3);
  });

  it("E7: the waiting-device badge shows the raw count and joins the accessible name", () => {
    const { rerender } = render(
      <ServerSelector currentHost="my-pc" currentPort={8000} connected onSwitch={() => {}} remoteAccess={{ tone: "network", state: "x", pending: 0 }} />,
    );
    expect(screen.queryByTestId("tunnel-btn-badge")).toBeNull();
    rerender(<ServerSelector currentHost="my-pc" currentPort={8000} connected onSwitch={() => {}} remoteAccess={{ tone: "network", state: "x", pending: 1 }} />);
    expect(screen.getByTestId("tunnel-btn-badge").textContent).toBe("1");
    expect(chip().getAttribute("aria-label")).toContain("1 device waiting");
    rerender(<ServerSelector currentHost="my-pc" currentPort={8000} connected onSwitch={() => {}} remoteAccess={{ tone: "network", state: "x", pending: 12 }} />);
    expect(screen.getByTestId("tunnel-btn-badge").textContent).toBe("12");
    expect(chip().getAttribute("aria-label")).toContain("12 devices waiting");
  });

  it("X1: offline is not colour-only — accessible name, offline glyph and word are rendered; no cloud glyph, no 'Connected'", () => {
    render(<ServerSelector currentHost="my-pc" currentPort={8000} connected={false} onSwitch={() => {}} remoteAccess={{ tone: "failed", state: "failed", pending: 1 }} />);
    expect(chip().getAttribute("aria-label")).toBe("Server: my-pc, offline; remote access failed, 1 device waiting");
    expect(chip().getAttribute("aria-label")).toContain("offline");
    expect(within(chip()).getByText("Offline")).toBeTruthy();
    expect(screen.getByTestId("connection-chip-offline-glyph")).toBeTruthy();
    const paths = [...chip().querySelectorAll("path")].map((p) => p.getAttribute("d"));
    expect(paths).not.toContain(mdiCloudOffOutline);
    expect(chip().textContent).not.toContain("Connected");
  });

  it("E8: a long server label is capped (max-w-24 → 160 px from 480) and named in title and aria-label", async () => {
    const label = "pi-dashboard-31f4d8185a43-studio";
    vi.mocked(listKnownServers).mockResolvedValue([known("my-pc", label)] as never);
    render(<ServerSelector currentHost="my-pc" currentPort={8000} connected onSwitch={() => {}} />);
    await act(async () => {});
    const name = within(chip()).getByText(label);
    expect(name.className).toContain("max-w-24");
    expect(name.className).toContain("@min-[480px]:max-w-40");
    expect(chip().getAttribute("title")).toBe(`${label}: switch server`);
    expect(chip().getAttribute("aria-label")).toContain(label);
  });

  it("E9: currentServerKind decision table", () => {
    expect(currentServerKind({ isLocal: true }, "anything")).toBe("local");
    expect(currentServerKind({ isLocal: false }, "localhost")).toBe("remote");
    expect(currentServerKind(undefined, "127.0.0.1")).toBe("local");
    expect(currentServerKind(undefined, "[::1]")).toBe("local");
    expect(currentServerKind(undefined, "192.168.1.5")).toBe("remote");
    expect(currentServerKind(undefined, "localhost")).toBe("local");
  });

  it("E10: glyph names the server kind and the offline state; the dot badge is aria-hidden", () => {
    const cases = [
      { host: "localhost", connected: true, kind: "local", d: mdiLaptop },
      { host: "my-pc", connected: true, kind: "remote", d: mdiServerNetwork },
      { host: "localhost", connected: false, kind: "local", d: mdiLaptopOff },
      { host: "my-pc", connected: false, kind: "remote", d: mdiServerNetworkOff },
    ] as const;
    for (const c of cases) {
      const { unmount } = render(<ServerSelector currentHost={c.host} currentPort={8000} connected={c.connected} onSwitch={() => {}} />);
      const glyph = screen.getByTestId("connection-chip-glyph");
      expect(glyph.getAttribute("data-kind")).toBe(c.kind);
      expect(glyph.getAttribute("data-offline")).toBe(String(!c.connected));
      expect(glyph.querySelector("svg path")?.getAttribute("d")).toBe(c.d);
      expect(!!screen.queryByTestId("connection-chip-offline-glyph")).toBe(!c.connected);
      expect(glyph.querySelector('span[aria-hidden="true"]')).toBeTruthy();
      unmount();
    }
  });

  it("E11: a 127.0.0.1 current host keeps its address as the visible name and reads as local", () => {
    render(<ServerSelector currentHost="127.0.0.1" currentPort={8000} connected onSwitch={() => {}} />);
    expect(within(chip()).getByText("127.0.0.1")).toBeTruthy();
    expect(screen.getByTestId("connection-chip-glyph").getAttribute("data-kind")).toBe("local");
  });

  it("X2: an unresolved non-loopback current host renders as remote with its address", () => {
    render(<ServerSelector currentHost="10.0.0.9" currentPort={8000} connected onSwitch={() => {}} />);
    expect(screen.getByTestId("connection-chip-glyph").getAttribute("data-kind")).toBe("remote");
    expect(within(chip()).getByText("10.0.0.9")).toBeTruthy();
  });
});

describe("Access group", () => {
  beforeEach(() => {
    vi.mocked(listKnownServers).mockResolvedValue([known("office-mac.local", "office-mac"), known("build-box.lan", "build-box")] as never);
  });

  it("E8: Install is present only when the caller supplies it (canInstall && !isInstalled)", async () => {
    for (const [install, expected] of [[true, true], [false, false]] as const) {
      render(<ServerSelector currentHost="localhost" currentPort={8000} connected onSwitch={() => {}} accessItems={accessItems({ install })} />);
      await open();
      expect(!!screen.queryByTestId("install-btn")).toBe(expected);
      expect(screen.getByTestId("tunnel-btn").getAttribute("role")).toBe("menuitem");
      cleanup();
    }
  });

  it("F1: arrows reach Manage servers → Remote access → Install and skip the group label; Home/End wrap", async () => {
    render(
      <ServerSelector currentHost="localhost" currentPort={8000} connected onSwitch={() => {}} onManageServers={() => {}} accessItems={accessItems({ install: true })} />,
    );
    const menu = await open();
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
    const labelNode = screen.getByText("Access");
    expect(items).not.toContain(labelNode);
    expect(labelNode.closest('[role="group"]')?.getAttribute("aria-labelledby")).toBe(labelNode.id);
    expect(document.activeElement).toBe(items[0]);
    const last = items.length - 1;
    for (let i = 1; i <= last; i++) {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
      expect(document.activeElement).toBe(items[i]);
    }
    expect(items[last]?.getAttribute("data-testid")).toBe("install-btn");
    expect(items[last - 1]?.getAttribute("data-testid")).toBe("tunnel-btn");
    expect(items[last - 2]?.textContent).toContain("Manage servers");
    fireEvent.keyDown(items[last] as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0] as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(items[last]);
  });

  it("F2/F3: keyboard open focuses the first item; Escape unmounts and focuses the trigger", async () => {
    render(<ServerSelector currentHost="localhost" currentPort={8000} connected onSwitch={() => {}} accessItems={accessItems()} />);
    const menu = await open();
    expect(menu.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
    expect(document.activeElement).toBe(chip());
  });

  it("F10: Install selection closes the menu, focuses the chip and calls prompt once", async () => {
    const prompt = vi.fn();
    render(
      <ServerSelector currentHost="localhost" currentPort={8000} connected onSwitch={() => {}} accessItems={[{ id: "install-app", label: "Install as app", icon: mdiDownload, testId: "install-btn", onSelect: prompt }]} />,
    );
    await open();
    fireEvent.click(screen.getByTestId("install-btn"));
    expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
    expect(document.activeElement).toBe(chip());
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("an opensDialog item closes the menu WITHOUT focusing the trigger and passes this chip's element", async () => {
    const onSelect = vi.fn();
    render(<ServerSelector currentHost="localhost" currentPort={8000} connected onSwitch={() => {}} accessItems={accessItems({ onSelect })} />);
    await open();
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(screen.getByTestId("tunnel-btn"));
    expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
    expect(document.activeElement).not.toBe(chip());
    expect(onSelect).toHaveBeenCalledWith(chip());
  });
});

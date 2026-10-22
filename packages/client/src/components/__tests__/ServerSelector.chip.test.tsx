/**
 * Connection chip + Access group of the ServerSelector menu.
 * See change: declutter-sidebar-header (test-plan #E6 #E7 #E8 #F1 #F2 #F3 #F10 #X2).
 */

import { mdiAccessPointNetwork, mdiDownload } from "@mdi/js";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listKnownServers } from "../../lib/api/known-servers-api.js";
import { type AccessItem, ServerSelector } from "../connectivity/ServerSelector.js";

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

  it("X2: offline is not colour-only — accessible name, visible word and glyph are all rendered", () => {
    render(<ServerSelector currentHost="my-pc" currentPort={8000} connected={false} onSwitch={() => {}} remoteAccess={{ tone: "failed", state: "failed", pending: 1 }} />);
    expect(chip().getAttribute("aria-label")).toBe("Server: my-pc, offline; remote access failed, 1 device waiting");
    expect(within(chip()).getByText("Offline")).toBeTruthy();
    expect(screen.getByTestId("connection-chip-offline-glyph")).toBeTruthy();
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

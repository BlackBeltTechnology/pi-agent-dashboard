import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listKnownServers, probeKnownServer } from "../../lib/api/known-servers-api.js";
import { ServerSelector } from "../connectivity/ServerSelector.js";

vi.mock("../../lib/api/known-servers-api.js", () => ({
  listKnownServers: vi.fn(async () => [
    { host: "my-pc", port: 8000, label: "my-pc" },
  ]),
  // Server-side probe: null = unavailable/refused → "Unreachable".
  probeKnownServer: vi.fn(async () => null),
  acceptKnownServerMove: vi.fn(async () => true),
}));

describe("ServerSelector", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((url: string) => {
      // localhost is dead, my-pc is alive
      if (url.includes("localhost") || url.includes("127.0.0.1")) {
        return Promise.reject(new Error("refused"));
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true }),
      } as Response);
    });
    (globalThis as any).fetch = fetchMock;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does NOT probe on mount—only when dropdown opens", async () => {
    render(
      <ServerSelector
        currentHost="my-pc"
        currentPort={8000}
        connected={true}
        onSwitch={() => {}}
      />,
    );
    // Give the component + knownServers async load a flush; then assert the
    // stable absence of any health probe.
    await act(async () => {});
    const healthCalls = fetchMock.mock.calls
      .map((c) => c[0] as string)
      .filter((u) => u.includes("/api/health"));
    expect(healthCalls).toHaveLength(0);
  });

  it("probes once when dropdown opens, not again until it reopens", async () => {
    render(
      <ServerSelector
        currentHost="my-pc"
        currentPort={8000}
        connected={true}
        onSwitch={() => {}}
      />,
    );
    const btn = screen.getByTitle("Switch server");
    act(() => btn.click()); // open
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.includes("localhost:8000/api/health"))).toBe(true);
    });
    const countAfterFirstOpen = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/health"),
    ).length;
    // Close dropdown
    act(() => btn.click());
    // Flush microtasks — nothing should probe after the close.
    await act(async () => {});
    const countAfterClose = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/health"),
    ).length;
    expect(countAfterClose).toBe(countAfterFirstOpen);
  });

  it("renders Unreachable badge for localhost when probe fails", async () => {
    render(
      <ServerSelector
        currentHost="my-pc"
        currentPort={8000}
        connected={true}
        onSwitch={() => {}}
      />,
    );
    // open the dropdown
    const btn = screen.getByTitle("Switch server");
    act(() => btn.click());
    await waitFor(() => {
      const unreachable = screen.queryAllByText(/Unreachable/i);
      expect(unreachable.length).toBeGreaterThan(0);
    });
  });

  it("unreachable entry is disabled and does NOT fire onSwitch when clicked", async () => {
    const onSwitch = vi.fn();
    render(
      <ServerSelector
        currentHost="my-pc"
        currentPort={8000}
        connected={true}
        onSwitch={onSwitch}
      />,
    );
    const btn = screen.getByTitle("Switch server");
    act(() => btn.click());
    await waitFor(() => screen.queryByText(/Unreachable/i));
    const localEntry = screen.getByText("localhost:8000").closest("button") as HTMLButtonElement;
    expect(localEntry).not.toBeNull();
    // aria-disabled, not `disabled`: a blocked entry stays focusable (retro-ux F6).
    expect(localEntry.getAttribute("aria-disabled")).toBe("true");
    act(() => localEntry.click());
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("renders CORS-blocked (not Unreachable) for a LAN host whose probe fails", async () => {
    // A LAN-IP known server whose cross-origin probe rejects at the transport
    // layer (opaque) must surface the actionable allowlist hint, not a bare
    // "Unreachable". See change: fix-remote-connect-cors-gates.
    // The cause now comes from the dashboard SERVER's probe (it reaches the
    // target; the browser cannot) — not from the host's address class.
    // See change: stabilize-mdns-server-identity.
    // Persistent (not Once) — the component loads known servers on mount AND on
    // dropdown open. Restored to the default at the end of this test.
    vi.mocked(listKnownServers).mockResolvedValue([
      { host: "192.168.16.242", port: 8000, label: "LAN box", addedAt: "2024-01-01T00:00:00Z" },
    ]);
    vi.mocked(probeKnownServer).mockResolvedValue("reachable");
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("192.168.16.242")) return Promise.reject(new Error("blocked"));
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response);
    });
    render(
      <ServerSelector
        currentHost="my-pc"
        currentPort={8000}
        connected={true}
        onSwitch={() => {}}
      />,
    );
    // Let the mount-time known-servers load flush so the LAN entry exists
    // BEFORE opening (the probe effect runs once on open, over current entries).
    await act(async () => {});
    const btn = screen.getByTitle("Switch server");
    act(() => btn.click());
    await waitFor(() => {
      expect(screen.queryAllByText(/Blocked in this browser/i).length).toBeGreaterThan(0);
    });
    // The LAN entry is disabled and did not render a bare "Unreachable".
    const lanEntry = screen.getByText("192.168.16.242:8000").closest("button") as HTMLButtonElement;
    expect(lanEntry.getAttribute("aria-disabled")).toBe("true");
    expect(lanEntry.getAttribute("data-cors-blocked")).toBe("true");
    vi.mocked(probeKnownServer).mockResolvedValue(null);
    vi.mocked(listKnownServers).mockResolvedValue([
      { host: "my-pc", port: 8000, label: "my-pc", addedAt: "2024-01-01T00:00:00Z" },
    ]);
  });

  it("shows spinner on the entry that matches inFlightSwitchKey", async () => {
    render(
      <ServerSelector
        currentHost="my-pc"
        currentPort={8000}
        connected={true}
        onSwitch={() => {}}
        inFlightSwitchKey="localhost:8000"
      />,
    );
    const btn = screen.getByTitle("Switch server");
    act(() => btn.click());
    await waitFor(() => {
      expect(screen.queryAllByText(/Switching/i).length).toBeGreaterThan(0);
    });
  });

  it("dropdown panel uses fixed z-popover, not absolute z-50 (overlay-layering)", async () => {
    render(
      <ServerSelector
        currentHost="my-pc"
        currentPort={8000}
        connected={true}
        onSwitch={() => {}}
      />,
    );
    const btn = screen.getByTitle("Switch server");
    act(() => btn.click());
    await act(async () => {});
    // Panel may be in document.body (portaled). Use document.querySelector.
    const panel = document.querySelector('[class*="z-popover"]') as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel!.className).toContain("fixed");
    expect(panel!.className).toContain("z-popover");
    expect(panel!.className).not.toContain("absolute");
    expect(panel!.className).not.toContain("z-50");
  });

  it("outside click closes the dropdown", async () => {
    render(
      <ServerSelector
        currentHost="my-pc"
        currentPort={8000}
        connected={true}
        onSwitch={() => {}}
      />,
    );
    const btn = screen.getByTitle("Switch server");
    act(() => btn.click());
    await act(async () => {});
    expect(document.querySelector('[class*="z-popover"]')).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(document.querySelector('[class*="z-popover"]')).toBeNull();
  });

  // retro-ux-identity-connectivity (test-plan #E8, #F1, #F2, #F4): trigger word + APG menu button.
  describe("trigger word (E8)", () => {
    it.each([
      [true, "Connected"],
      [false, "Offline"],
    ])("connected=%s shows the word %s, names it, keeps the title", async (connected, word) => {
      render(<ServerSelector currentHost="my-pc" currentPort={8000} connected={connected} onSwitch={() => {}} />);
      const trigger = screen.getByTitle("Switch server");
      expect(within(trigger).getByText(word)).toBeTruthy();
      expect(trigger.getAttribute("aria-label")?.toLowerCase()).toContain(word.toLowerCase());
      expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("APG menu button", () => {
    const known = (host: string, label: string) => ({ host, port: 8000, label, addedAt: "2024-01-01T00:00:00Z" });
    beforeEach(async () => {
      vi.mocked(listKnownServers).mockResolvedValue([known("office-mac.local", "office-mac"), known("build-box.lan", "build-box")] as never);
      fetchMock.mockImplementation((url: string) =>
        url.includes("build-box") ? Promise.reject(new Error("refused")) : Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response),
      );
    });
    afterEach(() => {
      vi.mocked(listKnownServers).mockResolvedValue([known("my-pc", "my-pc")] as never);
    });

    const renderSel = async (onSwitch = vi.fn()) => {
      render(<ServerSelector currentHost="localhost" currentPort={8000} connected={true} onSwitch={onSwitch} onManageServers={() => {}} />);
      await act(async () => {});
      return { onSwitch, trigger: screen.getByTitle("Switch server") as HTMLButtonElement };
    };

    it("F1: Enter opens with focus on the first item; arrows/Home/End move focus; Escape restores the trigger", async () => {
      const { trigger } = await renderSel();
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Enter" });
      const menu = await screen.findByRole("menu", { hidden: true });
      const items = () => Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
      await waitFor(() => expect(document.activeElement).toBe(items()[0]));
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(items().map((i) => i.getAttribute("role"))).toEqual(["menuitemradio", "menuitemradio", "menuitemradio", "menuitem"]);

      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
      expect(document.activeElement).toBe(items()[1]);
      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
      expect(document.activeElement).toBe(items()[2]);
      fireEvent.keyDown(document.activeElement!, { key: "End" });
      expect(document.activeElement).toBe(items()[3]);
      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }); // wraps
      expect(document.activeElement).toBe(items()[0]);
      fireEvent.keyDown(document.activeElement!, { key: "End" });
      fireEvent.keyDown(document.activeElement!, { key: "Home" });
      expect(document.activeElement).toBe(items()[0]);

      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });

    it("F2: keyboard-only switch calls onSwitch once, closes, and refocuses the trigger", async () => {
      const { onSwitch, trigger } = await renderSel();
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Enter" });
      await waitFor(() => expect(screen.queryAllByText("Available").length).toBeGreaterThan(0));
      const menu = screen.getByRole("menu", { hidden: true });
      const items = within(menu).getAllByRole("menuitemradio", { hidden: true });
      expect(items[0].getAttribute("aria-checked")).toBe("true");
      await waitFor(() => expect(document.activeElement).toBe(items[0]));
      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
      fireEvent.keyDown(document.activeElement!, { key: "Enter" });
      expect(onSwitch).toHaveBeenCalledTimes(1);
      expect(onSwitch).toHaveBeenCalledWith("office-mac.local", 8000);
      expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it("F4: Tab closes the menu and leaves focus outside it", async () => {
      const { trigger } = await renderSel();
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      const menu = await screen.findByRole("menu", { hidden: true });
      await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
      fireEvent.keyDown(document.activeElement!, { key: "Tab" });
      expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
      expect(document.activeElement).toBe(trigger); // the browser then moves on to the next focusable
    });
  });
});

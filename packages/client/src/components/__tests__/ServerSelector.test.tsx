import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { ServerSelector } from "../connectivity/ServerSelector.js";
import { acceptKnownServerMove, listKnownServers, probeKnownServer } from "../../lib/api/known-servers-api.js";

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
    expect(localEntry.disabled).toBe(true);
    act(() => localEntry.click());
    expect(onSwitch).not.toHaveBeenCalled();
  });

  // #E24 / #F4 (stabilize-mdns-server-identity): the cause shown for a browser
  // transport failure is whatever the dashboard SERVER's probe reports — never
  // inferred from the host's address class.
  describe("server-side probe decides the label for a failed browser probe", () => {
    const LAN = "home-imac-75340.local";
    const known = (extra: Record<string, unknown> = {}) => [
      { host: LAN, port: 8000, label: "iMac", addedAt: "2024-01-01T00:00:00Z", ...extra },
    ];
    const restoreDefault = () => {
      vi.mocked(listKnownServers).mockResolvedValue([
        { host: "my-pc", port: 8000, label: "my-pc", addedAt: "2024-01-01T00:00:00Z" },
      ]);
      vi.mocked(probeKnownServer).mockResolvedValue(null);
    };
    beforeEach(() => {
      vi.mocked(probeKnownServer).mockClear();
      vi.mocked(acceptKnownServerMove).mockClear();
    });
    afterEach(restoreDefault);

    async function openWith(
      probe: Awaited<ReturnType<typeof probeKnownServer>>,
      extra: Record<string, unknown> = {},
      browser: (url: string) => Promise<unknown> = () => Promise.reject(new Error("blocked")),
    ) {
      vi.mocked(listKnownServers).mockResolvedValue(known(extra) as never);
      vi.mocked(probeKnownServer).mockResolvedValue(probe);
      fetchMock.mockImplementation((url: string) =>
        url.includes(LAN) ? browser(url) : Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response),
      );
      const onSwitch = vi.fn();
      render(<ServerSelector currentHost="my-pc" currentPort={8000} connected={true} onSwitch={onSwitch} />);
      await act(async () => {});
      act(() => screen.getByTitle("Switch server").click());
      return { onSwitch, row: () => screen.getByText(`${LAN}:8000`).closest("button") as HTMLButtonElement };
    }

    it("reachable from the server → CORS/network hint", async () => {
      const { row } = await openWith("reachable");
      await waitFor(() => expect(screen.queryAllByText(/CORS-blocked/i).length).toBeGreaterThan(0));
      expect(row().getAttribute("data-cors-blocked")).toBe("true");
      expect(row().getAttribute("aria-disabled")).toBe("true");
    });

    it("name-not-resolved → 'Name not found', never the CORS hint", async () => {
      const { row } = await openWith("name-not-resolved");
      await waitFor(() => expect(screen.queryAllByText(/Name not found/i).length).toBeGreaterThan(0));
      expect(row().getAttribute("data-cors-blocked")).toBeNull();
      expect(row().getAttribute("aria-disabled")).toBe("true");
    });

    it("name-not-resolved + movedTo → 'Moved to …' with an Update that accepts the move", async () => {
      const { row } = await openWith("name-not-resolved", { movedTo: { host: "192.168.16.220", port: 8000 } });
      await waitFor(() => expect(screen.queryAllByText(/Moved to 192\.168\.16\.220:8000/).length).toBeGreaterThan(0));
      expect(row().getAttribute("aria-disabled")).toBe("true");
      act(() => screen.getByText("Update").click());
      await waitFor(() => expect(acceptKnownServerMove).toHaveBeenCalledWith(LAN, 8000));
    });

    it.each(["refused", "timeout", "error", null] as const)("%s → 'Unreachable'", async (probe) => {
      const { row } = await openWith(probe);
      await waitFor(() => expect(screen.queryAllByText(/Unreachable/i).length).toBeGreaterThan(0));
      expect(row().getAttribute("aria-disabled")).toBe("true");
      expect(row().getAttribute("data-cors-blocked")).toBeNull();
    });

    it("403 network_not_allowed → 'Network not allowed' without consulting the server probe", async () => {
      const { row } = await openWith(null, {}, async () => ({
        status: 403,
        ok: false,
        json: async () => ({ error: "network_not_allowed" }),
      }));
      await waitFor(() => expect(screen.queryAllByText(/Network not allowed/i).length).toBeGreaterThan(0));
      expect(row().getAttribute("aria-disabled")).toBe("true");
      expect(probeKnownServer).not.toHaveBeenCalled();
    });

    it("#F4 probes once per open: 2 browser fetches + 1 server probe, nothing while closed", async () => {
      await openWith("reachable");
      await waitFor(() => expect(probeKnownServer).toHaveBeenCalledTimes(1));
      const health = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/health")).length;
      expect(health()).toBe(2); // localhost seed + the LAN entry (current server is not probed)
      act(() => screen.getByTitle("Switch server").click()); // close
      await act(async () => {});
      expect(health()).toBe(2);
      expect(probeKnownServer).toHaveBeenCalledTimes(1);
      act(() => screen.getByTitle("Switch server").click()); // reopen
      await waitFor(() => expect(probeKnownServer).toHaveBeenCalledTimes(2));
      expect(health()).toBe(4);
    });
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
      const spinner = screen.queryByLabelText(/Switching/i);
      expect(spinner).not.toBeNull();
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
});

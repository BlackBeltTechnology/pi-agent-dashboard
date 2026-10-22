import { act, cleanup, fireEvent, render, screen, waitFor, } from "@testing-library/react";
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

// The identity proof is covered with real WebCrypto in lib/__tests__/server-route-check.test.ts;
// here an address proves the identity scripted in `identityMock` over the test's own fetch mock.
vi.mock("../../lib/pairing/pair-protocol.js", async (orig) =>
  (await import("./selector-identity-mock.js")).pairProtocolMock(await orig<typeof import("../../lib/pairing/pair-protocol.js")>()),
);


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
    const btn = screen.getByTestId("connection-chip");
    act(() => btn.click()); // open
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => c[0] as string);
      // Every route is checked by the identity challenge (the health leg only follows a proof).
      expect(urls.some((u) => u.includes("localhost:8000/api/pair/challenge"))).toBe(true);
    });
    const countAfterFirstOpen = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/pair/challenge"),
    ).length;
    // Close dropdown
    act(() => btn.click());
    // Flush microtasks — nothing should probe after the close.
    await act(async () => {});
    const countAfterClose = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/pair/challenge"),
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
    const btn = screen.getByTestId("connection-chip");
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
    const btn = screen.getByTestId("connection-chip");
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
    const btn = screen.getByTestId("connection-chip");
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
    const btn = screen.getByTestId("connection-chip");
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
    const btn = screen.getByTestId("connection-chip");
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
    const btn = screen.getByTestId("connection-chip");
    act(() => btn.click());
    await act(async () => {});
    expect(document.querySelector('[class*="z-popover"]')).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(document.querySelector('[class*="z-popover"]')).toBeNull();
  });
});

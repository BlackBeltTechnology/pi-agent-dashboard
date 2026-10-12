/**
 * Server selector: the label for a failed browser probe comes from the
 * dashboard server's own probe (#E24 #F4). Separate from ServerSelector.test.tsx,
 * whose test ids are pinned by fixed-tick-conversion-equivalence.
 * See change: stabilize-mdns-server-identity.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";
import { ServerSelector } from "../connectivity/ServerSelector.js";
import { acceptKnownServerMove, listKnownServers, probeKnownServer } from "../../lib/api/known-servers-api.js";

vi.mock("../../lib/api/known-servers-api.js", () => ({
  listKnownServers: vi.fn(async () => [{ host: "my-pc", port: 8000, label: "my-pc" }]),
  probeKnownServer: vi.fn(async () => null),
  acceptKnownServerMove: vi.fn(async () => true),
}));

describe("ServerSelector server-side probe", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((url: string) =>
      url.includes("localhost") || url.includes("127.0.0.1")
        ? Promise.reject(new Error("refused"))
        : Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response),
    );
    (globalThis as any).fetch = fetchMock;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
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
});

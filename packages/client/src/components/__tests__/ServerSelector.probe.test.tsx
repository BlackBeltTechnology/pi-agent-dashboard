/**
 * Server selector: the label for a failed browser probe comes from the
 * dashboard server's own probe (#E24 #F4). Separate from ServerSelector.test.tsx,
 * whose test ids are pinned by fixed-tick-conversion-equivalence.
 * See change: stabilize-mdns-server-identity.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptKnownServerMove, listKnownServers, probeKnownServer } from "../../lib/api/known-servers-api.js";
import { ServerSelector } from "../connectivity/ServerSelector.js";

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
      await waitFor(() => expect(screen.queryAllByText(/Blocked in this browser/i).length).toBeGreaterThan(0));
      expect(row().getAttribute("data-cors-blocked")).toBe("true");
      expect(row().getAttribute("aria-disabled")).toBe("true");
    });

    it("name-not-resolved → 'Name not found', never the CORS hint", async () => {
      const { row } = await openWith("name-not-resolved");
      await waitFor(() => expect(screen.queryAllByText(/Name not found/i).length).toBeGreaterThan(0));
      expect(row().getAttribute("data-cors-blocked")).toBeNull();
      expect(row().getAttribute("aria-disabled")).toBe("true");
    });

    it("name-not-resolved + movedTo → 'Moved' with an 'Update <name> to <address>' item that accepts the move", async () => {
      const { row } = await openWith("name-not-resolved", { movedTo: { host: "192.168.16.220", port: 8000 } });
      await waitFor(() => expect(screen.queryAllByText("Moved").length).toBeGreaterThan(0));
      expect(screen.getByText(/Now at 192\.168\.16\.220:8000/)).toBeTruthy();
      expect(row().getAttribute("aria-disabled")).toBe("true");
      act(() => screen.getByText("Update iMac to 192.168.16.220:8000").click());
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

  // retro-ux-identity-connectivity (test-plan #E7, #F3, #F5, #X4, #X8)
  describe("retro-ux states", () => {
    const KNOWN = [
      { host: "ok.lan", port: 8000, label: "ok", addedAt: "2024-01-01T00:00:00Z" },
      { host: "dead.lan", port: 8000, label: "dead", addedAt: "2024-01-01T00:00:00Z" },
      { host: "guarded.lan", port: 8000, label: "guarded", addedAt: "2024-01-01T00:00:00Z" },
      { host: "cors.lan", port: 8000, label: "cors", addedAt: "2024-01-01T00:00:00Z" },
      { host: "gone.lan", port: 8000, label: "gone", addedAt: "2024-01-01T00:00:00Z" },
      { host: "nas.local", port: 8000, label: "nas", addedAt: "2024-01-01T00:00:00Z", movedTo: { host: "nas-2.local", port: 8000 } },
    ];
    const restore = () => {
      vi.mocked(listKnownServers).mockResolvedValue([{ host: "my-pc", port: 8000, label: "my-pc", addedAt: "2024-01-01T00:00:00Z" }] as never);
      vi.mocked(probeKnownServer).mockResolvedValue(null);
    };
    afterEach(restore);

    const open = async (known = KNOWN as unknown[]) => {
      vi.mocked(listKnownServers).mockResolvedValue(known as never);
      const onSwitch = vi.fn();
      render(<ServerSelector currentHost="my-pc" currentPort={8000} connected={true} onSwitch={onSwitch} />);
      await act(async () => {});
      act(() => screen.getByTitle("Switch server").click());
      return { onSwitch };
    };
    const item = (host: string) => screen.getByText(`${host}:8000`).closest("button") as HTMLButtonElement;

    it("E7: each probe outcome renders its own text pill and data-* attribute", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("ok.lan")) return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
        if (url.includes("guarded.lan")) return Promise.resolve({ status: 403, ok: false, json: async () => ({ error: "network_not_allowed" }) });
        if (url.includes("localhost")) return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
        return Promise.reject(new Error("blocked"));
      });
      const serverProbe: Record<string, "reachable" | "refused" | "name-not-resolved"> = {
        "cors.lan": "reachable",
        "dead.lan": "refused",
        "gone.lan": "name-not-resolved",
        "nas.local": "name-not-resolved",
      };
      vi.mocked(probeKnownServer).mockImplementation(async (host: string) => serverProbe[host] ?? null);
      await open();
      await waitFor(() => expect(screen.queryAllByText("Checking…")).toHaveLength(0));
      const pills: Record<string, string> = {
        "ok.lan": "Available",
        "dead.lan": "Unreachable",
        "guarded.lan": "Network not allowed",
        "cors.lan": "Blocked in this browser",
        "gone.lan": "Name not found",
        "nas.local": "Moved",
      };
      for (const [host, label] of Object.entries(pills)) {
        expect(within(item(host)).getByText(label), `${host} → ${label}`).toBeTruthy();
      }
      expect(item("dead.lan").hasAttribute("data-unreachable")).toBe(true);
      expect(item("guarded.lan").hasAttribute("data-denied")).toBe(true);
      expect(item("cors.lan").hasAttribute("data-cors-blocked")).toBe(true);
      expect(item("gone.lan").hasAttribute("data-name-not-resolved")).toBe(true);
      expect(item("ok.lan").getAttribute("aria-disabled")).toBeNull();
      expect(new Set(Object.values(pills)).size).toBe(6);
    });

    it("F3: a blocked item is focusable, not activatable, and its reason is visible + described", async () => {
      fetchMock.mockImplementation((url: string) =>
        url.includes("dead.lan") ? Promise.reject(new Error("refused")) : Promise.resolve({ ok: true, json: async () => ({ ok: true }) }),
      );
      vi.mocked(probeKnownServer).mockResolvedValue("refused");
      const { onSwitch } = await open([KNOWN[1]]);
      await waitFor(() => expect(screen.queryAllByText("Unreachable").length).toBeGreaterThan(0));
      const dead = item("dead.lan");
      expect(dead.getAttribute("aria-disabled")).toBe("true");
      const reason = document.getElementById(dead.getAttribute("aria-describedby")!);
      expect(reason?.textContent).toMatch(/No response from this address/);
      dead.focus();
      expect(document.activeElement).toBe(dead);
      fireEvent.keyDown(dead, { key: "Enter" });
      act(() => dead.click());
      expect(onSwitch).not.toHaveBeenCalled();
      expect(screen.getByRole("menu", { hidden: true })).toBeTruthy(); // still open
    });

    it("F5: 'Checking…' while the probe is pending, then converges to 'Available' — never blank", async () => {
      let resolve!: (v: unknown) => void;
      fetchMock.mockImplementation((url: string) =>
        url.includes("ok.lan")
          ? new Promise((r) => { resolve = r; })
          : Promise.resolve({ ok: true, json: async () => ({ ok: true }) }),
      );
      await open([KNOWN[0]]);
      await waitFor(() => expect(within(item("ok.lan")).getByText("Checking…")).toBeTruthy());
      await act(async () => resolve({ ok: true, json: async () => ({ ok: true }) }));
      await waitFor(() => expect(within(item("ok.lan")).getByText("Available")).toBeTruthy());
      expect(within(item("ok.lan")).queryByText("Checking…")).toBeNull();
    });

    it("X4: a refused move acceptance is shown as text in the menu and the entry is unchanged", async () => {
      fetchMock.mockImplementation(() => Promise.reject(new Error("blocked")));
      vi.mocked(probeKnownServer).mockResolvedValue("name-not-resolved");
      vi.mocked(acceptKnownServerMove).mockResolvedValue(false);
      await open([KNOWN[5]]);
      const update = await screen.findByText("Update nas to nas-2.local:8000");
      act(() => update.closest("button")!.click());
      await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/operator credential/));
      expect(acceptKnownServerMove).toHaveBeenCalledWith("nas.local", 8000);
      expect(screen.getByText("nas.local:8000")).toBeTruthy();
      vi.mocked(acceptKnownServerMove).mockResolvedValue(true);
    });

    it("X8: browser fetch throws AND the server probe rejects → Unreachable pill, aria-disabled", async () => {
      fetchMock.mockImplementation((url: string) =>
        url.includes("dead.lan") ? Promise.reject(new Error("refused")) : Promise.resolve({ ok: true, json: async () => ({ ok: true }) }),
      );
      vi.mocked(probeKnownServer).mockRejectedValue(new Error("server down"));
      await open([KNOWN[1]]);
      await waitFor(() => expect(within(item("dead.lan")).getByText("Unreachable")).toBeTruthy());
      expect(item("dead.lan").getAttribute("aria-disabled")).toBe("true");
    });
  });
});

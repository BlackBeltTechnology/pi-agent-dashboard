/**
 * Server selector: the label for a failed browser probe comes from the
 * dashboard server's own probe (#E24 #F4). Separate from ServerSelector.test.tsx,
 * whose test ids are pinned by fixed-tick-conversion-equivalence.
 * See change: stabilize-mdns-server-identity.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptKnownServerMove, listKnownServers, probeKnownServer, probeKnownServerResult } from "../../lib/api/known-servers-api.js";
import { ServerSelector } from "../connectivity/ServerSelector.js";
import { identityMock } from "./selector-identity-mock.js";

vi.mock("../../lib/api/known-servers-api.js", () => ({
  listKnownServers: vi.fn(async () => [{ host: "my-pc", port: 8000, label: "my-pc" }]),
  probeKnownServer: vi.fn(async () => null),
  probeKnownServerResult: vi.fn(async () => null),
  acceptKnownServerMove: vi.fn(async () => true),
}));

// The identity proof is covered with real WebCrypto in lib/__tests__/server-route-check.test.ts;
// here an address proves the identity scripted in `identityMock` over the test's own fetch mock.
vi.mock("../../lib/pairing/pair-protocol.js", async (orig) =>
  (await import("./selector-identity-mock.js")).pairProtocolMock(await orig<typeof import("../../lib/pairing/pair-protocol.js")>()),
);


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

    it("#F4 probes once per open: 2 route challenges + 1 server probe, nothing while closed", async () => {
      await openWith("reachable");
      await waitFor(() => expect(probeKnownServer).toHaveBeenCalledTimes(1));
      // The identity challenge is the route check's one request until a route proves itself.
      const challenges = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/pair/challenge")).length;
      expect(challenges()).toBe(2); // localhost seed + the LAN entry (current server is not probed)
      act(() => screen.getByTitle("Switch server").click()); // close
      await act(async () => {});
      expect(challenges()).toBe(2);
      expect(probeKnownServer).toHaveBeenCalledTimes(1);
      act(() => screen.getByTitle("Switch server").click()); // reopen
      await waitFor(() => expect(probeKnownServer).toHaveBeenCalledTimes(2));
      expect(challenges()).toBe(4);
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
      // The route check is two legs: the identity challenge, then (once proven) the access check.
      const pending: Array<(v: unknown) => void> = [];
      fetchMock.mockImplementation((url: string) =>
        url.includes("ok.lan")
          ? new Promise((r) => { pending.push(r); })
          : Promise.resolve({ ok: true, json: async () => ({ ok: true }) }),
      );
      const okBody = { ok: true, json: async () => ({ ok: true }) };
      await open([KNOWN[0]]);
      await waitFor(() => expect(within(item("ok.lan")).getByText("Checking…")).toBeTruthy());
      await act(async () => pending.shift()!(okBody)); // challenge proven → access leg now pending
      await waitFor(() => expect(pending).toHaveLength(1));
      expect(within(item("ok.lan")).getByText("Checking…")).toBeTruthy();
      await act(async () => pending.shift()!(okBody));
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
  // group-servers-by-identity: one row per identity, route chips, bounded + once-per-open checks,
  // proof outcomes and "an advert is a hint" (test-plan #P1, #F1, #F2, #X4, #X5).
  describe("identity rows and route checks", () => {
    const ts = "2024-01-01T00:00:00Z";
    const F = "sha256:F0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f";
    const G = "sha256:G1g1g1g1g1g1g1g1g1g1g1g1g1g1g1g1g1g1g1g1g1g";
    const OTHER = "sha256:Ee0Tz6uJq4Xc9HaMEe0Tz6uJq4Xc9HaMEe0Tz6uJq4X";
    const okBody = () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response;
    const saved = (host: string, label: string, extra: Record<string, unknown> = {}) => ({ host, port: 8000, label, addedAt: ts, ...extra });
    const lanRoute = (host: string) => ({ host, port: 8000, scheme: "http", source: "saved" });
    const radios = () => screen.getAllByRole("menuitemradio", { hidden: true }) as HTMLButtonElement[];
    const rowOf = (name: string) => radios().find((r) => r.textContent?.includes(name)) as HTMLButtonElement;
    const chipsOf = (row: HTMLElement) => within(row).getAllByTestId("route-chip").map((c) => c.textContent);
    const challengeCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/pair/challenge"));

    beforeEach(() => {
      identityMock.reset();
      vi.mocked(probeKnownServer).mockReset().mockResolvedValue(null);
      vi.mocked(probeKnownServerResult).mockReset().mockResolvedValue(null);
      vi.mocked(acceptKnownServerMove).mockReset().mockResolvedValue(true);
    });
    afterEach(() => {
      identityMock.reset();
      vi.mocked(listKnownServers).mockResolvedValue([saved("my-pc", "my-pc")] as never);
    });

    const mount = async (known: unknown[], props: Record<string, unknown> = {}) => {
      vi.mocked(listKnownServers).mockResolvedValue(known as never);
      const onSwitch = vi.fn();
      render(<ServerSelector currentHost="localhost" currentPort={8000} connected={true} onSwitch={onSwitch} {...props} />);
      await act(async () => {});
      return { onSwitch, trigger: () => screen.getByTitle("Switch server") as HTMLButtonElement };
    };

    /** A fetch that never answers until its signal aborts (the 2 s bound), counting what is in flight. */
    const hangingFetch = () => {
      const live = { now: 0, max: 0 };
      fetchMock.mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            live.now += 1;
            live.max = Math.max(live.max, live.now);
            init?.signal?.addEventListener("abort", () => {
              live.now -= 1;
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      return live;
    };

    it("P1: 12 routes that never answer are checked at most 6 at a time and all settle Unreachable by 8 s", async () => {
      const live = hangingFetch();
      const hosts = Array.from({ length: 12 }, (_, i) => `h${String(i + 1).padStart(2, "0")}.lan`);
      const { trigger } = await mount(hosts.map((h) => saved(h, h.slice(0, 3))));
      act(() => trigger().click());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(live.max).toBe(6); // the bound is reached, not merely respected
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      expect(live.max).toBeLessThanOrEqual(6);
      expect(screen.queryAllByText("Checking…")).toHaveLength(0);
      expect(screen.getAllByText("Unreachable")).toHaveLength(12);
    });

    it("P1: 5 routes answering at 3 ms never exceed 5 in flight and settle at once", async () => {
      let inFlight = 0;
      let max = 0;
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            inFlight += 1;
            max = Math.max(max, inFlight);
            setTimeout(() => {
              inFlight -= 1;
              resolve(okBody());
            }, 3);
          }),
      );
      const hosts = ["a1.lan", "a2.lan", "a3.lan", "a4.lan", "a5.lan"];
      const { trigger } = await mount(hosts.map((h) => saved(h, h)));
      act(() => trigger().click());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(max).toBe(5);
      expect(screen.getAllByText("Available")).toHaveLength(5);
    });

    it("F1: one row per identity; chips read kind + latency (or the refusal) as text; a refused route is not used", async () => {
      identityMock.proves.set("192.168.16.204", F);
      identityMock.proves.set("home-imac.local", F);
      identityMock.proves.set("h0me1mac.share.zrok.io", F);
      identityMock.proves.set("192.168.16.50", OTHER); // claims G, proves another identity
      identityMock.proves.set("lab.example.org", G);
      // Challenge answers are held so each route's latency (a controlled clock) is exact.
      const held = new Map<string, () => void>();
      let t = 0;
      vi.spyOn(performance, "now").mockImplementation(() => t);
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/api/pair/challenge")) {
          const host = new URL(url).hostname;
          return new Promise((resolve) => held.set(host, () => resolve(okBody())));
        }
        return Promise.resolve(okBody());
      });
      const known = [
        saved("192.168.16.204", "home-imac", {
          fingerprint: F,
          routes: [lanRoute("192.168.16.204"), { host: "h0me1mac.share.zrok.io", port: 443, scheme: "https", source: "pairing" }],
        }),
        saved("192.168.16.50", "lab-server", {
          fingerprint: G,
          routes: [lanRoute("192.168.16.50"), { host: "lab.example.org", port: 443, scheme: "https", source: "pairing" }],
        }),
      ];
      const { onSwitch, trigger } = await mount(known, {
        servers: [{ host: "home-imac.local", port: 8000, piPort: 9999, version: "1", pid: 1, isLocal: false, source: "mdns", fingerprint: F, name: "home-imac" }],
      });
      act(() => trigger().click());
      await waitFor(() => expect(held.size).toBe(5));
      for (const [host, ms] of [["192.168.16.204", 4], ["192.168.16.50", 7], ["home-imac.local", 9], ["lab.example.org", 48], ["h0me1mac.share.zrok.io", 118]] as const) {
        t = ms;
        await act(async () => held.get(host)!());
      }
      await waitFor(() => expect(screen.queryAllByText("Checking…")).toHaveLength(0));

      expect(radios().filter((r) => r.textContent?.includes("home-imac"))).toHaveLength(1);
      expect(chipsOf(rowOf("home-imac"))).toEqual(["Local network · 4 ms", "Tunnel (zrok) · 118 ms", "mDNS name · 9 ms"]);
      expect(rowOf("home-imac").textContent).toContain("via local network");

      const lab = chipsOf(rowOf("lab-server"));
      expect(lab[0]).toMatch(/^Local network: different identity sha256:Ee0Tz6uJq4Xc9HaM/);
      expect(lab[1]).toBe("Public URL · 48 ms");
      expect(rowOf("lab-server").getAttribute("aria-disabled")).toBeNull();
      expect(rowOf("lab-server").textContent).toContain("via public url");
      act(() => rowOf("lab-server").click());
      expect(onSwitch).toHaveBeenCalledWith("lab.example.org", 443); // the usable route, never the refused one
    });

    it("F1: an entry whose every route is refused is aria-disabled and never switches", async () => {
      identityMock.proves.set("192.168.16.50", OTHER);
      fetchMock.mockImplementation(() => Promise.resolve(okBody()));
      const { onSwitch, trigger } = await mount([saved("192.168.16.50", "lab-server", { fingerprint: G, routes: [lanRoute("192.168.16.50")] })]);
      act(() => trigger().click());
      await waitFor(() => expect(within(rowOf("lab-server")).getByText("Different identity")).toBeTruthy());
      const row = rowOf("lab-server");
      expect(row.getAttribute("aria-disabled")).toBe("true");
      expect(document.getElementById(row.getAttribute("aria-describedby")!)?.textContent).toMatch(/different server/);
      act(() => row.click());
      expect(onSwitch).not.toHaveBeenCalled();
    });

    it("F2: nothing is checked while closed (120 s); one round per open; a late result of an earlier open never overwrites", async () => {
      const pending: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void; url: string }> = [];
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/api/pair/challenge")) return new Promise((resolve, reject) => pending.push({ resolve, reject, url }));
        return Promise.resolve(okBody());
      });
      const { trigger } = await mount([saved("a.lan", "alpha")]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(fetchMock).not.toHaveBeenCalled();

      act(() => trigger().click()); // open #1
      await waitFor(() => expect(pending).toHaveLength(1));
      expect(within(rowOf("alpha")).getByText("Checking…")).toBeTruthy();
      act(() => trigger().click()); // close
      act(() => trigger().click()); // open #2, #1's challenge still pending
      await waitFor(() => expect(pending).toHaveLength(2));
      expect(challengeCalls()).toHaveLength(2); // one round per open
      expect(within(rowOf("alpha")).getByText("Checking…")).toBeTruthy();

      await act(async () => pending[1].resolve(okBody())); // open #2 answers first → Available
      await waitFor(() => expect(within(rowOf("alpha")).getByText("Available")).toBeTruthy());
      await act(async () => pending[0].reject(new TypeError("Failed to fetch"))); // open #1's late failure
      await act(async () => {});
      expect(within(rowOf("alpha")).getByText("Available")).toBeTruthy();
      expect(probeKnownServer).not.toHaveBeenCalled();
    });

    it("X4: each proof outcome renders its own text state and blocks switching", async () => {
      identityMock.proves.set("wrong.lan", OTHER);
      identityMock.invalid.add("bad.lan");
      identityMock.noProof.add("old.lan");
      fetchMock.mockImplementation((url: string) => (url.includes("down.lan") ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(okBody())));
      const known = [
        saved("good.lan", "good", { fingerprint: "sha256:good.lan" }),
        saved("wrong.lan", "wrong", { fingerprint: F }),
        saved("bad.lan", "bad"),
        saved("old.lan", "old"),
        saved("down.lan", "down"),
      ];
      const { onSwitch, trigger } = await mount(known);
      act(() => trigger().click());
      await waitFor(() => expect(screen.queryAllByText("Checking…")).toHaveLength(0));
      expect(within(rowOf("good")).getByText("Available")).toBeTruthy();
      expect(within(rowOf("wrong")).getByText("Different identity")).toBeTruthy();
      expect(within(rowOf("bad")).getByText("Invalid identity proof")).toBeTruthy();
      expect(within(rowOf("old")).getByText("Can't prove identity")).toBeTruthy(); // not offered as the route to open
      expect(within(rowOf("down")).getByText("Unreachable")).toBeTruthy(); // the server probe explains the cause
      expect(chipsOf(rowOf("bad"))).toEqual(["Local network: invalid identity proof"]);
      expect(chipsOf(rowOf("old"))).toEqual(["Local network: can't prove identity"]);
      for (const name of ["wrong", "bad", "old", "down"]) {
        expect(rowOf(name).getAttribute("aria-disabled"), name).toBe("true");
        act(() => rowOf(name).click());
      }
      expect(onSwitch).not.toHaveBeenCalled();
    });

    it("X4: a browser without WebCrypto Ed25519 cannot switch; the server's proof is shown for display only", async () => {
      identityMock.cryptoless = true;
      vi.mocked(probeKnownServerResult).mockResolvedValue({ status: "reachable", fingerprint: F } as never);
      fetchMock.mockImplementation(() => Promise.resolve(okBody()));
      const { onSwitch, trigger } = await mount([saved("a.lan", "alpha", { routes: [lanRoute("a.lan")] })]);
      act(() => trigger().click());
      await waitFor(() => expect(within(rowOf("alpha")).getByText("Can't prove in this browser")).toBeTruthy());
      const row = rowOf("alpha");
      expect(row.getAttribute("aria-disabled")).toBe("true");
      await waitFor(() => expect(row.textContent).toContain("sha256:F0f0f0f0f0f0f0f0")); // display only
      expect(chipsOf(row)).toEqual(["Local network: can't prove in this browser"]);
      expect(fetchMock).not.toHaveBeenCalled(); // no challenge, no health: nothing can be proven here
      act(() => row.click());
      expect(onSwitch).not.toHaveBeenCalled();
    });

    it("X5: an advertised fingerprint is a hint — the refused route sees only the challenge and is never used", async () => {
      identityMock.proves.set("192.168.16.204", G); // the advert claims F, the address proves G
      identityMock.proves.set("f.lan", F);
      fetchMock.mockImplementation(() => Promise.resolve(okBody()));
      const wsSpy = vi.fn();
      vi.stubGlobal("WebSocket", wsSpy);
      const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
      const { onSwitch, trigger } = await mount([saved("f.lan", "fserver", { fingerprint: F, routes: [lanRoute("f.lan")] })], {
        servers: [{ host: "192.168.16.204", port: 8000, piPort: 9999, version: "1", pid: 1, isLocal: false, source: "mdns", fingerprint: F, name: "claimed" }],
      });
      act(() => trigger().click());
      await waitFor(() => expect(within(rowOf("fserver")).getByText("Available")).toBeTruthy());
      const row = rowOf("fserver");
      expect(chipsOf(row).some((c) => /different identity/.test(c ?? ""))).toBe(true); // listed under F as refused

      act(() => row.click()); // switch uses the proven route only
      expect(onSwitch).toHaveBeenCalledWith("f.lan", 8000);
      const action = screen.queryByTestId("pair-action");
      if (action) act(() => action.click());
      if (openSpy.mock.calls.length > 0) expect(String(openSpy.mock.calls[0][0])).toBe("http://f.lan:8000/pair?request"); // never the refused host

      const toRefused = fetchMock.mock.calls.filter((c) => String(c[0]).includes("192.168.16.204"));
      expect(toRefused).toHaveLength(1);
      expect(String(toRefused[0][0])).toBe("http://192.168.16.204:8000/api/pair/challenge");
      expect((toRefused[0][1] as RequestInit).method).toBe("POST");
      expect(new Headers((toRefused[0][1] as RequestInit).headers).has("Authorization")).toBe(false);
      expect(wsSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});

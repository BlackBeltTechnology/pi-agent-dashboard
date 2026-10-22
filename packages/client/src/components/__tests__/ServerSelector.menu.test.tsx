/**
 * Server selector: trigger word + APG menu button keyboard model. Separate from
 * ServerSelector.test.tsx, whose test ids are pinned by
 * fixed-tick-conversion-equivalence.
 * See change: retro-ux-identity-connectivity (test-plan #E8, #F1, #F2, #F4),
 * group-servers-by-identity (its test-plan #F3 and #F4, in the last describe).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listKnownServers, probeKnownServer } from "../../lib/api/known-servers-api.js";
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


describe("ServerSelector menu button", () => {
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

  // retro-ux-identity-connectivity (test-plan #E8, #F1, #F2, #F4): trigger word + APG menu button.
  describe("trigger word (E8)", () => {
    // declutter-sidebar-header: the always-on "Connected" word is gone (the dot + name carry it);
    // only the disconnected state keeps a visible word.
    it.each([
      [true, "Connected"],
      [false, "Offline"],
    ])("connected=%s names the state %s, keeps the title", async (connected, word) => {
      render(<ServerSelector currentHost="my-pc" currentPort={8000} connected={connected} onSwitch={() => {}} />);
      const trigger = screen.getByTestId("connection-chip");
      if (connected) expect(within(trigger).queryByText(word)).toBeNull();
      else expect(within(trigger).getByText(word)).toBeTruthy();
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
      return { onSwitch, trigger: screen.getByTestId("connection-chip") as HTMLButtonElement };
    };

    it("F1: Enter opens with focus on the first item; arrows/Home/End move focus; Escape restores the trigger", async () => {
      const { trigger } = await renderSel();
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Enter" });
      const menu = await screen.findByRole("menu", { hidden: true });
      const items = () => Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
      await waitFor(() => expect(document.activeElement).toBe(items()[0]));
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      // Each unpaired on-link row (a `.local` and a `.lan` name here) is followed by its own pair-action item.
      const roles = items().map((i) => i.getAttribute("role"));
      expect(roles).toEqual(["menuitemradio", "menuitemradio", "menuitem", "menuitemradio", "menuitem", "menuitem"]);
      const last = items().length - 1;

      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
      expect(document.activeElement).toBe(items()[1]);
      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
      expect(document.activeElement).toBe(items()[2]);
      fireEvent.keyDown(document.activeElement!, { key: "End" });
      expect(document.activeElement).toBe(items()[last]);
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

  // group-servers-by-identity — test-plan #F3 (blocked entries) and #F4 (pair action is its own menuitem).
  describe("blocked entries and pair action (group-servers-by-identity)", () => {
    const ts = "2024-01-01T00:00:00Z";
    const saved = (host: string, label: string, extra: Record<string, unknown> = {}) => ({ host, port: 8000, label, addedAt: ts, ...extra });
    const okRes = (): Response => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response;
    const radios = () => screen.getAllByRole("menuitemradio", { hidden: true }) as HTMLButtonElement[];
    const rowOf = (name: string) => radios().find((r) => r.textContent?.includes(name)) as HTMLButtonElement;
    const itemsOf = (menu: HTMLElement) => Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
    beforeEach(() => {
      identityMock.reset();
      vi.mocked(probeKnownServer).mockReset().mockResolvedValue(null);
    });
    afterEach(() => {
      identityMock.reset();
      vi.mocked(listKnownServers).mockResolvedValue([saved("my-pc", "my-pc")] as never);
    });

    it("#F3 blocked rows (Unreachable, Network not allowed, Blocked in this browser, Name not found, Moved, Checking…) are focusable, never switch, and keep focus in the menu", async () => {
      const explain: Record<string, "reachable" | "refused" | "name-not-resolved"> = {
        "dead.lan": "refused",
        "cors.lan": "reachable",
        "gone.lan": "name-not-resolved",
        "nas.local": "name-not-resolved",
      };
      vi.mocked(probeKnownServer).mockImplementation(async (host: string) => explain[host] ?? null);
      fetchMock.mockImplementation((url: string) => {
        if (/pending\.lan/.test(url)) return new Promise(() => {}); // never answers: stays Checking…
        if (/guarded\.lan:\d+\/api\/health/.test(url)) return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "network_not_allowed" }) } as Response);
        if (/localhost|dead\.lan|cors\.lan|gone\.lan|nas\.local/.test(url)) return Promise.reject(new TypeError("Failed to fetch"));
        return Promise.resolve(okRes());
      });
      vi.mocked(listKnownServers).mockResolvedValue([
        saved("dead.lan", "dead"),
        saved("guarded.lan", "guarded"),
        saved("cors.lan", "cors"),
        saved("gone.lan", "gone"),
        saved("nas.local", "nas", { movedTo: { host: "nas-2.local", port: 8000 } }),
        saved("pending.lan", "pending"),
      ] as never);
      const onSwitch = vi.fn();
      const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
      render(<ServerSelector currentHost="localhost" currentPort={8000} connected={true} onSwitch={onSwitch} />);
      await act(async () => {});
      const trigger = screen.getByTestId("connection-chip") as HTMLButtonElement;
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Enter" });
      const menu = await screen.findByRole("menu", { hidden: true });
      const expected: Record<string, string> = {
        dead: "Unreachable",
        guarded: "Network not allowed",
        cors: "Blocked in this browser",
        gone: "Name not found",
        nas: "Moved",
        pending: "Checking…",
      };
      await waitFor(() => {
        for (const [name, pill] of Object.entries(expected)) expect(within(rowOf(name)).queryByText(pill), `${name} → ${pill}`).toBeTruthy();
      });

      // ArrowDown to each blocked row; Enter and Space do nothing but keep focus on the row.
      await waitFor(() => expect(document.activeElement).toBe(itemsOf(menu)[0]));
      for (let guard = 0; guard < itemsOf(menu).length; guard++) {
        fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
        const at = document.activeElement as HTMLElement;
        expect(menu.contains(at)).toBe(true);
        if (at.getAttribute("role") !== "menuitemradio" || at.getAttribute("aria-checked") === "true") continue;
        expect(at.getAttribute("aria-disabled"), at.textContent ?? "").toBe("true");
        const why = document.getElementById(at.getAttribute("aria-describedby") ?? "");
        expect(why?.textContent?.length ?? 0, "reason text is visible").toBeGreaterThan(0);
        fireEvent.keyDown(at, { key: "Enter" });
        fireEvent.keyDown(at, { key: " " });
        expect(onSwitch).not.toHaveBeenCalled();
        expect(screen.getByRole("menu", { hidden: true })).toBeTruthy(); // still open
        expect(document.activeElement).toBe(at); // focus stays
      }
      expect(onSwitch).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();

      fireEvent.keyDown(document.activeElement!, { key: "Tab" });
      expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
      expect(document.activeElement).toBe(trigger);

      fireEvent.keyDown(trigger, { key: "Enter" }); // reopen
      await screen.findByRole("menu", { hidden: true });
      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it("#F4 browser: the pair action is a menuitem right after its row; Enter on it opens the peer's request page with noopener and sends no request", async () => {
      vi.mocked(listKnownServers).mockResolvedValue([saved("192.168.16.77", "studio-mbp")] as never);
      fetchMock.mockImplementation((url: string) => (url.includes("localhost") ? Promise.reject(new TypeError("refused")) : Promise.resolve(okRes())));
      const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
      const onSwitch = vi.fn();
      render(<ServerSelector currentHost="localhost" currentPort={8000} connected={true} onSwitch={onSwitch} />);
      await act(async () => {});
      const trigger = screen.getByTestId("connection-chip") as HTMLButtonElement;
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Enter" });
      const menu = await screen.findByRole("menu", { hidden: true });
      await waitFor(() => expect(within(rowOf("studio-mbp")).getByText("Available")).toBeTruthy());

      rowOf("studio-mbp").focus();
      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
      const next = document.activeElement as HTMLElement;
      expect(next.getAttribute("role")).toBe("menuitem");
      expect(next.textContent).toContain("Request access…");
      expect(itemsOf(menu).indexOf(next)).toBe(itemsOf(menu).indexOf(rowOf("studio-mbp")) + 1);

      const callsBefore = fetchMock.mock.calls.length;
      fireEvent.keyDown(next, { key: "Enter" });
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith("http://192.168.16.77:8000/pair?request", "_blank", "noopener");
      expect(fetchMock.mock.calls.length).toBe(callsBefore); // no challenge, no request precedes the navigation
      expect(onSwitch).not.toHaveBeenCalled();
      expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
    });

    it("#F4 activating the entry itself switches (or nothing) — it never runs the pair action", async () => {
      vi.mocked(listKnownServers).mockResolvedValue([saved("192.168.16.77", "studio-mbp")] as never);
      fetchMock.mockImplementation((url: string) => (url.includes("localhost") ? Promise.reject(new TypeError("refused")) : Promise.resolve(okRes())));
      const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
      const onSwitch = vi.fn();
      render(<ServerSelector currentHost="localhost" currentPort={8000} connected={true} onSwitch={onSwitch} />);
      await act(async () => {});
      fireEvent.click(screen.getByTestId("connection-chip"));
      await waitFor(() => expect(within(rowOf("studio-mbp")).getByText("Available")).toBeTruthy());
      fireEvent.click(rowOf("studio-mbp"));
      expect(onSwitch).toHaveBeenCalledWith("192.168.16.77", 8000);
      expect(openSpy).not.toHaveBeenCalled();
    });
  });
});

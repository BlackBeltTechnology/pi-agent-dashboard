/**
 * Server selector: trigger word + APG menu button keyboard model. Separate from
 * ServerSelector.test.tsx, whose test ids are pinned by
 * fixed-tick-conversion-equivalence.
 * See change: retro-ux-identity-connectivity (test-plan #E8, #F1, #F2, #F4).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listKnownServers } from "../../lib/api/known-servers-api.js";
import { ServerSelector } from "../connectivity/ServerSelector.js";

vi.mock("../../lib/api/known-servers-api.js", () => ({
  listKnownServers: vi.fn(async () => [{ host: "my-pc", port: 8000, label: "my-pc" }]),
  probeKnownServer: vi.fn(async () => null),
  acceptKnownServerMove: vi.fn(async () => true),
}));

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
      const trigger = screen.getByTitle("Switch server");
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

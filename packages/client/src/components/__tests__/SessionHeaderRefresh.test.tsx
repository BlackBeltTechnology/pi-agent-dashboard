/**
 * "Reload transcript" title-menu item (formerly the header refresh button).
 * See change: reorganize-session-header. Covers test-plan E10, X2.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiHistory } from "@mdi/js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { SessionHeader } from "../session/SessionHeader.js";

// Stub useMobile to return false (desktop)
vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => false }));

function makeSession(overrides?: Partial<DashboardSession>): DashboardSession {
  return { id: "s1", status: "idle", cwd: "/tmp", startedAt: Date.now() - 60_000, ...overrides } as DashboardSession;
}

const openMenu = () => fireEvent.click(screen.getByTestId("session-title-menu"));

describe("SessionHeader Reload transcript", () => {
  afterEach(cleanup);

  it("E10 has no standalone refresh button; the menu item calls onRefresh once and closes the menu", () => {
    const onRefresh = vi.fn();
    render(<SessionHeader session={makeSession()} state={createInitialState()} onRefresh={onRefresh} />);
    expect(screen.queryByTestId("refresh-chat")).toBeNull();
    openMenu();
    const item = screen.getByTestId("refresh-chat");
    expect(item.getAttribute("role")).toBe("menuitem");
    expect(item.textContent).toContain("Reload transcript");
    expect(item.querySelector("svg path")?.getAttribute("d")).toBe(mdiHistory);
    fireEvent.click(item);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("omits the item when onRefresh is not provided", () => {
    render(<SessionHeader session={makeSession()} state={createInitialState()} onRename={() => {}} />);
    openMenu();
    expect(screen.queryByTestId("refresh-chat")).toBeNull();
  });

  it("X2 a throwing onRefresh closes the menu and leaves the header mounted", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onRefresh = vi.fn(() => {
      throw new Error("boom");
    });
    render(<SessionHeader session={makeSession()} state={createInitialState()} onRefresh={onRefresh} />);
    openMenu();
    fireEvent.click(screen.getByTestId("refresh-chat"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByTestId("session-header")).toBeTruthy();
    spy.mockRestore();
  });
});

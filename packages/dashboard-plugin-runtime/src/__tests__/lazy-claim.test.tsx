/**
 * lazyClaim + Suspense inside the per-claim error boundary.
 * See change: lazy-plugin-claim-modules (task 2.1).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyClaim } from "../lazy-claim.js";
import { PluginContextProvider } from "../plugin-context.js";
import { SessionCardBadgeSlot, SettingsSectionByPluginSlot } from "../slot-consumers.js";
import { createSlotRegistry } from "../slot-registry.js";

afterEach(cleanup);

const session = { id: "s1", cwd: "/repo", source: "tui", status: "active", startedAt: 0 } as DashboardSession;

describe("lazyClaim", () => {
  it("memoizes per (loader, name) and fetches the module once", async () => {
    const load = vi.fn(async () => ({ Foo: () => <span data-testid="foo">foo</span> }));
    const a = lazyClaim(load, "Foo");
    expect(lazyClaim(load, "Foo")).toBe(a);
    expect(lazyClaim(load, "Other")).not.toBe(a);

    const registry = createSlotRegistry();
    registry.addClaim({ pluginId: "p", priority: 1, slot: "settings-section", Component: a });
    const ui = (
      <PluginContextProvider registry={registry}>
        <SettingsSectionByPluginSlot pluginId="p" />
      </PluginContextProvider>
    );
    const { rerender } = render(ui);
    await waitFor(() => expect(screen.getByTestId("foo")).toBeDefined());
    rerender(ui);
    expect(screen.getByTestId("foo")).toBeDefined();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("renders nothing (fallback) while pending, then the component", async () => {
    let release!: (m: Record<string, unknown>) => void;
    const load = () =>
      new Promise<Record<string, unknown>>((r) => {
        release = r;
      });
    const registry = createSlotRegistry();
    registry.addClaim({ pluginId: "p", priority: 1, slot: "session-card-badge", Component: lazyClaim(load, "Late") });
    render(
      <PluginContextProvider registry={registry}>
        <SessionCardBadgeSlot session={session} />
      </PluginContextProvider>,
    );
    expect(screen.queryByTestId("late")).toBeNull();
    release({ Late: () => <span data-testid="late">late</span> });
    await waitFor(() => expect(screen.getByTestId("late")).toBeDefined());
  });

  it("contains a rejected load to that claim; siblings still render", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = lazyClaim(() => Promise.reject(new Error("chunk 404")), "Bad");
    const registry = createSlotRegistry();
    registry.addClaim({ pluginId: "a", priority: 1, slot: "session-card-badge", Component: bad });
    registry.addClaim({
      pluginId: "b",
      priority: 2,
      slot: "session-card-badge",
      Component: () => <span data-testid="ok">ok</span>,
    });
    render(
      <PluginContextProvider registry={registry}>
        <SessionCardBadgeSlot session={session} />
      </PluginContextProvider>,
    );
    await waitFor(() => expect(spy.mock.calls.some((c) => String(c[0]).includes('Plugin "a"'))).toBe(true));
    expect(screen.getByTestId("ok")).toBeDefined();
    spy.mockRestore();
  });

  it("surfaces the [lazyClaim] error when the module lacks the named export", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "a",
      priority: 1,
      slot: "session-card-badge",
      Component: lazyClaim(async () => ({}), "Nope"),
    });
    render(
      <PluginContextProvider registry={registry}>
        <SessionCardBadgeSlot session={session} />
      </PluginContextProvider>,
    );
    await waitFor(() =>
      expect(
        spy.mock.calls.some((c) => c.some((arg) => String(arg).includes('[lazyClaim] module does not export component "Nope"'))),
      ).toBe(true),
    );
    spy.mockRestore();
  });
});

/**
 * `ShellHeadlessSlot` — no wrapper, no intents, runtime enable/disable,
 * zero-session mount, error isolation (test-plan #E9, #F6, #F7, #F8, #X2).
 * See change: fix-empty-status-subcard.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginContextProvider } from "../plugin-context.js";
import { bumpSlotClaimsVersion } from "../slot-claims-invalidation.js";
import { createSlotRegistry } from "../slot-registry.js";
import { ShellHeadlessSlot } from "../slot-consumers.js";

afterEach(cleanup);

const Probe = (id: string) => () => <i data-testid={id} />;

describe("ShellHeadlessSlot", () => {
  it("renders claims with no wrapper element and ignores intents (#E9)", () => {
    const r = createSlotRegistry();
    r.addClaim({ pluginId: "a", priority: 100, slot: "shell-headless", Component: Probe("h1") });
    r.addClaim({ pluginId: "b", priority: 101, slot: "shell-headless", Component: Probe("h2") });
    render(
      <PluginContextProvider registry={r}>
        <div data-testid="root">
          <ShellHeadlessSlot />
        </div>
      </PluginContextProvider>,
    );
    const root = screen.getByTestId("root");
    expect(Array.from(root.children).map((c) => c.getAttribute("data-testid"))).toEqual(["h1", "h2"]);
  });

  it("mounts with zero sessions and no selection (#F8)", () => {
    const r = createSlotRegistry();
    r.addClaim({ pluginId: "a", priority: 100, slot: "shell-headless", Component: Probe("h1") });
    render(
      <PluginContextProvider registry={r} sessions={[]} selectedSessionId={undefined}>
        <ShellHeadlessSlot />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("h1")).toBeDefined();
  });

  it("mounts on runtime enable and unmounts on disable without remounting the parent (#F6, #F7)", () => {
    const r = createSlotRegistry();
    r.addClaim({ pluginId: "a", priority: 100, slot: "shell-headless", Component: Probe("hl") });
    let enabled = new Set<string>();
    r.setEnabledSet(enabled);
    render(
      <PluginContextProvider registry={r}>
        <div data-testid="parent">
          <ShellHeadlessSlot />
        </div>
      </PluginContextProvider>,
    );
    const parent = screen.getByTestId("parent");
    expect(screen.queryByTestId("hl")).toBeNull();
    enabled = new Set(["a"]);
    act(() => {
      r.setEnabledSet(enabled);
      bumpSlotClaimsVersion();
    });
    expect(screen.getByTestId("hl")).toBeDefined();
    expect(screen.getByTestId("parent")).toBe(parent);
    act(() => {
      r.setEnabledSet(new Set());
      bumpSlotClaimsVersion();
    });
    expect(screen.queryByTestId("hl")).toBeNull();
  });

  it("a throwing claim is isolated from siblings and the app (#X2)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = createSlotRegistry();
    r.addClaim({
      pluginId: "bad",
      priority: 100,
      slot: "shell-headless",
      Component: () => {
        throw new Error("boom");
      },
    });
    r.addClaim({ pluginId: "ok", priority: 101, slot: "shell-headless", Component: Probe("ok") });
    render(
      <PluginContextProvider registry={r}>
        <ShellHeadlessSlot />
        <p data-testid="app" />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("ok")).toBeDefined();
    expect(screen.getByTestId("app")).toBeDefined();
    err.mockRestore();
  });
});

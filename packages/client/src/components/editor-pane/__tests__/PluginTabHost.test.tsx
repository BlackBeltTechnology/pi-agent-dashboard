/** PluginTabHost + EditorTabs plugin label (#E16 RTL, #F15 unit, #F16). See change: add-browser-editor-pane-tab. */
import { createSlotRegistry, PluginContextProvider, ShellSessionsProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenFile } from "../../../lib/layout/editor-pane-state.js";
import { EditorTabs } from "../EditorTabs.js";
import { PluginTabHost } from "../PluginTabHost.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const session = { id: "S", cwd: "/r", source: "tui", status: "active", startedAt: 0 } as DashboardSession;

function wrap(registry: ReturnType<typeof createSlotRegistry>, ui: React.ReactNode) {
  return (
    <PluginContextProvider registry={registry}>
      <ShellSessionsProvider value={new Map([["S", session]])}>{ui}</ShellSessionsProvider>
    </PluginContextProvider>
  );
}
const claimed = () => {
  const r = createSlotRegistry();
  r.addClaim({ pluginId: "browser", priority: 1, slot: "editor-pane-tab", pathPrefix: "browser", Component: (p: { path: string }) => <b data-testid="body">{p.path}</b> });
  return r;
};

describe("PluginTabHost", () => {
  it("claimed prefix renders the body and makes no /api/file request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(wrap(claimed(), <PluginTabHost path="browser:i:1" sessionId="S" isActive onClose={() => {}} />));
    expect(screen.getByTestId("body").textContent).toBe("browser:i:1");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("unclaimed prefix shows the placeholder naming the prefix; Close fires", () => {
    const onClose = vi.fn();
    render(wrap(createSlotRegistry(), <PluginTabHost path="browser:i:1" sessionId="S" isActive onClose={onClose} />));
    expect(screen.getByTestId("plugin-tab-unavailable").textContent).toContain("browser");
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("EditorTabs plugin label (#F16)", () => {
  const files: OpenFile[] = [
    { path: "browser:i:1", viewer: "plugin", addedAt: 1 },
    { path: "a.ts", viewer: "monaco", addedAt: 2 },
  ];
  it("renders pluginLabel for plugin tabs (background too) else the prefix", () => {
    const common = { openFiles: files, activeIndex: 1, onActivate: vi.fn(), onClose: vi.fn(), onReorder: vi.fn() };
    const { rerender } = render(<EditorTabs {...common} />);
    expect(screen.getAllByTestId("editor-tab")[0].textContent).toContain("browser");
    let title = "one";
    const pluginLabel = () => <span data-testid="lbl">{title}</span>;
    rerender(<EditorTabs {...common} pluginLabel={pluginLabel} />);
    expect(screen.getByTestId("lbl").textContent).toBe("one");
    title = "two";
    act(() => rerender(<EditorTabs {...common} pluginLabel={pluginLabel} />));
    expect(screen.getByTestId("lbl").textContent).toBe("two");
  });
});

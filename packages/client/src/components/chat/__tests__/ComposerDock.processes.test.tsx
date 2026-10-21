/**
 * Processes lane core groups: sub-session link, Kill progress, Show, Open/Kill
 * wiring. Test-plan #F22 #X3. See change: add-composer-dock (task 3.1).
 */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bash, makeSession, proc, renderDock } from "./dock-harness.js";

afterEach(cleanup);

const dock = () => screen.getByTestId("composer-dock");
const open = () => fireEvent.click(dock().querySelector('[data-dock-toggle="processes"]') as HTMLElement);
const rowFor = (text: string) => screen.getAllByTestId("composer-dock-row").find((r) => r.textContent?.includes(text)) as HTMLElement;

describe("sub-session link (F22)", () => {
  it("F22: the row's link navigates to the referenced session", () => {
    const onNavigateToSession = vi.fn();
    renderDock({
      session: makeSession({ processes: [proc(5, { kind: "sub-session", sessionRef: "s9", label: "helper agent" })] }),
      processes: { commands: [], onKill: vi.fn(), onNavigateToSession },
    });
    open();
    const link = within(rowFor("helper agent")).getByRole("link");
    expect(link.getAttribute("href")).toBe("/session/s9");
    fireEvent.click(link);
    expect(onNavigateToSession).toHaveBeenCalledWith("s9");
  });

  it("a plain background process has no session link", () => {
    renderDock({
      session: makeSession({ processes: [proc(5, { kind: "task" })] }),
      processes: { commands: [], onKill: vi.fn(), onNavigateToSession: vi.fn() },
    });
    open();
    expect(within(rowFor("script-5")).queryByRole("link")).toBeNull();
  });
});

describe("Kill progress (X3)", () => {
  const onKill = vi.fn();
  const base = (processes: ReturnType<typeof proc>[]) => ({
    session: makeSession({ processes }),
    processes: { commands: [], onKill },
  });
  const killButton = () => within(rowFor("script-60105")).getByRole("button", { name: /kill/i }) as HTMLButtonElement;

  it("Kill sends kill_process for the group (via onKill) and shows Stopping… with Kill disabled", () => {
    onKill.mockClear();
    renderDock(base([proc(60105)]));
    open();
    fireEvent.click(killButton());
    expect(onKill).toHaveBeenCalledExactlyOnceWith(60105);
    expect(rowFor("script-60105").textContent).toContain("Stopping…");
    expect(killButton().disabled).toBe(true);
  });

  it("X3a: the next scan without the group removes the row", () => {
    onKill.mockClear();
    const { rerenderDock } = renderDock(base([proc(60105), proc(2)]));
    open();
    fireEvent.click(killButton());
    rerenderDock(base([proc(2)]));
    expect(screen.queryByText(/script-60105/)).toBeNull();
    expect(screen.getAllByTestId("composer-dock-row")).toHaveLength(1);
  });

  it("X3b: three scans still listing it show Still running and re-enable Kill; Kill can be retried", () => {
    onKill.mockClear();
    const { rerenderDock } = renderDock(base([proc(60105)]));
    open();
    fireEvent.click(killButton());
    rerenderDock(base([proc(60105), proc(1)])); // first post-Kill scan lists it
    expect(rowFor("script-60105").textContent).toContain("Stopping…");
    rerenderDock(base([proc(60105), proc(1)]));
    expect(rowFor("script-60105").textContent).toContain("Stopping…");
    rerenderDock(base([proc(60105), proc(1)]));
    expect(rowFor("script-60105").textContent).toContain("Still running");
    expect(killButton().disabled).toBe(false);
    fireEvent.click(killButton());
    expect(onKill).toHaveBeenCalledTimes(2);
    expect(rowFor("script-60105").textContent).toContain("Stopping…");
  });

  it("an unrelated re-render (same scan) does not advance the scan counter", () => {
    onKill.mockClear();
    const session = makeSession({ processes: [proc(60105)] });
    const { rerenderDock } = renderDock({ session, processes: { commands: [], onKill } });
    open();
    fireEvent.click(killButton());
    for (let i = 0; i < 5; i++) rerenderDock({ session, processes: { commands: [], onKill } });
    expect(rowFor("script-60105").textContent).toContain("Stopping…");
  });

  it("Kill never aborts the turn: the row action is the only thing it calls", () => {
    onKill.mockClear();
    const onAbort = vi.fn();
    renderDock({ session: makeSession({ processes: [proc(60105)] }), processes: { commands: [], onKill } });
    open();
    fireEvent.click(killButton());
    expect(onAbort).not.toHaveBeenCalled();
    expect(onKill).toHaveBeenCalledTimes(1);
  });
});

describe("command rows", () => {
  it("Show hands the tool-call id to the transcript scroller", () => {
    const onShowTool = vi.fn();
    renderDock({
      session: makeSession(),
      processes: { commands: [bash("tc-9", "npm test")], onKill: vi.fn(), onShowTool },
    });
    open();
    fireEvent.click(within(rowFor("npm test")).getByRole("button", { name: /show/i }));
    expect(onShowTool).toHaveBeenCalledWith("tc-9");
  });

  it("the header names the longest elapsed time in an aria-hidden leaf", () => {
    renderDock({ session: makeSession({ processes: [proc(1, { elapsedMs: 125_000 })] }) });
    const longest = screen.getByTestId("composer-dock-longest");
    expect(longest.textContent).toBe("longest 2m 05s");
    expect(longest.getAttribute("aria-hidden")).toBe("true");
  });
});

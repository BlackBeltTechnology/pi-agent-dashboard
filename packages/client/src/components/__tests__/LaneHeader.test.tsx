/**
 * LaneHeader anatomy + a11y. See change: session-list-group-by.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LaneHeader } from "../session/LaneHeader.js";

afterEach(() => cleanup());

const K = "/repo";
const s = (id: string, over: Partial<DashboardSession> = {}) =>
  ({ id, cwd: K, source: "tui", status: "idle", startedAt: 0, tokensIn: 0, tokensOut: 0, cost: 0, ...over }) as DashboardSession;

describe("LaneHeader", () => {
  it("is a disclosure button with aria-expanded/aria-controls that toggles", () => {
    const onToggle = vi.fn();
    render(<LaneHeader folderKey={K} lane="working" count={2} collapsed={false} onToggle={onToggle} controlsId="c1" />);
    const btn = screen.getByTestId(`lane-toggle-${K}::working`);
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-controls")).toBe("c1");
    expect(btn.textContent).toContain("Working");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("collapsed status lane: count only, no rollup", () => {
    render(<LaneHeader folderKey={K} lane="idle" count={3} collapsed onToggle={() => {}} controlsId="c" sessions={[s("a")]} />);
    expect(screen.getByTestId(`lane-count-${K}::idle`).textContent).toBe("3");
    expect(screen.queryByTestId(`lane-rollup-${K}::idle`)).toBeNull();
  });

  it("collapsed location lane: count + rollup", () => {
    render(
      <LaneHeader
        folderKey={K}
        lane="worktrees"
        count={2}
        collapsed
        onToggle={() => {}}
        controlsId="c"
        sessions={[s("a", { status: "streaming" }), s("b", { currentTool: "ask_user" })]}
      />,
    );
    expect(screen.getByTestId(`lane-rollup-${K}::worktrees`)).toBeTruthy();
  });

  it("selected marker only when collapsed and containing the selection", () => {
    const { rerender } = render(
      <LaneHeader folderKey={K} lane="idle" count={1} collapsed onToggle={() => {}} controlsId="c" containsSelected />,
    );
    expect(screen.getByTestId(`lane-selected-marker-${K}::idle`)).toBeTruthy();
    rerender(<LaneHeader folderKey={K} lane="idle" count={1} collapsed={false} onToggle={() => {}} controlsId="c" containsSelected />);
    expect(screen.queryByTestId(`lane-selected-marker-${K}::idle`)).toBeNull();
  });

  it("main lane shows the branch sub label", () => {
    render(<LaneHeader folderKey={K} lane="main" count={1} collapsed={false} onToggle={() => {}} controlsId="c" sub="develop" />);
    expect(screen.getByTestId(`lane-toggle-${K}::main`).textContent).toContain("· develop");
  });
});

/**
 * The board's change-state pill is the shared status pill. The state → kind
 * mapping (`openspec-board-status-visuals`) is unchanged; only the rendering moved.
 * See change: align-ui-contract-recipes (design D4).
 */
import { ChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BoardStatePill } from "../openspec/OpenSpecBoardView.js";

afterEach(cleanup);

describe("BoardStatePill", () => {
  it.each([
    [ChangeState.PLANNING, "Planning", "neutral"],
    [ChangeState.READY, "Ready", "neutral"],
    [ChangeState.IMPLEMENTING, "Implementing", "info"],
    [ChangeState.COMPLETE, "Complete", "success"],
  ] as const)("%s reads as the word %s in the %s tone, with the state attribute kept", (state, word, tone) => {
    render(<BoardStatePill state={state} testId="pill" />);
    const wrap = screen.getByTestId("pill");
    expect(wrap.getAttribute("data-state")).toBe(state);
    expect(wrap.textContent).toBe(word);
    const pill = wrap.querySelector("[data-tone]") as HTMLElement;
    expect(pill.getAttribute("data-tone")).toBe(tone);
    expect(pill.className).toContain(`text-[var(--severity-${tone}-fg)]`);
  });

  it("is not a 9 px uppercase pill and paints no inline colour (the svg keeps its own size style)", () => {
    render(<BoardStatePill state={ChangeState.COMPLETE} testId="pill" />);
    const html = screen.getByTestId("pill").outerHTML;
    expect(html).not.toContain("text-[9px]");
    expect(html).not.toContain("uppercase");
    // `fill: currentcolor` on the svg path is fine; an inline `color:` / `background` is not.
    expect(html).not.toMatch(/style="[^"]*(?:[;"\s]color\s*:|background)/);
    expect(html).not.toContain("color-mix");
  });

  it("complete and planning differ by more than hue: done has an icon, todo is word-only", () => {
    const { unmount } = render(<BoardStatePill state={ChangeState.COMPLETE} testId="done" />);
    expect(screen.getByTestId("done").querySelector("svg")).toBeTruthy();
    unmount();
    render(<BoardStatePill state={ChangeState.PLANNING} testId="todo" />);
    expect(screen.getByTestId("todo").textContent).toBe("Planning");
  });
});

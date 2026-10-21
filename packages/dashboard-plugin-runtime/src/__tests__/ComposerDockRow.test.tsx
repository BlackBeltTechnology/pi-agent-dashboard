/**
 * ComposerDockRow — the shared Processes-lane row primitive.
 * See change: add-composer-dock (dashboard-shell-slots: "Process group rows use the dock row primitive").
 */
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerDockRow } from "../ComposerDockRow.js";
import * as publicApi from "../public.js";

const NOW = new Date("2026-01-01T00:00:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ComposerDockRow", () => {
  it("is exported from the public index", () => {
    expect(publicApi.ComposerDockRow).toBe(ComposerDockRow);
  });

  it("renders a 32 px row with icon, title, detail and meta", () => {
    render(
      <ComposerDockRow icon={<svg data-testid="ic" />} title="explorer" detail="Map the repo" meta="scout · 3 steps" />,
    );
    const row = screen.getByTestId("composer-dock-row");
    expect(row.className).toContain("min-h-8");
    expect(screen.getByTestId("ic")).toBeTruthy();
    expect(screen.getByText("explorer")).toBeTruthy();
    expect(screen.getByText("Map the repo")).toBeTruthy();
    expect(screen.getByText("scout · 3 steps")).toBeTruthy();
  });

  it("truncates title and detail, exposing the full text as a tooltip", () => {
    const longTitle = "a-very-long-subagent-name-".repeat(6);
    const longDetail = "an extremely long task description ".repeat(10);
    render(<ComposerDockRow icon={<span />} title={longTitle} detail={longDetail} />);
    const title = screen.getByTestId("composer-dock-row-title");
    const detail = screen.getByTestId("composer-dock-row-detail");
    for (const el of [title, detail]) {
      expect(el.className).toContain("truncate");
      expect(el.className).toContain("min-w-0");
    }
    expect(title.getAttribute("title")).toBe(longTitle);
    expect(detail.getAttribute("title")).toBe(longDetail);
  });

  it("omits detail, meta and elapsed when not given", () => {
    render(<ComposerDockRow icon={<span />} title="only title" />);
    expect(screen.queryByTestId("composer-dock-row-detail")).toBeNull();
    expect(screen.queryByTestId("composer-dock-row-meta")).toBeNull();
    expect(screen.queryByTestId("composer-dock-row-elapsed")).toBeNull();
    expect(screen.queryByTestId("composer-dock-row-actions")).toBeNull();
  });

  it("enforces ≥24 px (≥44 px at phone width) targets on a 16 px icon action, whatever the caller passes", () => {
    render(
      <ComposerDockRow
        icon={<span />}
        title="t"
        actions={
          <button type="button" aria-label="Open" style={{ width: 16, height: 16, padding: 0 }}>
            <svg width={16} height={16} />
          </button>
        }
      />,
    );
    const cluster = screen.getByTestId("composer-dock-row-actions");
    expect(cluster.contains(screen.getByRole("button", { name: "Open" }))).toBe(true);
    for (const target of ["button", "a", "[role=button]"]) {
      expect(cluster.className).toContain(`[&_${target}]:min-h-6`);
      expect(cluster.className).toContain(`[&_${target}]:min-w-6`);
      expect(cluster.className).toContain(`max-md:[&_${target}]:min-h-11`);
      expect(cluster.className).toContain(`max-md:[&_${target}]:min-w-11`);
    }
  });

  it("renders elapsed since startedAt and advances it each second", () => {
    render(<ComposerDockRow icon={<span />} title="t" startedAt={NOW - 5_000} />);
    const elapsed = screen.getByTestId("composer-dock-row-elapsed");
    expect(elapsed.textContent).toBe("5s");
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(elapsed.textContent).toBe("8s");
    act(() => { vi.advanceTimersByTime(55_000); });
    expect(elapsed.textContent).toBe("1m 03s");
  });

  it("starts no timer without startedAt and clears it on unmount", () => {
    const { unmount } = render(<ComposerDockRow icon={<span />} title="t" />);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    render(<ComposerDockRow icon={<span />} title="t" startedAt={NOW} />).unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the elapsed node outside any live region", () => {
    render(<ComposerDockRow icon={<span />} title="t" startedAt={NOW - 1_000} />);
    const elapsed = screen.getByTestId("composer-dock-row-elapsed");
    expect(elapsed.hasAttribute("aria-live")).toBe(false);
    expect(elapsed.closest("[aria-live]")).toBeNull();
    expect(elapsed.closest("[role=status],[role=log],[role=alert]")).toBeNull();
  });
});

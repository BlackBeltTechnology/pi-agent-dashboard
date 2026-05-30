import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { ProcessList, computeVisibleRows, KILL_TOOLTIP, type ProcessEntry } from "../ProcessList.js";

function mkProc(pid: number, elapsedMs: number, command = `node script-${pid}.js`): ProcessEntry {
  return { pid, pgid: pid, command, elapsedMs };
}

afterEach(() => cleanup());

describe("computeVisibleRows (redesign-process-list-activity-bar — skeleton padding removed)", () => {
  it("empty input returns empty visible + empty overflow", () => {
    expect(computeVisibleRows([])).toEqual({ visible: [], overflow: [] });
  });

  it("1 process → 1 visible, no overflow, NO skeleton padding", () => {
    const r = computeVisibleRows([mkProc(1, 60_000)]);
    expect(r.visible).toHaveLength(1);
    expect(r.overflow).toHaveLength(0);
    expect("skeletonCount" in r).toBe(false);
  });

  it("3 processes → 3 visible, no overflow, no padding", () => {
    const r = computeVisibleRows([mkProc(1, 10), mkProc(2, 20), mkProc(3, 30)]);
    expect(r.visible).toHaveLength(3);
    expect(r.overflow).toHaveLength(0);
  });

  it("exactly 5 → 5 visible, no overflow", () => {
    const five = [mkProc(1, 1), mkProc(2, 2), mkProc(3, 3), mkProc(4, 4), mkProc(5, 5)];
    const r = computeVisibleRows(five);
    expect(r.visible).toHaveLength(5);
    expect(r.overflow).toHaveLength(0);
  });

  it("clips to 5 + overflow at length 6", () => {
    const six = Array.from({ length: 6 }, (_, i) => mkProc(i + 1, (i + 1) * 1000));
    const r = computeVisibleRows(six);
    expect(r.visible).toHaveLength(5);
    expect(r.overflow).toHaveLength(1);
  });

  it("orders by elapsedMs descending", () => {
    const r = computeVisibleRows([mkProc(1, 60_000), mkProc(2, 10_000), mkProc(3, 120_000)]);
    expect(r.visible.map(p => p.elapsedMs)).toEqual([120_000, 60_000, 10_000]);
  });

  it("overflow contains the shortest-running entries when N>5", () => {
    const procs = Array.from({ length: 8 }, (_, i) => mkProc(i + 1, (i + 1) * 1000));
    const r = computeVisibleRows(procs);
    expect(r.overflow.map(p => p.elapsedMs).sort((a, b) => a - b)).toEqual([1000, 2000, 3000]);
  });
});

describe("ProcessList drawer (redesign-process-list-activity-bar)", () => {
  const noop = vi.fn();
  const noopToggle = vi.fn();

  it("returns null at length 0", () => {
    const { container } = render(
      <ProcessList processes={[]} onKill={noop} expanded={true} onToggle={noopToggle} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("collapsed: renders only the summary row, no process rows", () => {
    const procs = [mkProc(1, 60_000), mkProc(2, 30_000)];
    const { container, getByTestId } = render(
      <ProcessList processes={procs} onKill={noop} expanded={false} onToggle={noopToggle} />,
    );
    const summary = getByTestId("background-drawer-summary");
    expect(summary.textContent).toContain("2 background processes");
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    // No process rows when collapsed
    expect(container.textContent).not.toContain("script-1");
    expect(container.textContent).not.toContain("script-2");
  });

  it("expanded: renders summary + rows, no skeletons", () => {
    const procs = [mkProc(1, 60_000)];
    const { container, getByTestId } = render(
      <ProcessList processes={procs} onKill={noop} expanded={true} onToggle={noopToggle} />,
    );
    const summary = getByTestId("background-drawer-summary");
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("1 background process");
    expect(container.textContent).toContain("script-1");
    // NO skeleton rows — previous MIN_SLOTS padding removed
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it("expanded: 1 process renders exactly 1 process row (no skeletons)", () => {
    const { container } = render(
      <ProcessList processes={[mkProc(1, 60_000)]} onKill={noop} expanded={true} onToggle={noopToggle} />,
    );
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it("expanded: renders 5 real rows + overflow row at length 7", () => {
    const seven = Array.from({ length: 7 }, (_, i) => mkProc(i + 1, (i + 1) * 1000, `cmd-${i + 1}`));
    const { container } = render(
      <ProcessList processes={seven} onKill={noop} expanded={true} onToggle={noopToggle} />,
    );
    expect(container.textContent).toContain("+2 more processes");
  });

  it("overflow row title attribute lists hidden command lines", () => {
    const procs: ProcessEntry[] = [
      mkProc(1, 9000, "long-a"),
      mkProc(2, 8000, "long-b"),
      mkProc(3, 7000, "long-c"),
      mkProc(4, 6000, "long-d"),
      mkProc(5, 5000, "long-e"),
      mkProc(6, 4000, "hidden-f"),
      mkProc(7, 3000, "hidden-g"),
    ];
    const { container } = render(
      <ProcessList processes={procs} onKill={noop} expanded={true} onToggle={noopToggle} />,
    );
    const overflowRow = Array.from(container.querySelectorAll<HTMLElement>("[title]"))
      .find((el) => el.textContent?.includes("more processes"));
    expect(overflowRow).toBeTruthy();
    const title = overflowRow!.getAttribute("title") ?? "";
    expect(title).toContain("hidden-f");
    expect(title).toContain("hidden-g");
    expect(title).not.toContain("long-a");
  });

  it("clicking summary row invokes onToggle", () => {
    const onToggle = vi.fn();
    const { getByTestId } = render(
      <ProcessList processes={[mkProc(1, 60_000)]} onKill={noop} expanded={false} onToggle={onToggle} />,
    );
    fireEvent.click(getByTestId("background-drawer-summary"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("per-row ✕ click invokes onKill with the pgid", () => {
    const onKill = vi.fn();
    const procs = [mkProc(48213, 60_000, "vitest --watch")];
    const { container } = render(
      <ProcessList processes={procs} onKill={onKill} expanded={true} onToggle={noopToggle} />,
    );
    const killBtn = container.querySelector(`[aria-label="${KILL_TOOLTIP}"]`) as HTMLButtonElement;
    expect(killBtn).toBeTruthy();
    fireEvent.click(killBtn);
    expect(onKill).toHaveBeenCalledWith(48213);
  });

  it("per-row ✕ tooltip is the force-kill string", () => {
    const procs = [mkProc(1, 60_000)];
    const { container } = render(
      <ProcessList processes={procs} onKill={noop} expanded={true} onToggle={noopToggle} />,
    );
    const killBtn = container.querySelector(`[title="${KILL_TOOLTIP}"]`);
    expect(killBtn).toBeTruthy();
  });

  it("orders visible rows by elapsedMs descending", () => {
    const procs = [
      mkProc(1, 60_000, "cmd-medium"),
      mkProc(2, 10_000, "cmd-short"),
      mkProc(3, 120_000, "cmd-long"),
    ];
    const { container } = render(
      <ProcessList processes={procs} onKill={noop} expanded={true} onToggle={noopToggle} />,
    );
    const text = container.textContent ?? "";
    const idxLong = text.indexOf("cmd-long");
    const idxMedium = text.indexOf("cmd-medium");
    const idxShort = text.indexOf("cmd-short");
    expect(idxLong).toBeGreaterThanOrEqual(0);
    expect(idxLong).toBeLessThan(idxMedium);
    expect(idxMedium).toBeLessThan(idxShort);
  });

  it("compact layout: collapsed shows only summary", () => {
    const procs = [mkProc(1, 60_000), mkProc(2, 30_000)];
    const { container } = render(
      <ProcessList processes={procs} onKill={noop} expanded={false} onToggle={noopToggle} compact />,
    );
    expect(container.textContent).toContain("2 background processes");
    expect(container.textContent).not.toContain("script-1");
  });

  it("compact layout: expanded renders rows + overflow tail", () => {
    const six = Array.from({ length: 6 }, (_, i) => mkProc(i + 1, (i + 1) * 1000));
    const { container } = render(
      <ProcessList processes={six} onKill={noop} expanded={true} onToggle={noopToggle} compact />,
    );
    expect(container.textContent).toContain("+1 more processes");
  });

  it("summary row reports singular for 1 process", () => {
    const { getByTestId } = render(
      <ProcessList processes={[mkProc(1, 60_000)]} onKill={noop} expanded={false} onToggle={noopToggle} />,
    );
    expect(getByTestId("background-drawer-summary").textContent).toContain("1 background process");
    expect(getByTestId("background-drawer-summary").textContent).not.toContain("processes");
  });
});

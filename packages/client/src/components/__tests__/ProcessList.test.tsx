import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeVisibleRows, KILL_TOOLTIP, type ProcessEntry, ProcessList } from "../terminal/ProcessList.js";

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

describe("ProcessList rows (stable-process-line — rows-only, summary folded into unified line)", () => {
  const noop = vi.fn();

  it("returns null at length 0", () => {
    const { container } = render(<ProcessList processes={[]} onKill={noop} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders rows directly (no standalone summary), no skeletons", () => {
    const procs = [mkProc(1, 60_000)];
    const { container, queryByTestId } = render(
      <ProcessList processes={procs} onKill={noop} />,
    );
    expect(container.textContent).toContain("script-1");
    // The standalone `⚠ N` summary row is gone — folded into the unified line.
    expect(queryByTestId("background-drawer-summary")).toBeNull();
    // NO skeleton rows.
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it("1 process renders exactly 1 process row (no skeletons)", () => {
    const { container } = render(<ProcessList processes={[mkProc(1, 60_000)]} onKill={noop} />);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it("renders 5 real rows + overflow row at length 7", () => {
    const seven = Array.from({ length: 7 }, (_, i) => mkProc(i + 1, (i + 1) * 1000, `cmd-${i + 1}`));
    const { container } = render(<ProcessList processes={seven} onKill={noop} />);
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
    const { container } = render(<ProcessList processes={procs} onKill={noop} />);
    const overflowRow = Array.from(container.querySelectorAll<HTMLElement>("[title]"))
      .find((el) => el.textContent?.includes("more processes"));
    expect(overflowRow).toBeTruthy();
    const title = overflowRow!.getAttribute("title") ?? "";
    expect(title).toContain("hidden-f");
    expect(title).toContain("hidden-g");
    expect(title).not.toContain("long-a");
  });

  it("per-row ✕ click invokes onKill with the pgid", () => {
    const onKill = vi.fn();
    const procs = [mkProc(48213, 60_000, "vitest --watch")];
    const { container } = render(<ProcessList processes={procs} onKill={onKill} />);
    const killBtn = container.querySelector(`[aria-label="${KILL_TOOLTIP}"]`) as HTMLButtonElement;
    expect(killBtn).toBeTruthy();
    fireEvent.click(killBtn);
    expect(onKill).toHaveBeenCalledWith(48213);
  });

  it("per-row ✕ tooltip is the force-kill string", () => {
    const procs = [mkProc(1, 60_000)];
    const { container } = render(<ProcessList processes={procs} onKill={noop} />);
    const killBtn = container.querySelector(`[title="${KILL_TOOLTIP}"]`);
    expect(killBtn).toBeTruthy();
  });

  it("orders visible rows by elapsedMs descending", () => {
    const procs = [
      mkProc(1, 60_000, "cmd-medium"),
      mkProc(2, 10_000, "cmd-short"),
      mkProc(3, 120_000, "cmd-long"),
    ];
    const { container } = render(<ProcessList processes={procs} onKill={noop} />);
    const text = container.textContent ?? "";
    const idxLong = text.indexOf("cmd-long");
    const idxMedium = text.indexOf("cmd-medium");
    const idxShort = text.indexOf("cmd-short");
    expect(idxLong).toBeGreaterThanOrEqual(0);
    expect(idxLong).toBeLessThan(idxMedium);
    expect(idxMedium).toBeLessThan(idxShort);
  });

  it("compact layout: renders rows + overflow tail", () => {
    const six = Array.from({ length: 6 }, (_, i) => mkProc(i + 1, (i + 1) * 1000));
    const { container } = render(<ProcessList processes={six} onKill={noop} compact />);
    expect(container.textContent).toContain("+1 more processes");
  });
});

describe("ProcessList classification (classify-process-list-entries)", () => {
  const noop = vi.fn();

  function classified(partial: Partial<ProcessEntry> & { pid: number }): ProcessEntry {
    return { pgid: partial.pid, command: "raw-command", elapsedMs: 60_000, ...partial };
  }

  it("renders the friendly label instead of the raw command", () => {
    const procs = [classified({ pid: 1, kind: "task", label: "vitest --watch", command: "node /x/vitest.mjs --watch" })];
    const { container } = render(<ProcessList processes={procs} onKill={noop} />);
    expect(container.textContent).toContain("vitest --watch");
    expect(container.textContent).not.toContain("/x/vitest.mjs");
  });

  it("renders an icon (svg path) per row for each kind", () => {
    const procs = [
      classified({ pid: 1, kind: "plugin", label: "context-mode" }),
      classified({ pid: 2, kind: "task", label: "node vite" }),
    ];
    const { container } = render(<ProcessList processes={procs} onKill={noop} />);
    // Each row carries a kind icon + a kill icon → ≥ 4 svgs (2 kind + 2 kill).
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(4);
    expect(container.textContent).toContain("context-mode");
  });

  it("sub-session row is a button that navigates to sessionRef on click", () => {
    const onNavigate = vi.fn();
    const procs = [classified({ pid: 1, kind: "sub-session", label: "build worker", sessionRef: "abc123" })];
    const { getByText } = render(
      <ProcessList processes={procs} onKill={noop} onNavigateToSession={onNavigate} />,
    );
    const link = getByText("build worker");
    expect(link.tagName).toBe("BUTTON");
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith("abc123");
  });

  it("sub-session label is a plain span when no navigate handler is provided", () => {
    const procs = [classified({ pid: 1, kind: "sub-session", label: "worker", sessionRef: "abc123" })];
    const { getByText } = render(<ProcessList processes={procs} onKill={noop} />);
    expect(getByText("worker").tagName).toBe("SPAN");
  });

  it("backward-compatible: no kind/label falls back to raw command + kill button", () => {
    const procs = [classified({ pid: 7, command: "legacy-cmd --flag" })];
    const { container } = render(<ProcessList processes={procs} onKill={noop} />);
    expect(container.textContent).toContain("legacy-cmd --flag");
    expect(container.querySelector(`[aria-label="${KILL_TOOLTIP}"]`)).toBeTruthy();
  });
});

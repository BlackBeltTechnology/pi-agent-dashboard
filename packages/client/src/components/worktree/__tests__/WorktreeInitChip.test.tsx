/**
 * Class-contract tests for `WorktreeInitChip` (fits-banner layout, quiet body copy, type floor).
 *
 * jsdom cannot measure layout, so these pin the class contract; the rendered
 * overflow / contrast behaviour is asserted at L3 (`tests/e2e/worktree-init-feedback.spec.ts`).
 *
 * See change: fix-worktree-init-chip-overflow.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientInitRun } from "../../../lib/git/worktree-init-store.js";
import { WorktreeInitChip } from "../WorktreeInitChip.js";

afterEach(cleanup);

const LONG_LINE = "downloading artifact ".repeat(11).trim();
const LONG_PATH = `/Users/someone/${"deeply-nested-directory/".repeat(6)}file.jar`;

const running: ClientInitRun = {
  cwd: "/repo",
  phase: "running",
  startedAt: Date.now(),
  lastLine: LONG_LINE,
  logTail: `${LONG_LINE}\n${LONG_PATH}`,
};
const done: ClientInitRun = { cwd: "/repo", phase: "done", startedAt: Date.now() };
const failed: ClientInitRun = {
  cwd: "/repo",
  phase: "failed",
  startedAt: Date.now(),
  code: "script_nonzero_exit",
  message: LONG_PATH,
  stderr: LONG_PATH,
};

const classes = (el: HTMLElement): string[] => el.className.split(/\s+/).filter(Boolean);
const allClasses = (root: HTMLElement): string[] =>
  [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))].flatMap((e) =>
    typeof e.className === "string" ? classes(e) : [],
  );

describe("WorktreeInitChip fits its banner (#E1, #E2)", () => {
  it("running chip is a full-width, capped column with no min-width floor", () => {
    render(<WorktreeInitChip run={running} />);
    const chip = screen.getByTestId("worktree-init-chip");
    const c = classes(chip);
    for (const k of ["flex", "flex-col", "w-full", "max-w-[420px]"]) expect(c).toContain(k);
    expect(c).not.toContain("inline-flex");
    expect(c).not.toContain("min-w-[240px]");

    const ghost = classes(screen.getByTestId("worktree-init-ghost"));
    for (const k of ["whitespace-nowrap", "overflow-hidden", "text-ellipsis", "max-w-full"]) expect(ghost).toContain(k);
    expect(ghost).not.toContain("max-w-[420px]");

    expect(classes(screen.getByTestId("worktree-init-log"))).toContain("max-w-full");
    const pre = screen.getByTestId("worktree-init-log").querySelector("pre") as HTMLElement;
    expect(classes(pre)).toContain("[overflow-wrap:anywhere]");
  });

  it("failed chip is a full-width, capped column whose message wraps anywhere", () => {
    render(<WorktreeInitChip run={failed} onRetry={vi.fn()} />);
    const c = classes(screen.getByTestId("worktree-init-chip"));
    for (const k of ["flex", "flex-col", "gap-1", "w-full", "max-w-[460px]"]) expect(c).toContain(k);
    expect(c).not.toContain("inline-flex");

    const msg = classes(screen.getByTestId("worktree-init-message"));
    expect(msg).toContain("[overflow-wrap:anywhere]");
    expect(msg).not.toContain("break-words");
    expect(screen.getByTestId("worktree-init-retry")).toBeTruthy();
  });
});

describe("WorktreeInitChip quiet body copy (#E3)", () => {
  const SECONDARY = "text-[var(--text-secondary)]";

  it("running: elapsed, ghost and <pre> use --text-secondary; chrome inherits", () => {
    render(<WorktreeInitChip run={running} />);
    const chip = screen.getByTestId("worktree-init-chip");
    expect(classes(screen.getByTestId("worktree-init-elapsed"))).toContain(SECONDARY);
    expect(classes(screen.getByTestId("worktree-init-ghost"))).toContain(SECONDARY);
    const log = screen.getByTestId("worktree-init-log");
    expect(classes(log.querySelector("pre") as HTMLElement)).toContain(SECONDARY);
    expect(classes(log.querySelector("summary") as HTMLElement).some((k) => k.startsWith("text-[var("))).toBe(false);
    // Status label span carries no colour class.
    const label = Array.from(chip.querySelectorAll<HTMLElement>("span.font-semibold"))[0];
    expect(classes(label).some((k) => /^text-(\[var|\w+-\d{3})/.test(k))).toBe(false);
  });

  it("done: elapsed uses --text-secondary", () => {
    render(<WorktreeInitChip run={done} />);
    expect(classes(screen.getByTestId("worktree-init-elapsed"))).toContain(SECONDARY);
  });

  it("failed: message uses --text-secondary; Retry inherits", () => {
    render(<WorktreeInitChip run={failed} onRetry={vi.fn()} />);
    expect(classes(screen.getByTestId("worktree-init-message"))).toContain(SECONDARY);
    expect(classes(screen.getByTestId("worktree-init-retry")).some((k) => k.startsWith("text-[var("))).toBe(false);
  });

  it("no muted/tertiary token and no -400/-500 palette class anywhere", () => {
    for (const [run, onRetry] of [
      [running, undefined],
      [done, undefined],
      [failed, vi.fn()],
    ] as const) {
      const { container, unmount } = render(<WorktreeInitChip run={run} onRetry={onRetry} />);
      const all = allClasses(container);
      expect(all.filter((k) => /--text-muted|--text-tertiary|-(400|500)$/.test(k))).toEqual([]);
      unmount();
    }
  });
});

describe("WorktreeInitChip type floor (#E4)", () => {
  it("toggle is 12px underlined, Retry is 12px tap-target, body copy 11px", () => {
    const { unmount } = render(<WorktreeInitChip run={running} />);
    const log = screen.getByTestId("worktree-init-log");
    const summary = classes(log.querySelector("summary") as HTMLElement);
    expect(summary).toContain("text-[12px]");
    expect(summary).toContain("underline");
    expect(classes(log.querySelector("pre") as HTMLElement)).toContain("text-[11px]");
    unmount();

    const { container } = render(<WorktreeInitChip run={failed} onRetry={vi.fn()} />);
    const retry = classes(screen.getByTestId("worktree-init-retry"));
    expect(retry).toContain("text-[12px]");
    expect(retry).toContain("tap-target");
    expect(classes(screen.getByTestId("worktree-init-message"))).toContain("text-[11px]");
    expect(allClasses(container).filter((k) => /^text-\[(10\.5|10|9)px\]$/.test(k))).toEqual([]);
  });
});

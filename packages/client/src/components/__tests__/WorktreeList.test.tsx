/**
 * Component tests for the shared `WorktreeList`.
 *
 * Pins the filter contract (default predicate, chip coverage, union count),
 * path rendering (suppression truth table, elision integrity, separator
 * normalisation), and the two modes' interaction shapes (spawn = whole-row
 * button; manage = non-button container with separate tab stops).
 *
 * See change: manage-worktrees-filter-cleanup.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorktreeEntry } from "../../lib/git/git-api.js";
import { isInTree, suppressPathLine, WorktreeList } from "../worktree/WorktreeList.js";

afterEach(() => cleanup());

const MAIN = "/repo";

function entry(over: Partial<WorktreeEntry> & { path: string }): WorktreeEntry {
  return {
    branch: null,
    sha: "abc123",
    bare: false,
    detached: false,
    isMain: false,
    ...over,
  };
}

/**
 * 9 entries covering every reachable `(isMain, detached, inTree)` combo:
 * main · in-tree attached ×2 · in-tree detached ×4 · out-of-tree detached ×1
 * (the DUAL-group row) · out-of-tree attached ×1 (reachable via the spawn
 * dialog's free-text `pathOverride`).
 */
function fixture(): WorktreeEntry[] {
  return [
    entry({ path: MAIN, branch: "main", isMain: true }),
    entry({ path: `${MAIN}/.worktrees/feat-a`, branch: "feat-a" }),
    entry({ path: `${MAIN}/.worktrees/feat-b`, branch: "feat-b" }),
    entry({ path: `${MAIN}/.worktrees/det-1`, detached: true }),
    entry({ path: `${MAIN}/.worktrees/det-2`, detached: true }),
    entry({ path: `${MAIN}/.worktrees/det-3`, detached: true }),
    entry({ path: `${MAIN}/.worktrees/det-4`, detached: true }),
    entry({ path: "/home/u/scratch/det-out", detached: true }), // dual group
    entry({ path: "/home/u/scratch/my-feature", branch: "my-feature" }), // out-of-tree attached
  ];
}

function rowIds(): string[] {
  return Array.from(document.querySelectorAll("[data-testid^='worktree-row-']"))
    .map((el) => el.getAttribute("data-testid") ?? "")
    .filter((id) => !id.includes("-missing") && !id.includes("-failure") && !id.includes("-retry"));
}

// ── filtering ──────────────────────────────────────────────────────

describe("WorktreeList default predicate", () => {
  // test-plan #E1
  it("renders exactly the 3 default rows and omits the other 6 from the DOM", () => {
    render(<WorktreeList entries={fixture()} mode="spawn" />);
    expect(rowIds()).toHaveLength(3);
    expect(screen.getByTestId("worktree-row-main")).toBeTruthy();
    expect(screen.getByText("feat-a")).toBeTruthy();
    expect(screen.getByText("feat-b")).toBeTruthy();
    // Assert on row identity, not on rendered text — a text-only check would
    // pass vacuously because the row renders its PATH, not its basename.
    for (const hidden of [
      `${MAIN}/.worktrees/det-1`,
      `${MAIN}/.worktrees/det-2`,
      `${MAIN}/.worktrees/det-3`,
      `${MAIN}/.worktrees/det-4`,
      "/home/u/scratch/det-out",
      "/home/u/scratch/my-feature",
    ]) {
      expect(screen.queryByTestId(`worktree-row-${encodeURIComponent(hidden)}`), hidden).toBeNull();
    }
  });

  // test-plan #E2 — coverage is an INVARIANT: no hidden row may be uncounted.
  it("counts every hidden row in at least one chip", () => {
    const entries = fixture();
    render(<WorktreeList entries={entries} mode="spawn" />);
    const detachedChip = screen.getByTestId("worktree-chip-detached");
    const outChip = screen.getByTestId("worktree-chip-outOfTree");
    // 5 hidden detached (4 in-tree + the dual-group row); 2 hidden out-of-tree.
    expect(detachedChip.textContent).toMatch(/detached\s+5/);
    expect(outChip.textContent).toMatch(/out of tree\s+2/);

    // Revealing both chips must account for every one of the 6 hidden rows.
    fireEvent.click(detachedChip);
    fireEvent.click(screen.getByTestId("worktree-chip-outOfTree"));
    expect(rowIds()).toHaveLength(entries.length);
  });

  // test-plan #E3 — the count is a UNION, not a sum of chip counts.
  it("counts a dual-group row exactly once and renders it once per reveal", () => {
    render(<WorktreeList entries={fixture()} mode="spawn" />);
    expect(screen.getByTestId("worktree-shown-count").textContent).toMatch(/3\s+of\s+9/);

    const dualId = `worktree-row-${encodeURIComponent("/home/u/scratch/det-out")}`;
    fireEvent.click(screen.getByTestId("worktree-chip-detached"));
    expect(screen.getAllByTestId(dualId)).toHaveLength(1);
    expect(screen.getByTestId("worktree-shown-count").textContent).toMatch(/8\s+of\s+9/);
    fireEvent.click(screen.getByTestId("worktree-chip-detached")); // hide again

    fireEvent.click(screen.getByTestId("worktree-chip-outOfTree"));
    expect(screen.getAllByTestId(dualId)).toHaveLength(1);
    // Union, not sum: revealing out-of-tree adds 2 rows (5 + 2 chip counts
    // would be 7 more, which double-counts the dual-group row).
    expect(screen.getByTestId("worktree-shown-count").textContent).toMatch(/5\s+of\s+9/);
  });

  // test-plan #E4 — `branch` is nullable; a query must never throw on it.
  it("matches a null-branch entry by path substring without throwing", () => {
    const entries = [
      entry({ path: MAIN, branch: "main", isMain: true }),
      entry({ path: "/elsewhere/zzunique-detached", detached: true }),
      entry({ path: "/elsewhere/bare-one", bare: true }),
    ];
    render(<WorktreeList entries={entries} mode="spawn" />);
    expect(() => {
      fireEvent.change(screen.getByTestId("worktree-filter-query"), {
        target: { value: "zzunique" },
      });
    }).not.toThrow();
    expect(
      screen.getByTestId(`worktree-row-${encodeURIComponent("/elsewhere/zzunique-detached")}`),
    ).toBeTruthy();
  });

  // test-plan #E13 — without `\` → `/` normalisation every Windows row would
  // classify out-of-tree and the default view would collapse to the main row.
  it("classifies Windows-separator paths as in-tree", () => {
    expect(isInTree("C:\\repo\\.worktrees\\feat-x", "C:\\repo")).toBe(true);
    const entries = [
      entry({ path: "C:\\repo", branch: "main", isMain: true }),
      entry({ path: "C:\\repo\\.worktrees\\feat-x", branch: "feat-x" }),
    ];
    render(<WorktreeList entries={entries} mode="spawn" />);
    expect(rowIds()).toHaveLength(2);
  });
});

// ── path rendering ─────────────────────────────────────────────────

describe("WorktreeList path rendering", () => {
  // test-plan #E9 — suppression truth table.
  it("suppresses the path line only for in-tree rows whose basename restates the branch", () => {
    const rows: Array<[WorktreeEntry, boolean]> = [
      [entry({ path: `${MAIN}/.worktrees/feat-x`, branch: "feat-x" }), true],
      // slugifyBranch collapses `/` → `-`, so `feat/bar` lands in ONE segment.
      [entry({ path: `${MAIN}/.worktrees/feat-bar`, branch: "feat/bar" }), true],
      [entry({ path: `${MAIN}/.worktrees/pr-42`, branch: "pr-42" }), true],
      // Out-of-tree pathOverride: basename matches by coincidence — must NOT suppress.
      [entry({ path: "/home/u/scratch/my-feature", branch: "my-feature" }), false],
      // Detached: `slugifyBranch(null)` would throw; the guard must hold.
      [entry({ path: `${MAIN}/.worktrees/det`, branch: null, detached: true }), false],
    ];
    for (const [e, expected] of rows) {
      expect(suppressPathLine(e, MAIN), e.path).toBe(expected);
    }
    // The null-branch row specifically must not throw.
    expect(() => suppressPathLine(rows[4][0], MAIN)).not.toThrow();
  });

  // test-plan #F8 — CSS `direction:rtl` would render `.worktrees/x` as
  // `worktrees/x.`, corrupting the identifier.
  it("elides long out-of-tree paths on a segment boundary, keeping leading dots leading", () => {
    const long = "/home/user/very/deeply/nested/projects/area/.hidden-worktrees/some-feature-name";
    const entries = [
      entry({ path: MAIN, branch: "main", isMain: true }),
      entry({ path: long, branch: "some-feature-name" }),
    ];
    render(<WorktreeList entries={entries} mode="spawn" />);
    fireEvent.click(screen.getByTestId("worktree-chip-outOfTree"));
    const text = screen.getByTestId("worktree-list-spawn").textContent ?? "";
    expect(text).toContain("some-feature-name");
    // No relocated leading punctuation.
    expect(text).not.toMatch(/worktrees\/[\w-]*\./);
    // Elision falls on a segment boundary.
    const elided = text.match(/\/[^\s]*…[^\s]*/)?.[0] ?? "";
    expect(elided).toContain("/…/");
  });
});

// ── manage mode ────────────────────────────────────────────────────

describe("WorktreeList manage mode", () => {
  // test-plan #E10
  it("gives the main row no ✕ and no checkbox, and excludes it from select-all", () => {
    render(<WorktreeList entries={fixture()} mode="manage" />);
    const main = screen.getByTestId("worktree-row-main");
    expect(main.querySelector("input[type=checkbox]")).toBeNull();
    expect(main.textContent).not.toContain("✕");

    fireEvent.click(screen.getByTestId("worktree-select-all"));
    const checked = Array.from(
      document.querySelectorAll<HTMLInputElement>("[data-testid^='worktree-select-']"),
    ).filter((el) => el.type === "checkbox" && el.checked);
    expect(checked).toHaveLength(2); // feat-a + feat-b, never main
  });

  // test-plan #E12 — `missing` is `exists === false`, NEVER falsy: a new client
  // paired with an older server sees `undefined` on every row.
  it("treats exists tri-state correctly", () => {
    const entries = [
      entry({ path: MAIN, branch: "main", isMain: true }),
      entry({ path: `${MAIN}/.worktrees/present`, branch: "present", exists: true }),
      entry({ path: `${MAIN}/.worktrees/gone`, branch: "gone", exists: false }),
      entry({ path: `${MAIN}/.worktrees/unknown`, branch: "unknown" }), // exists absent
    ];
    render(<WorktreeList entries={entries} mode="manage" onPrune={() => {}} />);
    const id = (p: string) => encodeURIComponent(`${MAIN}/.worktrees/${p}`);

    expect(screen.getByTestId(`worktree-remove-${id("present")}`)).toBeTruthy();
    // Absent → treated as PRESENT, remove enabled.
    expect(screen.getByTestId(`worktree-remove-${id("unknown")}`)).toBeTruthy();

    // exists:false → no ✕, prune affordance instead, excluded from selection.
    expect(screen.queryByTestId(`worktree-remove-${id("gone")}`)).toBeNull();
    expect(screen.getByTestId(`worktree-prune-${id("gone")}`)).toBeTruthy();
    fireEvent.click(screen.getByTestId("worktree-select-all"));
    expect(screen.queryByTestId(`worktree-select-${id("gone")}`)).toBeNull();
  });

  // Review finding: a successful bulk removal must not leave ghost selections.
  it("drops selected paths that leave the entry list", () => {
    const base = [
      entry({ path: MAIN, branch: "main", isMain: true }),
      entry({ path: `${MAIN}/.worktrees/feat-a`, branch: "feat-a" }),
      entry({ path: `${MAIN}/.worktrees/feat-b`, branch: "feat-b" }),
    ];
    const onRemoveSelected = vi.fn();
    const { rerender } = render(
      <WorktreeList entries={base} mode="manage" onRemoveSelected={onRemoveSelected} />,
    );
    fireEvent.click(screen.getByTestId("worktree-select-all"));
    fireEvent.click(screen.getByTestId("worktree-remove-selected"));
    expect(onRemoveSelected.mock.calls[0][0]).toHaveLength(2);

    // feat-a is gone after the batch; the selection must shrink with it.
    rerender(
      <WorktreeList
        entries={base.filter((e) => !e.path.endsWith("feat-a"))}
        mode="manage"
        onRemoveSelected={onRemoveSelected}
      />,
    );
    fireEvent.click(screen.getByTestId("worktree-remove-selected"));
    const resent = onRemoveSelected.mock.calls[1][0] as string[];
    expect(resent).toEqual([`${MAIN}/.worktrees/feat-b`]);
    expect(resent).not.toContain(`${MAIN}/.worktrees/feat-a`);
  });

  // test-plan #F1 — interactive elements cannot legally nest in a <button>.
  it("uses a non-button row container with both controls as separate tab stops", () => {
    const entries = [
      entry({ path: MAIN, branch: "main", isMain: true }),
      entry({ path: `${MAIN}/.worktrees/feat-a`, branch: "feat-a" }),
    ];
    render(<WorktreeList entries={entries} mode="manage" onRemove={() => {}} />);
    const row = screen.getByTestId(`worktree-row-${encodeURIComponent(`${MAIN}/.worktrees/feat-a`)}`);
    expect(row.tagName).not.toBe("BUTTON");
    expect(row.closest("button")).toBeNull();

    const stops = Array.from(row.querySelectorAll("input, button"));
    expect(stops).toHaveLength(2);
    expect((stops[0] as HTMLInputElement).type).toBe("checkbox");
    expect(stops[1].tagName).toBe("BUTTON");
    for (const el of stops) expect(el.getAttribute("tabindex")).not.toBe("-1");
  });
});

// ── spawn mode ─────────────────────────────────────────────────────

describe("WorktreeList spawn mode", () => {
  // test-plan #F2
  it("fires onSpawn once on a whole-row click with no nested interactive element", () => {
    const onSpawn = vi.fn();
    const entries = [
      entry({ path: MAIN, branch: "main", isMain: true }),
      entry({ path: `${MAIN}/.worktrees/feat-a`, branch: "feat-a" }),
    ];
    render(<WorktreeList entries={entries} mode="spawn" onSpawn={onSpawn} />);
    const path = `${MAIN}/.worktrees/feat-a`;
    const row = screen.getByTestId(`worktree-row-${encodeURIComponent(path)}`);
    expect(row.tagName).toBe("BUTTON");
    expect(row.querySelector("button, input, a, select, textarea")).toBeNull();

    fireEvent.click(row);
    expect(onSpawn).toHaveBeenCalledTimes(1);
    expect(onSpawn.mock.calls[0][0]).toBe(path);
  });
});

// ── localisation ───────────────────────────────────────────────────

describe("WorktreeList localisation", () => {
  // test-plan #F11 — every new user-facing string resolves through i18nT.
  it("routes rendered strings through i18nT in both modes", async () => {
    const i18n = await import("../../lib/i18n/i18n.js");
    const spy = vi.spyOn(i18n, "t");
    // Re-import the component so the spy is in place for its module scope is
    // unnecessary — i18nT is called at RENDER time, so the spy catches it.
    for (const mode of ["spawn", "manage"] as const) {
      spy.mockClear();
      cleanup();
      render(<WorktreeList entries={fixture()} mode={mode} onPrune={() => {}} />);
      const rendered = screen.getByTestId(`worktree-list-${mode}`).textContent ?? "";
      const viaI18n = spy.mock.results.map((r) => String(r.value));
      // Every non-data string in the tree traces to an i18nT fallback.
      const literals = ["Filter worktrees", "detached", "out of tree", "of", "shown", "main"];
      for (const lit of literals) {
        expect(viaI18n.some((v) => v === lit), `${lit} via i18nT in ${mode}`).toBe(true);
      }
      if (mode === "manage") {
        for (const lit of ["Select all", "Delete branch too", "Remove worktree"]) {
          expect(viaI18n.some((v) => v === lit), `${lit} via i18nT`).toBe(true);
        }
      }
      expect(rendered.length).toBeGreaterThan(0);
    }
    spy.mockRestore();
  });
});

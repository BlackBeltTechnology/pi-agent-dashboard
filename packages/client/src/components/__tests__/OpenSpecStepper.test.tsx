import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { statusPresentation } from "@blackbelt-technology/pi-dashboard-client-utils/statusPresentation";

afterEach(() => cleanup());
import { OpenSpecStepper, deriveStepperState } from "../openspec/OpenSpecStepper.js";
import { ChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { OpenSpecChange, OpenSpecArtifact } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * 5-segment lifecycle bar (Proposal · Design · Specs · Tasks · Archive).
 * See change: compact-openspec-lifecycle-bar (test-plan E1–E5, E13, X2).
 */

const allDone: OpenSpecArtifact[] = [
  { id: "proposal", status: "done" },
  { id: "design", status: "done" },
  { id: "specs", status: "done" },
];

function makeChange(over: Partial<OpenSpecChange> = {}): OpenSpecChange {
  return {
    name: "add-auth",
    status: "in-progress",
    completedTasks: 12,
    totalTasks: 39,
    artifacts: allDone,
    ...over,
  };
}

const derive = (changeState: ChangeState | null, completedTasks: number, totalTasks: number, artifacts = allDone) =>
  deriveStepperState({ artifacts, completedTasks, totalTasks, changeState });

const countCurrent = (s: Record<string, string>) => Object.values(s).filter((v) => v === "current").length;

describe("deriveStepperState — Tasks/Archive decision table (E1)", () => {
  const taskCounts: Array<[number, number]> = [[0, 0], [0, 39], [12, 39], [39, 39]];
  const expected: Array<[ChangeState, string, string]> = [
    [ChangeState.PLANNING, "todo", "todo"],
    [ChangeState.READY, "current", "todo"],
    [ChangeState.IMPLEMENTING, "current", "todo"],
    [ChangeState.COMPLETE, "done", "current"],
  ];
  for (const [state, tasks, archive] of expected) {
    for (const [c, t] of taskCounts) {
      it(`${state} ${c}/${t} → tasks=${tasks}, archive=${archive}`, () => {
        const s = derive(state, c, t);
        expect(s.tasks).toBe(tasks);
        expect(s.archive).toBe(archive);
      });
    }
  }

  it("null changeState → all five segments todo", () => {
    const s = derive(null, 0, 0, []);
    expect(s).toEqual({ proposal: "todo", design: "todo", specs: "todo", tasks: "todo", archive: "todo" });
  });

  it("returns exactly the five segment keys", () => {
    expect(Object.keys(derive(ChangeState.IMPLEMENTING, 12, 39))).toEqual(["proposal", "design", "specs", "tasks", "archive"]);
  });
});

describe("deriveStepperState — artifact segment states (E2)", () => {
  const cases: Array<[OpenSpecArtifact["status"] | "absent", string]> = [
    ["done", "done"],
    ["skipped", "skipped"],
    ["ready", "current"],
    ["blocked", "todo"],
    ["absent", "todo"],
  ];
  for (const [status, expected] of cases) {
    it(`${status} → ${expected}`, () => {
      const artifacts: OpenSpecArtifact[] = status === "absent"
        ? []
        : (["proposal", "design", "specs"] as const).map((id) => ({ id, status: status as OpenSpecArtifact["status"] }));
      const s = derive(ChangeState.PLANNING, 0, 0, artifacts);
      expect(s.proposal).toBe(expected);
      expect(s.design).toBe(expected);
      expect(s.specs).toBe(expected);
    });
  }
});

describe("deriveStepperState — current-count invariant (E3)", () => {
  it.each([
    ["READY", ChangeState.READY, 0, 39],
    ["IMPLEMENTING 12/39", ChangeState.IMPLEMENTING, 12, 39],
    ["IMPLEMENTING 39/39", ChangeState.IMPLEMENTING, 39, 39],
    ["COMPLETE", ChangeState.COMPLETE, 39, 39],
  ] as const)("%s → exactly one current", (_l, state, c, t) => {
    expect(countCurrent(derive(state, c, t))).toBe(1);
  });

  it("PLANNING with design+specs ready → exactly design and specs current", () => {
    const s = derive(ChangeState.PLANNING, 0, 0, [
      { id: "proposal", status: "done" },
      { id: "design", status: "ready" },
      { id: "specs", status: "ready" },
    ]);
    expect(Object.entries(s).filter(([, v]) => v === "current").map(([k]) => k)).toEqual(["design", "specs"]);
  });
});

describe("OpenSpecStepper — Tasks label + fill (E4)", () => {
  const fillPct = (el: HTMLElement) => {
    const fill = el.querySelector<HTMLElement>("[data-testid='stepper-tasks-fill']");
    return fill ? parseFloat(fill.style.width) : null;
  };

  it("0 tasks → `Tasks —` rendered as an inert div", () => {
    render(<OpenSpecStepper change={makeChange({ completedTasks: 0, totalTasks: 0 })} onOpenTasks={() => {}} />);
    const seg = screen.getByTestId("stepper-segment-tasks");
    expect(seg.tagName).toBe("DIV");
    expect(seg.textContent).toContain("—");
  });

  it.each([
    [0, 1, 0],
    [12, 39, 31],
    [39, 39, 100],
  ])("%i/%i → fill %i%%", (c, t, pct) => {
    render(<OpenSpecStepper change={makeChange({ completedTasks: c, totalTasks: t })} />);
    const seg = screen.getByTestId("stepper-segment-tasks");
    expect(seg.textContent).toContain(`${c}/${t}`);
    expect(Math.abs((fillPct(seg) ?? -99) - pct)).toBeLessThanOrEqual(1);
  });
});

describe("OpenSpecStepper — skipped rendering (E5)", () => {
  it("specs skipped → data-state skipped, `–` glyph, done token", () => {
    render(<OpenSpecStepper change={makeChange({ artifacts: [...allDone.slice(0, 2), { id: "specs", status: "skipped" }] })} />);
    const seg = screen.getByTestId("stepper-segment-specs");
    expect(seg.getAttribute("data-state")).toBe("skipped");
    expect(seg.textContent).toContain("–");
    expect(seg.getAttribute("style") ?? "").toContain(statusPresentation("done").tokenVar);
  });
});

describe("OpenSpecStepper — accessible names + focusability (E13)", () => {
  it("group root, named segments, inert segments not focusable", () => {
    render(
      <OpenSpecStepper
        change={makeChange({ status: "in-progress", artifacts: [{ id: "proposal", status: "done" }, { id: "design", status: "ready" }] })}
        onReadArtifact={() => {}}
        onOpenTasks={() => {}}
      />,
    );
    const root = screen.getByTestId("openspec-stepper");
    expect(root.getAttribute("role")).toBe("group");
    expect(root.getAttribute("aria-label")).toBe("OpenSpec lifecycle");
    expect(screen.getByRole("button", { name: "Design, current" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tasks 12 of 39 done" })).toBeTruthy();
    const archive = screen.getByTestId("stepper-segment-archive");
    expect(archive.tagName).toBe("DIV");
    expect(archive.hasAttribute("tabindex")).toBe(false);
  });
});

describe("OpenSpecStepper — missing handlers (X2)", () => {
  it("compact bar without handlers → inert, no throw on click", () => {
    render(<OpenSpecStepper variant="compact" change={makeChange({ status: "complete", completedTasks: 39 })} />);
    const proposal = screen.getByTestId("stepper-segment-proposal");
    const archive = screen.getByTestId("stepper-segment-archive");
    expect(() => { fireEvent.click(proposal); fireEvent.click(archive); }).not.toThrow();
    expect(proposal.tagName).toBe("DIV");
    expect(archive.tagName).toBe("DIV");
  });

  it("onArchive defined → Archive segment is a button that fires it", () => {
    const onArchive = vi.fn();
    render(<OpenSpecStepper change={makeChange({ status: "complete", completedTasks: 39 })} onArchive={onArchive} />);
    const archive = screen.getByTestId("stepper-segment-archive");
    expect(archive.tagName).toBe("BUTTON");
    fireEvent.click(archive);
    expect(onArchive).toHaveBeenCalledTimes(1);
  });
});

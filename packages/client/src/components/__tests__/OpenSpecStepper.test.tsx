import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";

afterEach(() => cleanup());
import { OpenSpecStepper, deriveStepperState } from "../OpenSpecStepper.js";
import { ChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { OpenSpecChange, OpenSpecArtifact } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const allDoneArtifacts: OpenSpecArtifact[] = [
  { id: "proposal", status: "done" },
  { id: "design", status: "done" },
  { id: "specs", status: "done" },
];

function makeChange(over: Partial<OpenSpecChange> = {}): OpenSpecChange {
  return {
    name: "add-auth",
    status: "in-progress",
    completedTasks: 4,
    totalTasks: 12,
    artifacts: allDoneArtifacts,
    ...over,
  };
}

describe("deriveStepperState", () => {
  it("no proposal, no changes → Explore current, all others todo, Archive disabled", () => {
    const s = deriveStepperState({
      attached: null,
      artifacts: [],
      completedTasks: 0,
      totalTasks: 0,
      changeState: null,
      hasAnyChanges: false,
    });
    expect(s.explore).toBe("current");
    expect(s.proposal).toBe("todo");
    expect(s.design).toBe("todo");
    expect(s.specs).toBe("todo");
    expect(s.tasks).toBe("todo");
    expect(s.apply).toBe("todo");
    expect(s.archive).toBe("disabled");
  });

  it("no proposal but changes exist → Explore done", () => {
    const s = deriveStepperState({
      attached: null,
      artifacts: [],
      completedTasks: 0,
      totalTasks: 0,
      changeState: null,
      hasAnyChanges: true,
    });
    expect(s.explore).toBe("done");
  });

  it("IMPLEMENTING 4/12 with proposal+design+specs done → Specs done, Tasks current, Apply current", () => {
    const s = deriveStepperState({
      attached: "add-auth",
      artifacts: allDoneArtifacts,
      completedTasks: 4,
      totalTasks: 12,
      changeState: ChangeState.IMPLEMENTING,
      hasAnyChanges: true,
    });
    expect(s.explore).toBe("disabled");
    expect(s.proposal).toBe("done");
    expect(s.design).toBe("done");
    expect(s.specs).toBe("done");
    expect(s.tasks).toBe("current");
    expect(s.apply).toBe("current");
    expect(s.archive).toBe("todo");
  });

  it("COMPLETE with all tasks done → Apply done, Archive current", () => {
    const s = deriveStepperState({
      attached: "add-auth",
      artifacts: allDoneArtifacts,
      completedTasks: 12,
      totalTasks: 12,
      changeState: ChangeState.COMPLETE,
      hasAnyChanges: true,
    });
    expect(s.tasks).toBe("done");
    expect(s.apply).toBe("done");
    expect(s.archive).toBe("current");
  });

  it("READY (artifacts done, no task progress) → Apply current, Tasks todo", () => {
    const s = deriveStepperState({
      attached: "add-auth",
      artifacts: allDoneArtifacts,
      completedTasks: 0,
      totalTasks: 0,
      changeState: ChangeState.READY,
      hasAnyChanges: true,
    });
    expect(s.apply).toBe("current");
    expect(s.tasks).toBe("todo");
  });

  it("PLANNING with proposal ready, design blocked → proposal current, design todo", () => {
    const s = deriveStepperState({
      attached: "add-auth",
      artifacts: [
        { id: "proposal", status: "ready" },
        { id: "design", status: "blocked" },
      ],
      completedTasks: 0,
      totalTasks: 0,
      changeState: ChangeState.PLANNING,
      hasAnyChanges: true,
    });
    expect(s.proposal).toBe("current");
    expect(s.design).toBe("todo");
  });
});

describe("OpenSpecStepper render", () => {
  it("renders 7 nodes in sidebar variant with labels", () => {
    render(<OpenSpecStepper variant="sidebar" change={makeChange()} attached="add-auth" hasAnyChanges />);
    for (const id of ["explore", "proposal", "design", "specs", "tasks", "apply", "archive"]) {
      expect(screen.getByTestId(`stepper-node-${id}`)).toBeTruthy();
    }
    // Sidebar variant shows text labels
    expect(screen.getByText(/Explore/i)).toBeTruthy();
    expect(screen.getByText(/Archive/i)).toBeTruthy();
  });

  it("compact variant carries title attributes and no per-node text labels", () => {
    const { container } = render(<OpenSpecStepper variant="compact" change={makeChange()} attached="add-auth" hasAnyChanges />);
    const explore = screen.getByTestId("stepper-node-explore");
    expect(explore.getAttribute("title")).toBe("Explore");
    expect(explore.getAttribute("data-variant")).toBeNull(); // root carries variant
    expect(container.querySelector('[data-testid="openspec-stepper"][data-variant="compact"]')).toBeTruthy();
  });

  it("Tasks node shows N/M sub-label when totalTasks > 0", () => {
    render(<OpenSpecStepper variant="sidebar" change={makeChange({ completedTasks: 4, totalTasks: 12 })} attached="add-auth" hasAnyChanges />);
    expect(screen.getByText("4/12")).toBeTruthy();
  });

  it("Tasks sub-label hidden when totalTasks is zero", () => {
    render(<OpenSpecStepper variant="sidebar" change={makeChange({ completedTasks: 0, totalTasks: 0 })} attached="add-auth" hasAnyChanges />);
    expect(screen.queryByText(/^0\/0$/)).toBeNull();
  });

  it("opaque-base class applied to every node so connecting line cannot bleed through", () => {
    const { container } = render(<OpenSpecStepper variant="sidebar" change={makeChange()} attached="add-auth" hasAnyChanges />);
    const nodes = container.querySelectorAll(".openspec-stepper-node-base");
    expect(nodes.length).toBe(7);
  });
});

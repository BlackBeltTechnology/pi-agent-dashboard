/**
 * Component tests for OpenSpec group UI primitives.
 * See change: add-openspec-change-grouping (task 6.5).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

import { OpenSpecGroupSection } from "../openspec/OpenSpecGroupSection.js";
import { OpenSpecGroupPills } from "../openspec/OpenSpecGroupPills.js";
import { OpenSpecGroupPicker } from "../openspec/OpenSpecGroupPicker.js";
import type { OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

const groups: OpenSpecGroup[] = [
  { id: "ui", name: "UI", color: "#3b82f6", order: 0 },
  { id: "server", name: "Server", color: "#22c55e", order: 1 },
];

describe("OpenSpecGroupSection", () => {
  it("renders header with name, color swatch, and count", () => {
    render(
      <OpenSpecGroupSection name="UI" color="#3b82f6" count={3} expanded={false} onToggle={() => {}}>
        <div>body</div>
      </OpenSpecGroupSection>,
    );
    expect(screen.getByText("UI")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByTestId("group-color-swatch")).toBeTruthy();
    // Body not visible when collapsed
    expect(screen.queryByTestId("group-section-body")).toBeNull();
  });

  it("shows body when expanded", () => {
    render(
      <OpenSpecGroupSection name="UI" color="#3b82f6" count={3} expanded={true} onToggle={() => {}}>
        <div data-testid="inner">body</div>
      </OpenSpecGroupSection>,
    );
    expect(screen.getByTestId("group-section-body")).toBeTruthy();
    expect(screen.getByTestId("inner")).toBeTruthy();
  });

  it("calls onToggle when header clicked", () => {
    const onToggle = vi.fn();
    render(
      <OpenSpecGroupSection name="UI" color="#3b82f6" count={0} expanded={false} onToggle={onToggle}>
        <div />
      </OpenSpecGroupSection>,
    );
    fireEvent.click(screen.getByTestId("group-section-header"));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe("OpenSpecGroupPills", () => {
  it("returns null when no groups", () => {
    const { container } = render(
      <OpenSpecGroupPills groups={[]} activeGroupId={null} onSelect={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders All pill + group pills", () => {
    render(
      <OpenSpecGroupPills groups={groups} activeGroupId={null} onSelect={() => {}} />,
    );
    expect(screen.getByTestId("group-pill-all")).toBeTruthy();
    expect(screen.getByTestId("group-pill-ui")).toBeTruthy();
    expect(screen.getByTestId("group-pill-server")).toBeTruthy();
  });

  it("calls onSelect with null for All", () => {
    const onSelect = vi.fn();
    render(
      <OpenSpecGroupPills groups={groups} activeGroupId="ui" onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByTestId("group-pill-all"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("calls onSelect with group id", () => {
    const onSelect = vi.fn();
    render(
      <OpenSpecGroupPills groups={groups} activeGroupId={null} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByTestId("group-pill-server"));
    expect(onSelect).toHaveBeenCalledWith("server");
  });

  it("renders Manage groups link when handler provided", () => {
    const onManage = vi.fn();
    render(
      <OpenSpecGroupPills
        groups={groups}
        activeGroupId={null}
        onSelect={() => {}}
        onManageGroups={onManage}
      />,
    );
    fireEvent.click(screen.getByTestId("manage-groups-link"));
    expect(onManage).toHaveBeenCalledOnce();
  });
});

describe("OpenSpecGroupPicker", () => {
  it("renders trigger with current group name", () => {
    render(
      <OpenSpecGroupPicker groups={groups} currentGroupId="ui" onAssign={() => {}} />,
    );
    expect(screen.getByTestId("group-picker-trigger").textContent).toContain("UI");
  });

  it("renders 'Group' when no assignment", () => {
    render(
      <OpenSpecGroupPicker groups={groups} currentGroupId={null} onAssign={() => {}} />,
    );
    expect(screen.getByTestId("group-picker-trigger").textContent).toContain("Group");
  });

  it("opens dropdown and assigns on click", () => {
    const onAssign = vi.fn();
    render(
      <OpenSpecGroupPicker groups={groups} currentGroupId={null} onAssign={onAssign} />,
    );
    fireEvent.click(screen.getByTestId("group-picker-trigger"));
    expect(screen.getByTestId("group-picker-dropdown")).toBeTruthy();
    fireEvent.click(screen.getByTestId("group-option-server"));
    expect(onAssign).toHaveBeenCalledWith("server");
  });

  it("shows unassign option when assigned", () => {
    const onAssign = vi.fn();
    render(
      <OpenSpecGroupPicker groups={groups} currentGroupId="ui" onAssign={onAssign} />,
    );
    fireEvent.click(screen.getByTestId("group-picker-trigger"));
    fireEvent.click(screen.getByTestId("group-option-unassign"));
    expect(onAssign).toHaveBeenCalledWith(null);
  });

  it("shows create option when onCreateGroup provided", () => {
    render(
      <OpenSpecGroupPicker
        groups={groups}
        currentGroupId={null}
        onAssign={() => {}}
        onCreateGroup={async () => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId("group-picker-trigger"));
    expect(screen.getByTestId("group-option-create")).toBeTruthy();
  });
});

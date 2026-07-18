/**
 * Component tests for ArchiveBrowserView group integration.
 * See change: add-openspec-change-grouping (task 8.5).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("../../hooks/useArchiveListing.js", () => ({
  useArchiveListing: vi.fn(() => ({
    entries: [
      { name: "2026-01-15-add-auth", date: "2026-01-15", artifacts: [{ id: "proposal", status: "done" }] },
      { name: "2026-01-10-fix-bug", date: "2026-01-10", artifacts: [{ id: "proposal", status: "done" }] },
    ],
    isLoading: false,
    error: undefined,
  })),
  groupByDate: vi.fn((entries: any[]) => {
    const map = new Map<string, any[]>();
    for (const e of entries) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return Array.from(map.entries()).map(([date, items]) => ({ date, entries: items }));
  }),
  filterEntries: vi.fn((entries: any[], search: string) =>
    search ? entries.filter((e: any) => e.name.includes(search)) : entries,
  ),
}));

vi.mock("../../lib/openspec/openspec-groups-api.js", () => ({
  fetchGroups: vi.fn(async () => ({ schemaVersion: 1, groups: [], assignments: {} })),
}));

import { ArchiveBrowserView } from "../openspec/ArchiveBrowserView.js";
import type { OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

const groups: OpenSpecGroup[] = [
  { id: "auth", name: "Auth", color: "#3b82f6", order: 0 },
];
const assignments: Record<string, string> = {
  "2026-01-15-add-auth": "auth",
};

describe("ArchiveBrowserView — groups", () => {
  it("renders flat view with zero groups (today's behavior)", () => {
    render(<ArchiveBrowserView cwd="/project" onBack={vi.fn()} groups={[]} assignments={{}} />);
    expect(screen.queryByTestId("group-pills")).toBeNull();
    expect(screen.queryAllByTestId("archive-date-group").length).toBeGreaterThan(0);
  });

  it("renders group pills + sections when groups provided", () => {
    render(
      <ArchiveBrowserView cwd="/project" onBack={vi.fn()} groups={groups} assignments={assignments} />,
    );
    expect(screen.getByTestId("group-pills")).toBeTruthy();
    expect(screen.getByTestId("archive-group-auth")).toBeTruthy();
    expect(screen.getByTestId("archive-group-ungrouped")).toBeTruthy();
  });

  it("ungrouped section appears last", () => {
    const { container } = render(
      <ArchiveBrowserView cwd="/project" onBack={vi.fn()} groups={groups} assignments={assignments} />,
    );
    const sections = container.querySelectorAll("[data-testid^='archive-group-']");
    const lastSection = sections[sections.length - 1];
    expect(lastSection?.getAttribute("data-testid")).toBe("archive-group-ungrouped");
  });
});

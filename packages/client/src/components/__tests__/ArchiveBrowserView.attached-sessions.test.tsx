/**
 * ArchiveBrowserView reverse link: attached-session chips per entry.
 * See change: resolve-archived-attached-proposal (F9, F10).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { absentData, knownData, stubArchiveApi, withOpenSpecMap } from "../../test-support/attachmentHarness.js";

const ENTRIES = [
  { name: "2026-09-30-x", date: "2026-09-30", artifacts: [{ id: "proposal", status: "done" }] },
  { name: "2026-05-01-x", date: "2026-05-01", artifacts: [{ id: "proposal", status: "done" }] },
];
vi.mock("../../hooks/useArchiveListing.js", () => ({
  useArchiveListing: vi.fn(() => ({ entries: ENTRIES, isLoading: false, error: undefined })),
  groupByDate: (entries: any[]) => {
    const map = new Map<string, any[]>();
    for (const e of entries) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return Array.from(map.entries()).map(([date, items]) => ({ date, entries: items }));
  },
  filterEntries: (entries: any[]) => entries,
}));
vi.mock("../../lib/openspec/openspec-groups-api.js", () => ({
  fetchGroups: vi.fn(async () => ({ schemaVersion: 1, groups: [], assignments: {} })),
}));

import { ArchiveBrowserView } from "../openspec/ArchiveBrowserView.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const session = (id: string, over: Partial<DashboardSession>): DashboardSession =>
  ({ id, name: `sess-${id}`, cwd: "/repo", source: "tui", status: "ended", startedAt: new Date(2026, 8, 20).getTime(), attachedProposal: "x", ...over }) as DashboardSession;
const wt = (n: number) => ({ cwd: `/repo/.worktrees/os-x${n}`, gitWorktree: { mainPath: "/repo", name: `os-x${n}` } as never });

function mount(sessions: DashboardSession[], mem = memoryLocation({ path: "/", record: true })) {
  const map: Record<string, any> = { "/repo": knownData() };
  for (const s of sessions) if (s.cwd !== "/repo") map[s.cwd] = absentData();
  stubArchiveApi({});
  render(
    <Router hook={mem.hook}>
      {withOpenSpecMap(map, <ArchiveBrowserView cwd="/repo" onBack={vi.fn()} sessions={sessions} />)}
    </Router>,
  );
  return mem;
}

describe("ArchiveBrowserView attached-session chips", () => {
  it("F9 3 chips + +N on the resolved entry; none on the older same-name entry", async () => {
    mount([session("a", {}), session("b", wt(1)), session("c", wt(2)), session("d", wt(3)), session("e", wt(4))]);
    await screen.findAllByTestId("archive-session-chip");
    const rows = screen.getAllByTestId("archive-entry");
    const newer = rows.find((r) => r.textContent?.includes("x") && r.closest("[data-testid=archive-date-group]")?.textContent?.includes("2026-09-30"))!;
    const older = rows.find((r) => r.closest("[data-testid=archive-date-group]")?.textContent?.includes("2026-05-01"))!;
    expect(within(newer).getAllByTestId("archive-session-chip")).toHaveLength(3);
    expect(within(newer).getByTestId("archive-session-chip-more").textContent).toBe("+2");
    expect(within(older).queryAllByTestId("archive-session-chip")).toHaveLength(0);
  });

  it("F10 chip click navigates to the session and does not open the reader", async () => {
    const mem = mount([session("a", {})]);
    fireEvent.click(await screen.findByTestId("archive-session-chip"));
    expect(mem.history?.at(-1)).toBe("/session/a");
    expect(screen.getByTestId("archive-browser")).toBeTruthy();
  });

  it("a session in another folder gets no chip", async () => {
    mount([session("z", { cwd: "/elsewhere" })]);
    await Promise.resolve();
    expect(screen.queryAllByTestId("archive-session-chip")).toHaveLength(0);
  });
});

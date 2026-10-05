/**
 * ArchiveBrowserView deep-link reader + list-launched Back.
 * See change: resolve-archived-attached-proposal (E24, F12, X4).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ENTRIES = [
  { name: "2026-09-30-auth-flow", date: "2026-09-30", artifacts: [{ id: "proposal", status: "done" }, { id: "tasks", status: "done" }] },
  { name: "2026-09-01-other", date: "2026-09-01", artifacts: [{ id: "proposal", status: "done" }] },
];

vi.mock("../../hooks/useArchiveListing.js", () => ({
  useArchiveListing: vi.fn(() => ({ entries: ENTRIES, isLoading: false, error: undefined })),
  groupByDate: (entries: any[]) => {
    const map = new Map<string, any[]>();
    for (const e of entries) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return Array.from(map.entries()).map(([date, items]) => ({ date, entries: items }));
  },
  filterEntries: (entries: any[], q: string) => (q ? entries.filter((e) => e.name.includes(q)) : entries),
}));
vi.mock("../../lib/openspec/openspec-groups-api.js", () => ({
  fetchGroups: vi.fn(async () => ({ schemaVersion: 1, groups: [], assignments: {} })),
}));
const readerState = { content: "# Proposal body", isLoading: false, error: undefined as string | undefined, tabs: [{ id: "proposal", label: "Proposal" }], activeTab: "proposal" };
vi.mock("../../hooks/useOpenSpecReader.js", () => ({ useOpenSpecReader: vi.fn(() => readerState) }));

// MarkdownContent needs a ThemeProvider; the body is irrelevant here.
vi.mock("../preview/MarkdownContent.js", () => ({ MarkdownContent: ({ content }: { content: string }) => <div>{content}</div> }));

import { ArchiveBrowserView } from "../openspec/ArchiveBrowserView.js";

afterEach(() => { cleanup(); readerState.error = undefined; });

describe("ArchiveBrowserView deep link", () => {
  it("opens the named artifact's reader directly; Back calls onBack (history-back)", () => {
    const onBack = vi.fn();
    render(<ArchiveBrowserView cwd="/repo" onBack={onBack} deepLink={{ entry: "2026-09-30-auth-flow", artifact: "proposal" }} />);
    expect(screen.queryByTestId("archive-browser")).toBeNull();
    expect(screen.getByText("# Proposal body")).toBeTruthy();
    fireEvent.click(screen.getByTestId("preview-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("E24 unknown entry falls back to the list", () => {
    render(<ArchiveBrowserView cwd="/repo" onBack={vi.fn()} deepLink={{ entry: "2026-01-01-nope", artifact: "proposal" }} />);
    expect(screen.getByTestId("archive-browser")).toBeTruthy();
    expect(screen.queryByText("# Proposal body")).toBeNull();
  });

  it("E24 known entry but absent artifact falls back to the list", () => {
    render(<ArchiveBrowserView cwd="/repo" onBack={vi.fn()} deepLink={{ entry: "2026-09-30-auth-flow", artifact: "design" }} />);
    expect(screen.getByTestId("archive-browser")).toBeTruthy();
  });

  it("deep link without an artifact renders the list", () => {
    render(<ArchiveBrowserView cwd="/repo" onBack={vi.fn()} deepLink={{ entry: "2026-09-30-auth-flow" }} />);
    expect(screen.getByTestId("archive-browser")).toBeTruthy();
  });

  it("X4 reader error state (e.g. unknown cwd 403) renders without crashing; Back works", () => {
    readerState.error = "unknown cwd";
    const onBack = vi.fn();
    render(<ArchiveBrowserView cwd="/repo" onBack={onBack} deepLink={{ entry: "2026-09-30-auth-flow", artifact: "proposal" }} />);
    expect(screen.getByText(/unknown cwd/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("preview-back"));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("ArchiveBrowserView list-launched reader", () => {
  it("F12 Back from a list-launched reader returns to the list with the search retained", () => {
    const onBack = vi.fn();
    render(<ArchiveBrowserView cwd="/repo" onBack={onBack} />);
    fireEvent.change(screen.getByTestId("archive-search-input"), { target: { value: "auth" } });
    fireEvent.click(screen.getAllByTestId("archive-entry")[0]);
    expect(screen.queryByTestId("archive-browser")).toBeNull();
    fireEvent.click(screen.getByTestId("preview-back"));
    expect((screen.getByTestId("archive-search-input") as HTMLInputElement).value).toBe("auth");
    expect(onBack).not.toHaveBeenCalled();
  });
});

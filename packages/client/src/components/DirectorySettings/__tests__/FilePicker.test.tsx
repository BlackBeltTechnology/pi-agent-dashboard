import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePicker } from "../FilePicker.js";

const CANDIDATES = [
  { path: "/repo/AGENTS.md", relPath: "AGENTS.md" },
  { path: "/repo/docs/README.md", relPath: "docs/README.md" },
];

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true, data: { candidates: CANDIDATES } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FilePicker", () => {
  it("lists only the returned candidates", async () => {
    mockFetchOk();
    render(<FilePicker cwd="/repo" selectedPath={null} onSelect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("file-picker-item")).toHaveLength(2);
    });
    expect(screen.getByText("AGENTS.md")).toBeDefined();
    expect(screen.getByText("docs/README.md")).toBeDefined();
  });

  it("calls onSelect with the clicked candidate", async () => {
    mockFetchOk();
    const onSelect = vi.fn();
    render(<FilePicker cwd="/repo" selectedPath={null} onSelect={onSelect} />);
    const items = await screen.findAllByTestId("file-picker-item");
    fireEvent.click(items[0]);
    expect(onSelect).toHaveBeenCalledWith(CANDIDATES[0]);
  });

  it("directory scope hits md-candidates with a cwd query", async () => {
    const fetchMock = mockFetchOk();
    render(<FilePicker cwd="/repo" selectedPath={null} onSelect={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/file/md-candidates");
    expect(url).toContain("cwd=%2Frepo");
  });

  it("global scope omits the cwd query", async () => {
    const fetchMock = mockFetchOk();
    render(<FilePicker selectedPath={null} onSelect={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/file/md-candidates");
    expect(url).not.toContain("cwd=");
  });

  it("filters candidates by relPath substring", async () => {
    mockFetchOk();
    render(<FilePicker cwd="/repo" selectedPath={null} onSelect={vi.fn()} />);
    await screen.findAllByTestId("file-picker-item");
    fireEvent.change(screen.getByPlaceholderText("Filter…"), { target: { value: "docs" } });
    expect(screen.getAllByTestId("file-picker-item")).toHaveLength(1);
    expect(screen.getByText("docs/README.md")).toBeDefined();
  });
});

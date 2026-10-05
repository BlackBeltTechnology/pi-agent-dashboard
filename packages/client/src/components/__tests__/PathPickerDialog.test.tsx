import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PathPickerDialog } from "../primitives/PathPickerDialog.js";

const mockBrowse = vi.fn();
const mockClassify = vi.fn();
vi.mock("../../lib/api/browse-api.js", () => ({
  browseDirectory: (...args: unknown[]) => mockBrowse(...args),
  classifyPaths: (...args: unknown[]) => mockClassify(...args),
}));

afterEach(() => cleanup());

describe("PathPickerDialog (ui:path-picker host wrapper)", () => {
  const onSelect = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowse.mockResolvedValue({
      current: "/r",
      parent: "/",
      entries: [
        { name: "docs", path: "/r/docs" },
        { name: "README.md", path: "/r/README.md" },
      ],
    });
    mockClassify.mockResolvedValue({});
  });

  const renderDialog = () => render(<PathPickerDialog open onSelect={onSelect} onCancel={onCancel} />);
  const typePath = async (value: string) => {
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy());
    fireEvent.change(screen.getByRole("textbox"), { target: { value } });
  };

  it("selection: confirm /r/docs calls onSelect once with the path", async () => {
    renderDialog();
    await typePath("/r/docs");
    fireEvent.click(screen.getByText("Select"));
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect).toHaveBeenCalledWith("/r/docs");
  });

  it("cancel button and Escape call onCancel, never onSelect", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy());
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("non-directory: browse rejects → inline error, no onSelect", async () => {
    renderDialog();
    await typePath("/r/README.md");
    // the picker lists /r (resolves); verifying the confirmed FILE path rejects
    mockBrowse.mockImplementation(async (p?: string) => {
      if (p === "/r/README.md") throw new Error("not a directory");
      return { current: "/r", parent: "/", entries: [{ name: "README.md", path: "/r/README.md" }] };
    });
    fireEvent.click(screen.getByText("Select"));
    await waitFor(() => expect(screen.getByTestId("path-picker-error")).toBeTruthy());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<PathPickerDialog open={false} onSelect={onSelect} onCancel={onCancel} />);
    expect(container.innerHTML).toBe("");
  });
});

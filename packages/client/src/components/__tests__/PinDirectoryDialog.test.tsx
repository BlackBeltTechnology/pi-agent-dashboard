import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import { PinDirectoryDialog } from "../workspace/PinDirectoryDialog.js";

// Mock browse-api
const mockBrowse = vi.fn();
const mockClassify = vi.fn();
vi.mock("../../lib/api/browse-api.js", () => ({
  browseDirectory: (...args: unknown[]) => mockBrowse(...args),
  classifyPaths: (...args: unknown[]) => mockClassify(...args),
}));

afterEach(() => cleanup());

describe("PinDirectoryDialog", () => {
  const onPin = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // change: split-browse-flags — server omits isGit/isPi from the
    // initial response; the picker fills them via classifyPaths.
    mockBrowse.mockResolvedValue({
      current: "/Users/robson",
      parent: "/Users",
      entries: [
        { name: "Project", path: "/Users/robson/Project" },
      ],
    });
    mockClassify.mockResolvedValue({});
  });

  function renderDialog() {
    return render(<PinDirectoryDialog onPin={onPin} onCancel={onCancel} />);
  }

  it("should render title and PathPicker", async () => {
    renderDialog();
    expect(screen.getByText("Pin Directory")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeTruthy();
    });
  });

  it("should call onCancel when Cancel button clicked", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy());
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("should call onCancel when Escape pressed", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy());
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("should call onPin when Enter pressed with a path", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy());

    const input = screen.getByRole("textbox") as HTMLInputElement;
    // No trailing slash: partial="Project", which matches the mocked entry
    // name and satisfies PathPicker.tryConfirm Rule 1 (exact match).
    fireEvent.change(input, { target: { value: "/Users/robson/Project" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onPin).toHaveBeenCalledWith("/Users/robson/Project"));
  });

  it("should call onPin when Select button clicked", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy());

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/Users/robson/Project" } });
    fireEvent.click(screen.getByText("Select"));
    await waitFor(() => expect(onPin).toHaveBeenCalledWith("/Users/robson/Project"));
  });
});

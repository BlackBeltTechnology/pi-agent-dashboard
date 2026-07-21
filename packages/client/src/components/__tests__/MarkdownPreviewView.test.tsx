import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { MarkdownPreviewView } from "../preview/MarkdownPreviewView.js";

// Mock MarkdownContent to avoid full markdown rendering in tests
vi.mock("../preview/MarkdownContent.js", () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="mock-markdown">{content}</div>
  ),
}));

afterEach(() => cleanup());

describe("MarkdownPreviewView", () => {
  it("renders content via MarkdownContent", () => {
    render(<MarkdownPreviewView content="# Hello" onBack={() => {}} />);
    expect(screen.getByTestId("mock-markdown").textContent).toBe("# Hello");
  });

  it("renders title when provided", () => {
    render(<MarkdownPreviewView title="My Doc" content="text" onBack={() => {}} />);
    expect(screen.getByText("My Doc")).toBeTruthy();
  });

  it("calls onBack when back button is clicked", () => {
    const onBack = vi.fn();
    render(<MarkdownPreviewView content="text" onBack={onBack} />);
    fireEvent.click(screen.getByTestId("preview-back"));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows loading indicator when isLoading is true", () => {
    render(<MarkdownPreviewView isLoading onBack={() => {}} />);
    expect(screen.getByTestId("preview-loading")).toBeTruthy();
    expect(screen.queryByTestId("mock-markdown")).toBeNull();
  });

  it("shows error message when error is set", () => {
    render(<MarkdownPreviewView error="Something went wrong" onBack={() => {}} />);
    expect(screen.getByTestId("preview-error").textContent).toBe("Something went wrong");
    expect(screen.queryByTestId("mock-markdown")).toBeNull();
  });

  it("renders tab bar with tabs", () => {
    const tabs = [
      { id: "proposal", label: "P" },
      { id: "design", label: "D" },
    ];
    render(<MarkdownPreviewView content="text" tabs={tabs} activeTab="proposal" onBack={() => {}} />);
    expect(screen.getByTestId("preview-tabs")).toBeTruthy();
    expect(screen.getByTestId("preview-tab-proposal")).toBeTruthy();
    expect(screen.getByTestId("preview-tab-design")).toBeTruthy();
  });

  it("calls onTabChange when a tab is clicked", () => {
    const onTabChange = vi.fn();
    const tabs = [
      { id: "proposal", label: "P" },
      { id: "design", label: "D" },
    ];
    render(
      <MarkdownPreviewView
        content="text"
        tabs={tabs}
        activeTab="proposal"
        onTabChange={onTabChange}
        onBack={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId("preview-tab-design"));
    expect(onTabChange).toHaveBeenCalledWith("design");
  });

  it("does not render tab bar when no tabs provided", () => {
    render(<MarkdownPreviewView content="text" onBack={() => {}} />);
    expect(screen.queryByTestId("preview-tabs")).toBeNull();
  });
});

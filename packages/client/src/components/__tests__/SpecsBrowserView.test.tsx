import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { SpecsBrowserView } from "../openspec/SpecsBrowserView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

// Mock useMainSpecsReader
vi.mock("../../hooks/useMainSpecsReader.js", () => ({
  useMainSpecsReader: vi.fn(),
}));

import { useMainSpecsReader } from "../../hooks/useMainSpecsReader.js";
const mockUseMainSpecsReader = vi.mocked(useMainSpecsReader);

describe("SpecsBrowserView", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false, media: query, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders loading state", () => {
    mockUseMainSpecsReader.mockReturnValue({
      specNames: [],
      content: undefined,
      isLoading: true,
      error: undefined,
    });

    render(<Wrapper><SpecsBrowserView cwd="/project" onBack={vi.fn()} /></Wrapper>);
    expect(screen.getByTestId("preview-loading")).toBeDefined();
  });

  it("renders combobox with spec names", () => {
    mockUseMainSpecsReader.mockReturnValue({
      specNames: ["auth", "billing", "chat"],
      content: "# auth\n\nAuth content\n\n---\n\n# billing\n\nBilling content",
      isLoading: false,
      error: undefined,
    });

    render(<Wrapper><SpecsBrowserView cwd="/project" onBack={vi.fn()} /></Wrapper>);
    const combobox = screen.getByTestId("specs-browser-combobox") as HTMLSelectElement;
    expect(combobox).toBeDefined();
    // 3 specs + 1 placeholder
    expect(combobox.options.length).toBe(4);
    expect(combobox.options[1].value).toBe("auth");
    expect(combobox.options[2].value).toBe("billing");
    expect(combobox.options[3].value).toBe("chat");
  });

  it("scrolls to spec on combobox select", () => {
    mockUseMainSpecsReader.mockReturnValue({
      specNames: ["auth", "billing"],
      content: "# auth\n\nAuth content",
      isLoading: false,
      error: undefined,
    });

    // Create a mock element in the DOM
    const anchor = document.createElement("div");
    anchor.id = "spec-billing";
    document.body.appendChild(anchor);

    render(<Wrapper><SpecsBrowserView cwd="/project" onBack={vi.fn()} /></Wrapper>);
    const combobox = screen.getByTestId("specs-browser-combobox");
    fireEvent.change(combobox, { target: { value: "billing" } });

    expect(anchor.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });

    document.body.removeChild(anchor);
  });

  it("calls onBack when back button clicked", () => {
    mockUseMainSpecsReader.mockReturnValue({
      specNames: ["auth"],
      content: "# auth\n\nContent",
      isLoading: false,
      error: undefined,
    });

    const onBack = vi.fn();
    render(<Wrapper><SpecsBrowserView cwd="/project" onBack={onBack} /></Wrapper>);
    fireEvent.click(screen.getByTestId("preview-back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("shows spec count", () => {
    mockUseMainSpecsReader.mockReturnValue({
      specNames: ["auth", "billing", "chat"],
      content: "content",
      isLoading: false,
      error: undefined,
    });

    render(<Wrapper><SpecsBrowserView cwd="/project" onBack={vi.fn()} /></Wrapper>);
    expect(screen.getByText("3 specs")).toBeDefined();
  });

  it("hides combobox during loading", () => {
    mockUseMainSpecsReader.mockReturnValue({
      specNames: [],
      content: undefined,
      isLoading: true,
      error: undefined,
    });

    render(<Wrapper><SpecsBrowserView cwd="/project" onBack={vi.fn()} /></Wrapper>);
    expect(screen.queryByTestId("specs-browser-combobox")).toBeNull();
  });

  it("renders search bar (searchable enabled)", () => {
    mockUseMainSpecsReader.mockReturnValue({
      specNames: ["auth"],
      content: "# auth\n\nContent",
      isLoading: false,
      error: undefined,
    });

    render(<Wrapper><SpecsBrowserView cwd="/project" onBack={vi.fn()} /></Wrapper>);
    expect(screen.getByTestId("markdown-search")).toBeDefined();
  });
});

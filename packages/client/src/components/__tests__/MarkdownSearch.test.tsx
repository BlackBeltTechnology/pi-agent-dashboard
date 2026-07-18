import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import React, { useRef } from "react";
import { MarkdownSearch } from "../preview/MarkdownSearch.js";

// Helper: render MarkdownSearch with a content container that has HTML content
function TestHarness({ html, content }: { html: string; content?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <MarkdownSearch contentRef={ref} content={content ?? html} />
      <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

describe("MarkdownSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders search input", async () => {
    render(<TestHarness html="<p>Hello world</p>" />);
    await act(() => vi.advanceTimersByTime(150));
    expect(screen.getByTestId("markdown-search-input")).toBeDefined();
  });

  it("shows match counter when searching", async () => {
    render(<TestHarness html="<p>Hello world</p><p>Hello again</p>" />);
    await act(() => vi.advanceTimersByTime(150));

    const input = screen.getByTestId("markdown-search-input");
    fireEvent.change(input, { target: { value: "Hello" } });

    const counter = screen.getByTestId("markdown-search-counter");
    expect(counter.textContent).toContain("/");
  });

  it("uses exact match when substring found, fuzzy only as fallback", async () => {
    render(<TestHarness html="<p>authentication system</p><p>authorization layer</p>" />);
    await act(() => vi.advanceTimersByTime(150));

    const input = screen.getByTestId("markdown-search-input");
    // Exact substring — should match only "authentication"
    fireEvent.change(input, { target: { value: "authentication" } });
    const counter = screen.getByTestId("markdown-search-counter");
    // Should find exactly 1 match (exact), not fuzzy-match "authorization" too
    expect(counter.textContent).toMatch(/^1\/1$/);
  });

  it("shows 0 results for non-matching query", async () => {
    render(<TestHarness html="<p>Hello world</p>" />);
    await act(() => vi.advanceTimersByTime(150));

    const input = screen.getByTestId("markdown-search-input");
    fireEvent.change(input, { target: { value: "xyznonexistent" } });

    const counter = screen.getByTestId("markdown-search-counter");
    expect(counter.textContent).toBe("0 results");
  });

  it("clears highlights and hides controls when search is cleared", async () => {
    render(<TestHarness html="<p>Hello world</p>" />);
    await act(() => vi.advanceTimersByTime(150));

    const input = screen.getByTestId("markdown-search-input");
    fireEvent.change(input, { target: { value: "Hello" } });
    expect(screen.getByTestId("markdown-search-counter")).toBeDefined();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByTestId("markdown-search-counter")).toBeNull();
  });

  it("navigates to next match with next button", async () => {
    render(<TestHarness html="<p>Hello world</p><p>Hello again</p><p>Hello there</p>" />);
    await act(() => vi.advanceTimersByTime(150));

    const input = screen.getByTestId("markdown-search-input");
    fireEvent.change(input, { target: { value: "Hello" } });

    const counter = screen.getByTestId("markdown-search-counter");
    // Should start at match 1
    expect(counter.textContent).toMatch(/^1\//);

    // Click next
    fireEvent.click(screen.getByTestId("markdown-search-next"));
    expect(counter.textContent).toMatch(/^2\//);
  });

  it("navigates to previous match with prev button", async () => {
    render(<TestHarness html="<p>Hello world</p><p>Hello again</p>" />);
    await act(() => vi.advanceTimersByTime(150));

    const input = screen.getByTestId("markdown-search-input");
    fireEvent.change(input, { target: { value: "Hello" } });

    const counter = screen.getByTestId("markdown-search-counter");
    expect(counter.textContent).toMatch(/^1\//);

    // Click prev — should wrap to last
    fireEvent.click(screen.getByTestId("markdown-search-prev"));
    expect(counter.textContent).toMatch(/^2\//);
  });

  it("wraps around when navigating past last match", async () => {
    render(<TestHarness html="<p>Hello world</p><p>Hello again</p>" />);
    await act(() => vi.advanceTimersByTime(150));

    const input = screen.getByTestId("markdown-search-input");
    fireEvent.change(input, { target: { value: "Hello" } });

    const counter = screen.getByTestId("markdown-search-counter");
    // Navigate to last
    fireEvent.click(screen.getByTestId("markdown-search-next"));
    expect(counter.textContent).toMatch(/^2\//);

    // Next should wrap to 1
    fireEvent.click(screen.getByTestId("markdown-search-next"));
    expect(counter.textContent).toMatch(/^1\//);
  });

  it("Enter key navigates to next, Shift+Enter to previous", async () => {
    render(<TestHarness html="<p>Hello world</p><p>Hello again</p><p>Hello there</p>" />);
    await act(() => vi.advanceTimersByTime(150));

    const input = screen.getByTestId("markdown-search-input");
    fireEvent.change(input, { target: { value: "Hello" } });

    const counter = screen.getByTestId("markdown-search-counter");

    // Enter → next
    fireEvent.keyDown(input, { key: "Enter" });
    expect(counter.textContent).toMatch(/^2\//);

    // Shift+Enter → prev
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(counter.textContent).toMatch(/^1\//);
  });

  it("Escape key clears search", async () => {
    render(<TestHarness html="<p>Hello world</p>" />);
    await act(() => vi.advanceTimersByTime(150));

    const input = screen.getByTestId("markdown-search-input");
    fireEvent.change(input, { target: { value: "Hello" } });
    expect(screen.getByTestId("markdown-search-counter")).toBeDefined();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("markdown-search-counter")).toBeNull();
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("clear button removes search and highlights", async () => {
    render(<TestHarness html="<p>Hello world</p>" />);
    await act(() => vi.advanceTimersByTime(150));

    const input = screen.getByTestId("markdown-search-input");
    fireEvent.change(input, { target: { value: "Hello" } });
    expect(screen.getByTestId("markdown-search-clear")).toBeDefined();

    fireEvent.click(screen.getByTestId("markdown-search-clear"));
    expect(screen.queryByTestId("markdown-search-counter")).toBeNull();
  });
});

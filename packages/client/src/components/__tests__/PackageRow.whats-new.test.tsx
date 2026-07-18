/**
 * Tests for the breaking-change icon affordance added to `PackageRow`.
 *
 * See change: pi-update-whats-new-panel.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PackageRow } from "../packages/PackageRow.js";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

const baseProps = {
  displayName: "pi (core agent)",
  source: "@mariozechner/pi-coding-agent",
  sourceType: "global" as const,
  currentVersion: "0.62.0",
  latestVersion: "0.70.0",
  updateAvailable: true,
  canUpdate: true,
  testId: "row",
};

describe("PackageRow what's-new icon", () => {
  afterEach(() => cleanup());

  it("does not render the icon when whatsNewKind is undefined", () => {
    render(<PackageRow {...baseProps} onUpdate={() => {}} />);
    expect(screen.queryByTestId("row-whats-new")).toBeNull();
  });

  it("does not render the icon when onShowWhatsNew is missing", () => {
    render(
      <PackageRow {...baseProps} onUpdate={() => {}} whatsNewKind="breaking" />,
    );
    expect(screen.queryByTestId("row-whats-new")).toBeNull();
  });

  it("regression: count={0} (legacy prop) without whatsNewKind hides icon and renders no stray '0'", () => {
    // Previously, `{breakingChangeCount && breakingChangeCount > 0 && …}`
    // rendered the literal number `0` as a text node when count was 0.
    // The fix replaced the predicate with `whatsNewKind`. Verify that a
    // row with `breakingChangeCount={0}` and no `whatsNewKind` renders
    // no stray text node containing exactly "0".
    const { container } = render(
      <PackageRow
        {...baseProps}
        onUpdate={() => {}}
        breakingChangeCount={0}
        onShowWhatsNew={() => {}}
      />,
    );
    expect(screen.queryByTestId("row-whats-new")).toBeNull();
    const stray = Array.from(container.querySelectorAll("*")).find(
      (el) => el.children.length === 0 && el.textContent === "0",
    );
    expect(stray).toBeUndefined();
  });

  it("renders breaking icon (amber) with count tooltip when whatsNewKind=breaking", () => {
    render(
      <PackageRow
        {...baseProps}
        onUpdate={() => {}}
        whatsNewKind="breaking"
        breakingChangeCount={5}
        onShowWhatsNew={() => {}}
      />,
    );
    const btn = screen.getByTestId("row-whats-new");
    expect(btn.className).toContain("text-amber");
    expect(btn.getAttribute("title")).toMatch(/5 breaking changes/);
    expect(btn.getAttribute("aria-label")).toMatch(/Breaking changes/);
  });

  it("uses singular tooltip text when breaking count is 1", () => {
    render(
      <PackageRow
        {...baseProps}
        onUpdate={() => {}}
        whatsNewKind="breaking"
        breakingChangeCount={1}
        onShowWhatsNew={() => {}}
      />,
    );
    expect(screen.getByTestId("row-whats-new").getAttribute("title")).toMatch(
      /1 breaking change since/,
    );
  });

  it("renders info icon (muted) with neutral tooltip when whatsNewKind=info", () => {
    render(
      <PackageRow
        {...baseProps}
        onUpdate={() => {}}
        whatsNewKind="info"
        onShowWhatsNew={() => {}}
      />,
    );
    const btn = screen.getByTestId("row-whats-new");
    expect(btn.className).toContain("text-[var(--text-muted)]");
    expect(btn.getAttribute("title")).toBe("View what's new");
    expect(btn.getAttribute("aria-label")).toMatch(/View what's new/);
  });

  it("info icon does NOT need breakingChangeCount", () => {
    render(
      <PackageRow
        {...baseProps}
        onUpdate={() => {}}
        whatsNewKind="info"
        onShowWhatsNew={() => {}}
      />,
    );
    expect(screen.getByTestId("row-whats-new")).toBeTruthy();
  });

  it("click invokes onShowWhatsNew (both states)", () => {
    const breakingClick = vi.fn();
    const { rerender } = render(
      <PackageRow
        {...baseProps}
        onUpdate={() => {}}
        whatsNewKind="breaking"
        breakingChangeCount={2}
        onShowWhatsNew={breakingClick}
      />,
    );
    fireEvent.click(screen.getByTestId("row-whats-new"));
    expect(breakingClick).toHaveBeenCalledTimes(1);

    const infoClick = vi.fn();
    rerender(
      <PackageRow
        {...baseProps}
        onUpdate={() => {}}
        whatsNewKind="info"
        onShowWhatsNew={infoClick}
      />,
    );
    fireEvent.click(screen.getByTestId("row-whats-new"));
    expect(infoClick).toHaveBeenCalledTimes(1);
  });

  it("Update button still renders alongside the icon (both states)", () => {
    const onUpdate = vi.fn();
    render(
      <PackageRow
        {...baseProps}
        onUpdate={onUpdate}
        whatsNewKind="info"
        onShowWhatsNew={() => {}}
      />,
    );
    expect(screen.getByTestId("row-whats-new")).toBeTruthy();
    expect(screen.getByTestId("row-update")).toBeTruthy();
    fireEvent.click(screen.getByTestId("row-update"));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});

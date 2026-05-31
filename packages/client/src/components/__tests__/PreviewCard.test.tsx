/**
 * Tests for PreviewCard + ChatView integration of `view`-bearing messages.
 * See change: render-file-previews.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import React from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ChatView } from "../ChatView.js";
import { ThemeProvider } from "../ThemeProvider.js";
import { PreviewCard } from "../PreviewCard.js";
import { createInitialState } from "../../lib/event-reducer.js";
import type { ToolContext } from "../tool-renderers/index.js";
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const defaultToolContext: ToolContext = { editors: [] };

afterEach(() => cleanup());

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

function wrap(ui: React.ReactNode, opts?: { path?: string }) {
  const { hook, navigate } = memoryLocation({ path: opts?.path ?? "/", record: true });
  const result = render(
    <ThemeProvider>
      <Router hook={hook}>{ui}</Router>
    </ThemeProvider>,
  );
  return { ...result, navigate };
}

describe("PreviewCard", () => {
  it("dispatches markdown renderer for .md files", () => {
    const target: ViewTarget = { kind: "file", cwd: "/x", path: "README.md" };
    const { getByTestId } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("markdown");
  });

  it("dispatches pdf renderer for .pdf files", () => {
    const target: ViewTarget = { kind: "file", cwd: "/x", path: "doc.pdf" };
    const { getByTestId } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("pdf");
  });

  it("dispatches youtube renderer for youtu.be URLs", () => {
    const target: ViewTarget = { kind: "url", url: "https://youtu.be/abc123" };
    const { getByTestId } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("youtube");
  });

  it("dispatches image renderer for .png files", () => {
    const target: ViewTarget = { kind: "file", cwd: "/x", path: "pic.png" };
    const { getByTestId } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("image");
  });

  it("dispatches video renderer for .mp4 files", () => {
    const target: ViewTarget = { kind: "file", cwd: "/x", path: "clip.mp4" };
    const { getByTestId } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("video");
  });

  it("dispatches fallback for unknown extension", () => {
    const target: ViewTarget = { kind: "file", cwd: "/x", path: "blob.dat" };
    const { getByTestId } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("fallback");
  });

  it("expand button navigates to file-view overlay route", () => {
    const target: ViewTarget = { kind: "file", cwd: "/home/u/proj", path: "doc.md" };
    const loc = memoryLocation({ path: "/", record: true }) as any;
    const { getByTestId } = render(
      <ThemeProvider>
        <Router hook={loc.hook}>
          <PreviewCard target={target} />
        </Router>
      </ThemeProvider>,
    );
    act(() => {
      fireEvent.click(getByTestId("preview-expand"));
    });
    const last = loc.history[loc.history.length - 1];
    expect(last).toMatch(/^\/folder\/[^/]+\/view\?path=doc\.md$/);
  });

  it("expand button navigates to /pi-view for URL targets", () => {
    const target: ViewTarget = { kind: "url", url: "https://youtu.be/xyz" };
    const loc = memoryLocation({ path: "/", record: true }) as any;
    const { getByTestId } = render(
      <ThemeProvider>
        <Router hook={loc.hook}>
          <PreviewCard target={target} />
        </Router>
      </ThemeProvider>,
    );
    act(() => {
      fireEvent.click(getByTestId("preview-expand"));
    });
    const last = loc.history[loc.history.length - 1];
    expect(last).toBe("/pi-view?url=https%3A%2F%2Fyoutu.be%2Fxyz");
  });
});

describe("ChatView — view-bearing messages", () => {
  it("renders a PreviewCard for a view-bearing user message instead of the default bubble", () => {
    const state = createInitialState();
    state.messages.push({
      id: "v-1",
      role: "user",
      content: "",
      timestamp: Date.now(),
      view: { kind: "file", cwd: "/x", path: "README.md" },
    });
    const { hook } = memoryLocation({ path: "/", record: true });
    const { getByTestId, container } = render(
      <ThemeProvider>
        <Router hook={hook}>
          <ChatView state={state} toolContext={defaultToolContext} />
        </Router>
      </ThemeProvider>,
    );
    expect(getByTestId("preview-card")).toBeTruthy();
    // The default user blue bubble class is `bg-blue-500/10` — must NOT appear.
    expect(container.querySelector(".bg-blue-500\\/10")).toBeNull();
  });
});

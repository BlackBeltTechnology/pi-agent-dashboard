import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { ToolCallStep } from "../ToolCallStep.js";
import { ThemeProvider } from "../ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

vi.mock("../../hooks/useMobile.js", () => ({
  useMobile: () => false,
  MobileProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ctx: ToolContext = { editors: [], sessionId: "sess-1" };

function renderStub(props: Partial<React.ComponentProps<typeof ToolCallStep>> = {}) {
  return render(
    <ThemeProvider>
      <ToolCallStep
        toolName="bash"
        toolCallId="tc-1"
        status="complete"
        result="PREVIEW-first-200-chars"
        context={ctx}
        stub={{ byteSize: 37 * 1024, entryId: "entry-9" }}
        {...props}
      />
    </ThemeProvider>,
  );
}

function mockFetchJson(impl: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => {
    const body = await impl();
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      json: async () => body,
    } as unknown as Response;
  }));
}

function expandCard(container: HTMLElement) {
  // The first button is the card header toggle (summary + chevron).
  fireEvent.click(container.querySelector("button")!);
}

describe("ToolCallStep — Strategy B stub lazy-expand", () => {
  it("renders the preview + 'Show full output (N KB)' affordance", () => {
    const { getByText, container } = renderStub();
    expandCard(container);
    expect(getByText(/PREVIEW-first-200-chars/)).toBeTruthy();
    expect(getByText(/Show full output \(37 KB\)/)).toBeTruthy();
  });

  it("fetches and renders the full untruncated body on expand", async () => {
    const fullBody = "FULL-".repeat(2000);
    mockFetchJson(async () => ({ success: true, data: { result: fullBody } }));
    const { getByText, queryByText, container } = renderStub();
    expandCard(container);

    fireEvent.click(getByText(/Show full output/));
    await waitFor(() => {
      expect(getByText(new RegExp("FULL-FULL-FULL"))).toBeTruthy();
    });
    // Affordance gone once the full body is loaded.
    expect(queryByText(/Show full output/)).toBeNull();
  });

  it("keeps the preview and offers a retry when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { get: () => "application/json" },
      json: async () => ({ success: false }),
      body: null,
    } as unknown as Response)));

    const { getByText, container } = renderStub();
    expandCard(container);
    fireEvent.click(getByText(/Show full output/));
    await waitFor(() => {
      expect(getByText(/Retry — load full output/)).toBeTruthy();
    });
    // Preview still visible — never an empty card.
    expect(getByText(/PREVIEW-first-200-chars/)).toBeTruthy();
  });
});

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePreviewHost, FilePreviewProvider, useFilePreview } from "../FilePreviewContext.js";
import { ThemeProvider } from "../ThemeProvider.js";
import { FileLink } from "../tool-renderers/FileLink.js";
import type { ToolContext } from "../tool-renderers/types.js";

const originalLocation = window.location;
function setHost(host: string) {
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, hostname: host },
    writable: true,
  });
}
function restoreHost() {
  Object.defineProperty(window, "location", { value: originalLocation, writable: true });
}

const remoteCtx: ToolContext = { cwd: "/repo" };

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

function okFileFetch() {
  // Route the lazy resolve endpoint (echo the mention back as the resolved
  // path) so the click's resolve round-trip opens the overlay; every other
  // call (the overlay's `/api/file` GET) returns empty file content.
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes("/api/file/resolve-mention")) {
      const mention = init?.body ? JSON.parse(init.body).mention : "";
      return new Response(
        JSON.stringify({ success: true, data: { resolved: mention, kind: "relative" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ) as any;
    }
    return new Response(JSON.stringify({ success: true, data: { type: "file", content: "" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }) as any;
  });
}

/**
 * Minimal harness mirroring ChatView's structure: provider above a churning
 * "message list" plus a single host. `remountKey` is bumped to force the
 * FileLink subtree to remount (simulating react-markdown reparse /
 * streaming→committed branch swap / new message reconciliation).
 */
function Harness({ filePath = "src/foo.ts" }: { filePath?: string }) {
  const [remountKey, setRemountKey] = useState(0);
  return (
    <ThemeProvider>
      <FilePreviewProvider>
        <button type="button" data-testid="churn" onClick={() => setRemountKey((k) => k + 1)}>
          churn
        </button>
        <div key={remountKey}>
          <FileLink path={filePath} context={remoteCtx}>
            {filePath}
          </FileLink>
        </div>
        <FilePreviewHost />
      </FilePreviewProvider>
    </ThemeProvider>
  );
}

describe("FilePreviewProvider — overlay survives message churn", () => {
  beforeEach(() => {
    setHost("dashboard.example.com");
    okFileFetch();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreHost();
  });

  it("remounting the FileLink subtree (new message / reparse) keeps the overlay open", async () => {
    const { getByText, getByTestId, findByTestId, queryByTestId } = render(<Harness />);
    fireEvent.click(getByText("src/foo.ts"));
    expect(await findByTestId("file-preview-overlay")).toBeTruthy();
    // Simulate a message update that remounts the FileLink subtree.
    fireEvent.click(getByTestId("churn"));
    expect(queryByTestId("file-preview-overlay")).toBeTruthy();
  });

  it("repeated churn (streaming tokens) keeps the overlay open", async () => {
    const { getByText, getByTestId, findByTestId, queryByTestId } = render(<Harness />);
    fireEvent.click(getByText("src/foo.ts"));
    expect(await findByTestId("file-preview-overlay")).toBeTruthy();
    fireEvent.click(getByTestId("churn"));
    fireEvent.click(getByTestId("churn"));
    fireEvent.click(getByTestId("churn"));
    expect(queryByTestId("file-preview-overlay")).toBeTruthy();
  });

  it("opening file A then file B renders exactly one overlay, showing B", async () => {
    function TwoLinks() {
      return (
        <ThemeProvider>
          <FilePreviewProvider>
            <FileLink path="a.ts" context={remoteCtx}>
              a.ts
            </FileLink>
            <FileLink path="b.ts" context={remoteCtx}>
              b.ts
            </FileLink>
            <FilePreviewHost />
          </FilePreviewProvider>
        </ThemeProvider>
      );
    }
    const { getByText, findByTestId, getAllByTestId } = render(<TwoLinks />);
    fireEvent.click(getByText("a.ts"));
    await findByTestId("file-preview-overlay");
    fireEvent.click(getByText("b.ts"));
    // The B open is an async resolve round-trip; wait for the overlay to switch.
    await waitFor(() => {
      const overlays = getAllByTestId("file-preview-overlay");
      expect(overlays.length).toBe(1);
      expect(overlays[0].textContent).toContain("b.ts");
    });
  });

  it("Esc dismisses the hoisted overlay", async () => {
    const { getByText, findByTestId, queryByTestId } = render(<Harness />);
    fireEvent.click(getByText("src/foo.ts"));
    expect(await findByTestId("file-preview-overlay")).toBeTruthy();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(queryByTestId("file-preview-overlay")).toBeNull();
  });

  it("close button dismisses the hoisted overlay", async () => {
    const { getByText, findByTestId, getByTitle, queryByTestId } = render(<Harness />);
    fireEvent.click(getByText("src/foo.ts"));
    expect(await findByTestId("file-preview-overlay")).toBeTruthy();
    fireEvent.click(getByTitle("Close"));
    expect(queryByTestId("file-preview-overlay")).toBeNull();
  });
});

describe("useFilePreview — provider guard", () => {
  it("throws when used outside a FilePreviewProvider", () => {
    function Bad() {
      useFilePreview();
      return null;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bad />)).toThrow(/FilePreviewProvider/);
    spy.mockRestore();
  });
});

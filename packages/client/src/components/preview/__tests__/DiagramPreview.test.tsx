import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagramPreview } from "../DiagramPreview.js";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

const target = { kind: "file" as const, cwd: "/proj", path: "arch.puml" };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DiagramPreview", () => {
  it("renders SVG inside zoom-pan viewport on proxy success (test-plan #F1)", async () => {
    // 1. Mock fetch for source text
    // 2. Mock fetch for diagram render proxy
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/file?")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { content: "@startuml\nA->B\n@enduml" } }),
        };
      }
      if (url.includes("/api/diagram/render")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="5"/></svg>' } }),
        };
      }
      return { ok: false };
    }) as any;

    render(<DiagramPreview target={target} />);

    // Initially shows loading
    expect(screen.getByTestId("diagram-preview-loading")).toBeTruthy();

    // Eventually renders SVG viewport
    await waitFor(() => {
      expect(screen.getByTestId("diagram-preview-viewport")).toBeTruthy();
      expect(screen.getByTestId("diagram-svg-container")).toBeTruthy();
    });
  });

  it("falls back to source text with notice on decline/unavailable (test-plan #F2)", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/file?")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { content: "@startuml\nBob -> Alice\n@enduml" } }),
        };
      }
      if (url.includes("/api/diagram/render")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({
            success: false,
            code: "unavailable",
            error: "Diagram rendering unavailable",
          }),
        };
      }
      return { ok: false };
    }) as any;

    render(<DiagramPreview target={target} />);

    await waitFor(() => {
      expect(screen.getByTestId("diagram-preview-fallback")).toBeTruthy();
      expect(screen.getByText("Diagram rendering is not configured")).toBeTruthy();
      expect(screen.getByText((c) => c.includes("Bob -> Alice"))).toBeTruthy();
    });
  });

  it("falls back to source text on upstream failure (test-plan #X3)", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/file?")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { content: "@startuml\nA->B\n@enduml" } }),
        };
      }
      if (url.includes("/api/diagram/render")) {
        return {
          ok: false,
          status: 502,
          json: async () => ({
            success: false,
            code: "upstream_failure",
            error: "Upstream diagram render failed: connect ECONNREFUSED",
          }),
        };
      }
      return { ok: false };
    }) as any;

    render(<DiagramPreview target={target} />);

    await waitFor(() => {
      expect(screen.getByTestId("diagram-preview-fallback")).toBeTruthy();
      expect(screen.getByText((c) => c.includes("Upstream diagram render failed"))).toBeTruthy();
      expect(screen.getByText((c) => c.includes("A->B"))).toBeTruthy();
    });
  });

  it("clears prior state and shows fallback if second target read fails", async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/file?")) {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({ success: true, data: { content: "@startuml\nA->B\n@enduml" } }),
          };
        }
        return {
          ok: false,
          json: async () => ({ success: false, error: "File not found" }),
        };
      }
      if (url.includes("/api/diagram/render")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="5"/></svg>' } }),
        };
      }
      return { ok: false };
    }) as any;

    const { rerender } = render(<DiagramPreview target={{ kind: "file", cwd: "/proj", path: "first.puml" }} />);

    await waitFor(() => {
      expect(screen.getByTestId("diagram-svg-container")).toBeTruthy();
    });

    // Rerender with second file that fails to load
    rerender(<DiagramPreview target={{ kind: "file", cwd: "/proj", path: "second.puml" }} />);

    await waitFor(() => {
      expect(screen.queryByTestId("diagram-svg-container")).toBeNull();
      expect(screen.getByText("File not found")).toBeTruthy();
    });
  });
});

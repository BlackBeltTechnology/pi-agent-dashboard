import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEditorPaneState } from "../../../lib/layout/editor-pane-state.js";
import { loadSplitState } from "../../../lib/layout/split-state.js";
import { SplitWorkspaceProvider } from "../../split/SplitWorkspaceContext.js";
import { FileLink } from "../FileLink.js";
import type { ToolContext } from "../types.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => localStorage.clear());

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as any;
}

// Route the resolve endpoint (echo the mention as resolved); the split pane's
// own `/api/file` fetches are irrelevant to these state assertions.
function mockResolve(
  resolve: (mention: string) => Response = (m) =>
    jsonResponse({ success: true, data: { resolved: `/Users/me/repo/${m}`, kind: "relative" } }),
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes("/api/file/resolve-mention")) {
      const mention = init?.body ? JSON.parse(init.body).mention : "";
      return resolve(mention);
    }
    return jsonResponse({ success: true, data: { type: "file", content: "" } });
  });
}

function renderInSplit(ui: React.ReactElement, sessionId: string, cwd: string) {
  return render(
    <SplitWorkspaceProvider sessionId={sessionId} cwd={cwd} orientation="h">
      {ui}
    </SplitWorkspaceProvider>,
  );
}

describe("FileLink — split routing", () => {
  it("clicking a relative file-link auto-opens the split and adds the tab", async () => {
    const fetchSpy = mockResolve();
    const ctx: ToolContext = { cwd: "/Users/me/repo", sessionId: "sesh" };
    renderInSplit(
      <FileLink path="src/foo.ts" line={7} context={ctx}>
        src/foo.ts
      </FileLink>,
      "sesh",
      "/Users/me/repo",
    );

    expect(loadSplitState("sesh").mode).toBe("closed");
    fireEvent.click(screen.getByRole("button"));

    // Resolve is async — the split opens after the round-trip.
    await waitFor(() => expect(loadSplitState("sesh").mode).toBe("split"));
    // Pane opens the cwd-relative path (tab-key parity with tree clicks).
    expect(loadEditorPaneState("sesh").openFiles.map((f) => f.path)).toEqual(["src/foo.ts"]);
    fetchSpy.mockRestore();
  });

  it("split-open routes THROUGH the resolve endpoint, not a client short-circuit (G2, S17)", async () => {
    const fetchSpy = mockResolve();
    const ctx: ToolContext = { cwd: "/Users/me/repo", sessionId: "sesh" };
    renderInSplit(
      <FileLink path="src/foo.ts" line={7} context={ctx}>
        src/foo.ts
      </FileLink>,
      "sesh",
      "/Users/me/repo",
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([u]) => String(u).includes("/api/file/resolve-mention")),
      ).toBe(true),
    );
    // And it did open the split (not a no-op).
    await waitFor(() => expect(loadSplitState("sesh").mode).toBe("split"));
    fetchSpy.mockRestore();
  });

  it("a null resolution does NOT open the split (G1)", async () => {
    const fetchSpy = mockResolve(() => jsonResponse({ success: true, data: { resolved: null } }));
    const ctx: ToolContext = { cwd: "/Users/me/repo", sessionId: "sesh" };
    renderInSplit(
      <FileLink path="ghost.ts" context={ctx}>
        ghost.ts
      </FileLink>,
      "sesh",
      "/Users/me/repo",
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("button").getAttribute("data-not-found")).toBe("true"),
    );
    expect(loadSplitState("sesh").mode).toBe("closed");
    fetchSpy.mockRestore();
  });
});

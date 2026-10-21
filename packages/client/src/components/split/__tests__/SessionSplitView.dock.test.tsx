/**
 * #F16 (task 8.5): the composer dock lives in the chat slot, so a canvas that
 * replaces the chat on tablet / mobile hides the dock with it. At 767 px (mobile
 * tier) the chat pane is kept mounted but `hidden`; on the tablet tier it is not
 * mounted at all. On desktop the dock stays visible beside the canvas.
 * See change: add-composer-dock (markdown-preview-view delta).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewportTier } from "../../../lib/canvas/canvas-gate.js";
import { DockHarness, fakeLane, makeSession } from "../../chat/__tests__/dock-harness.js";
import { SessionSplitView } from "../SessionSplitView.js";
import { SplitWorkspaceProvider } from "../SplitWorkspaceContext.js";

let tier: ViewportTier = "mobile";
vi.mock("../../../hooks/useCanvasTier.js", () => ({ useCanvasTier: () => tier }));
vi.mock("../../editor-pane/EditorPane.js", () => ({ EditorPane: () => <div data-testid="preview-canvas" /> }));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function renderWorkspace(mode: "closed" | "split" | "full") {
  localStorage.setItem(
    "pi-dashboard:split:s1",
    JSON.stringify({ mode, ratio: 0.5, orientation: tier === "desktop" ? "h" : "v" }),
  );
  return render(
    <SplitWorkspaceProvider sessionId="s1" cwd="/repo" orientation={tier === "desktop" ? "h" : "v"}>
      <SessionSplitView chat={<DockHarness session={makeSession()} lanes={[fakeLane("queue")]} />} />
    </SplitWorkspaceProvider>,
  );
}

describe("composer dock with a replacing canvas (F16)", () => {
  it("mobile (767 px) with an open preview: the dock is inside the hidden chat pane, the preview is shown", () => {
    tier = "mobile";
    renderWorkspace("full");
    const pane = screen.getByTestId("split-chat-pane");
    expect(pane.classList.contains("hidden")).toBe(true);
    expect(pane.contains(screen.getByTestId("composer-dock"))).toBe(true);
    expect(screen.getByTestId("preview-canvas")).toBeTruthy();
  });

  it("tablet with an open preview: the chat pane, and so the dock, is not mounted", () => {
    tier = "tablet";
    renderWorkspace("split");
    expect(screen.queryByTestId("composer-dock")).toBeNull();
    expect(screen.queryByTestId("split-chat-pane")).toBeNull();
    expect(screen.getByTestId("preview-canvas")).toBeTruthy();
  });

  it("desktop with an open canvas: the dock stays visible beside it", () => {
    tier = "desktop";
    renderWorkspace("split");
    const pane = screen.getByTestId("split-chat-pane");
    expect(pane.classList.contains("hidden")).toBe(false);
    expect(pane.contains(screen.getByTestId("composer-dock"))).toBe(true);
    expect(screen.getByTestId("preview-canvas")).toBeTruthy();
  });
});

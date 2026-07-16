import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEditorPaneState } from "../../../lib/editor-pane-state.js";
import { loadSplitState } from "../../../lib/split-state.js";
import { SplitWorkspaceProvider } from "../../SplitWorkspaceContext.js";
import { FileLink } from "../FileLink.js";
import type { ToolContext } from "../types.js";

afterEach(() => cleanup());
beforeEach(() => localStorage.clear());

function renderInSplit(ui: React.ReactElement, sessionId: string, cwd: string) {
  return render(
    <SplitWorkspaceProvider sessionId={sessionId} cwd={cwd} orientation="h">
      {ui}
    </SplitWorkspaceProvider>,
  );
}

describe("FileLink — split routing", () => {
  it("clicking a relative file-link auto-opens the split and adds the tab", () => {
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

    expect(loadSplitState("sesh").mode).toBe("split");
    expect(loadEditorPaneState("sesh").openFiles.map((f) => f.path)).toEqual(["src/foo.ts"]);
  });
});

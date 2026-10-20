/**
 * DiffViewer virtual-path handling + no-provider fallback
 * (change: add-change-summary-table).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// DiffViewer's job is FILE RESOLUTION from the shared diff context; DiffPanel's
// rendering is covered by DiffPanelTheme.test. Mock DiffPanel to a probe that
// reports which file (and how many changes) it received.
vi.mock("../../diff/DiffPanel.js", () => ({
  DiffPanel: ({ file }: { file: { path: string; changes: unknown[] } }) => (
    <div data-testid="diff-panel" data-path={file.path} data-changes={file.changes.length} />
  ),
}));

import DiffViewer, { stripDiffPrefix } from "../DiffViewer.js";
import { SessionDiffContext } from "../../diff/SessionDiffContext.js";
import type { SessionDiffContextValue } from "../../diff/SessionDiffContext.js";
import { fileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import type { SessionDiffResponse } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";

afterEach(cleanup);

function withDiff(data: SessionDiffResponse, path: string, cwd = "/repo") {
  const value: SessionDiffContextValue = {
    sessionId: "s1",
    data,
    isLoading: false,
    error: null,
    refresh: () => {},
  };
  const fk = fileKind(`${cwd}/x`);
  return render(
    <SessionDiffContext.Provider value={value}>
      <DiffViewer cwd={cwd} path={path} kind={fk.kind} mimeType={fk.mimeType} size={0} />
    </SessionDiffContext.Provider>,
  );
}

describe("stripDiffPrefix", () => {
  it("strips the diff: sentinel", () => {
    expect(stripDiffPrefix("diff:src/a.ts")).toBe("src/a.ts");
  });
  it("leaves a bare path unchanged", () => {
    expect(stripDiffPrefix("src/a.ts")).toBe("src/a.ts");
  });
});

describe("DiffViewer", () => {
  it("renders an unavailable message outside a SessionDiffProvider", () => {
    const fk = fileKind("/repo/src/a.ts");
    render(<DiffViewer cwd="/repo" path="diff:src/a.ts" kind={fk.kind} mimeType={fk.mimeType} size={0} />);
    expect(screen.getByText("Diff unavailable")).toBeTruthy();
  });

  const nonGitData: SessionDiffResponse = {
    isGitRepo: false,
    files: [
      {
        path: "src/a.ts",
        changes: [{ type: "write", timestamp: 0, content: "const a = 1;\nconst b = 2;\n" }],
      },
    ],
  };

  it("resolves an absolute diff: path via the cwd-normalized fallback", () => {
    // Caller opened an absolute path; exact match misses, normalized match wins.
    withDiff(nonGitData, "diff:/repo/src/a.ts");
    expect(screen.queryByText("No changes for this file")).toBeNull();
    const panel = screen.getByTestId("diff-panel");
    expect(panel.getAttribute("data-path")).toBe("src/a.ts");
  });

  it("resolves a non-git file (no gitDiff) and hands it to DiffPanel, not blank", () => {
    withDiff(nonGitData, "diff:src/a.ts");
    expect(screen.queryByText("No changes for this file")).toBeNull();
    const panel = screen.getByTestId("diff-panel");
    // The file's own session change payload is passed through (a Write change),
    // so DiffPanel can derive an all-additions diff — never blank.
    expect(panel.getAttribute("data-changes")).toBe("1");
  });
});

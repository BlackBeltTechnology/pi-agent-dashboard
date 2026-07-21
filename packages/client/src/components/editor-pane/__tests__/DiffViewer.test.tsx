/**
 * DiffViewer virtual-path handling + no-provider fallback
 * (change: add-change-summary-table).
 * Path abs→rel lookup (change: fix-session-diff-open-nongit-and-preview).
 */
import type { SessionDiffResponse } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { fileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DiffViewer, { findDiffFile, stripDiffPrefix } from "../DiffViewer.js";

afterEach(cleanup);

describe("stripDiffPrefix", () => {
  it("strips the diff: sentinel", () => {
    expect(stripDiffPrefix("diff:src/a.ts")).toBe("src/a.ts");
  });
  it("leaves a bare path unchanged", () => {
    expect(stripDiffPrefix("src/a.ts")).toBe("src/a.ts");
  });
});

describe("findDiffFile", () => {
  const data: SessionDiffResponse = {
    files: [
      {
        path: "src/a.ts",
        changes: [{ type: "write", timestamp: 1, content: "hello\n" }],
        gitDiff: undefined,
      },
    ],
    isGitRepo: false,
  };

  it("exact relative match", () => {
    expect(findDiffFile(data, "src/a.ts", "/repo")?.path).toBe("src/a.ts");
  });

  it("resolves absolute path under cwd to the relative key", () => {
    expect(findDiffFile(data, "/repo/src/a.ts", "/repo")?.path).toBe("src/a.ts");
  });

  it("misses when path is outside cwd and not in files", () => {
    expect(findDiffFile(data, "/other/a.ts", "/repo")).toBeUndefined();
  });
});

describe("DiffViewer", () => {
  it("renders an unavailable message outside a SessionDiffProvider", () => {
    const fk = fileKind("/repo/src/a.ts");
    render(<DiffViewer cwd="/repo" path="diff:src/a.ts" kind={fk.kind} mimeType={fk.mimeType} size={0} />);
    expect(screen.getByText("Diff unavailable")).toBeTruthy();
  });
});

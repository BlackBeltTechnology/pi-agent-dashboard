/**
 * DiffViewer virtual-path handling + no-provider fallback
 * (change: add-change-summary-table).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import DiffViewer, { stripDiffPrefix } from "../DiffViewer.js";
import { fileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";

afterEach(cleanup);

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
});

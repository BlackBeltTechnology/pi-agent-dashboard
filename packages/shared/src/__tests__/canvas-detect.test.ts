/**
 * Detect classifier + selector (Decision 2). Scenarios S1–S5, S7, S8.
 * See change: auto-canvas.
 */
import { describe, expect, it } from "vitest";
import {
  type CanvasCandidate,
  detectCanvasIntent,
  selectCanvasTarget,
} from "../canvas-detect.js";

const doc = (path: string): CanvasCandidate => {
  const c = detectCanvasIntent("Write", { path }, "/p");
  if (!c) throw new Error(`expected candidate for ${path}`);
  return c;
};
const declare = (path: string): CanvasCandidate => ({
  prio: "DECLARE",
  target: { kind: "file", cwd: "/p", path },
  kind: "markdown",
});

describe("detectCanvasIntent", () => {
  it("S1 — write of a renderable yields a file candidate with server cwd", () => {
    const c = detectCanvasIntent("Write", { path: "report.md" }, "/p");
    expect(c).toEqual({
      prio: "DOC",
      target: { kind: "file", cwd: "/p", path: "report.md" },
      kind: "markdown",
    });
  });

  it("S2 — support file (.css) → null", () => {
    expect(detectCanvasIntent("Write", { path: "a.css" }, "/p")).toBeNull();
  });

  it("S3 — .svg classifies as image (no svg kind)", () => {
    const c = detectCanvasIntent("Write", { path: "x.svg" }, "/p");
    expect(c?.kind).toBe("image");
  });

  it("S4 — bash is never path-parsed → null", () => {
    expect(
      detectCanvasIntent("bash", { command: "pandoc in.md -o out.pdf" }, "/p"),
    ).toBeNull();
  });

  it("S5 — gitignored direct write is still a candidate", () => {
    const c = detectCanvasIntent("Write", { path: "dist/report.pdf" }, "/p");
    expect(c).not.toBeNull();
    expect(c?.kind).toBe("pdf");
  });

  it("edit tool is also detected", () => {
    expect(detectCanvasIntent("edit", { path: "notes.md" }, "/p")?.kind).toBe(
      "markdown",
    );
  });

  it("missing path → null", () => {
    expect(detectCanvasIntent("Write", {}, "/p")).toBeNull();
  });
});

describe("selectCanvasTarget", () => {
  it("empty → null", () => {
    expect(selectCanvasTarget([])).toBeNull();
  });

  it("S7 — last write wins among DOC candidates", () => {
    const target = selectCanvasTarget([doc("intro.md"), doc("report.md")]);
    expect(target).toEqual({ kind: "file", cwd: "/p", path: "report.md" });
  });

  it("S8 — a declare overrides detection + registry", () => {
    const target = selectCanvasTarget([
      doc("a.md"),
      doc("b.svg"),
      declare("report.md"),
    ]);
    expect(target).toEqual({ kind: "file", cwd: "/p", path: "report.md" });
  });
});

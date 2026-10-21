/**
 * `ToolContext.canvas` is scalars: the memo that builds the tool context moves
 * only when key / sourceCallId / chipDeclarationId do.
 * See change: improve-canvas-html-and-url-ux (test-plan #F3).
 */
import { act, cleanup, render } from "@testing-library/react";
import { memo, useMemo, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { type CanvasState, canvasToolScalars, EMPTY_CANVAS_STATE } from "../../lib/canvas/canvas-gate.js";
import { useCanvasToolScalars } from "../../lib/canvas/use-canvas-tool-scalars.js";
import { makeToolContext } from "../tool-renderers/make-tool-context.js";
import type { ToolContext } from "../tool-renderers/types.js";

afterEach(() => cleanup());

const base: CanvasState = {
  ...EMPTY_CANVAS_STATE,
  target: { kind: "file", cwd: "/p", path: "a.html" },
  version: 1,
  sourceCallId: "c1",
  chip: { kind: "server", port: 5173, declarationId: "c2" },
};

let rowRenders = 0;
const Row = memo(function Row({ context }: { context: ToolContext }) {
  rowRenders += 1;
  return <div>{context.canvas?.sourceCallId}</div>;
});

let setState: (s: CanvasState) => void = () => {};
function Harness() {
  const [state, set] = useState(base);
  setState = set;
  const canvas = useCanvasToolScalars(state);
  // Mirrors App.tsx: the context memo depends on the scalars object only.
  const context = useMemo(() => makeToolContext({ cwd: "/p", sessionId: "s", canvas }), [canvas]);
  return (
    <>
      {Array.from({ length: 50 }, (_, i) => (
        <Row key={i} context={context} />
      ))}
    </>
  );
}

describe("F3 — tool rows re-render only when a canvas scalar changes", () => {
  it("unrelated canvas changes (phase, title, version, mode, chip title) leave all 50 rows alone", () => {
    render(<Harness />);
    expect(rowRenders).toBe(50);
    act(() => setState({ ...base, phase: "eager", title: "T", version: 7, mode: "pin", chip: { ...base.chip!, title: "renamed" } }));
    expect(rowRenders).toBe(50);
  });

  it("a different sourceCallId re-renders them", () => {
    rowRenders = 0;
    render(<Harness />);
    act(() => setState({ ...base, sourceCallId: "c9" }));
    expect(rowRenders).toBe(100);
  });

  it("a chip declaration change re-renders them (the active server card moved)", () => {
    rowRenders = 0;
    render(<Harness />);
    act(() => setState({ ...base, chip: { kind: "server", port: 5173, declarationId: "c5" } }));
    expect(rowRenders).toBe(100);
  });
});

describe("canvasToolScalars", () => {
  it("identity has no version; a chip-only canvas keys on the server port; empty is null", () => {
    expect(canvasToolScalars(base).key).toBe("file:/p:a.html");
    expect(canvasToolScalars({ ...base, version: 99 }).key).toBe("file:/p:a.html");
    expect(canvasToolScalars({ ...EMPTY_CANVAS_STATE, chip: { kind: "server", port: 4321 } }).key).toBe("server:4321");
    expect(canvasToolScalars(undefined)).toEqual({ key: null, sourceCallId: undefined, chipDeclarationId: undefined });
  });
});

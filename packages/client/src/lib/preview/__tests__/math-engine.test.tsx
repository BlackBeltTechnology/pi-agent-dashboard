/**
 * Math engine (katex + rehype-katex + stylesheet) loads on demand, once.
 * See change: shrink-client-entry-lazy-islands (tasks 2.1/2.2).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("rehype-katex");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("math-engine", () => {
  it("loadMathEngine is memoized: concurrent callers share one load", async () => {
    vi.resetModules();
    const { loadMathEngine } = await import("../math-engine.js");
    const a = loadMathEngine();
    const b = loadMathEngine();
    expect(a).toBe(b);
    const engine = await a;
    expect(typeof engine.katex.renderToString).toBe("function");
    expect(engine.rehypeKatex).toBeTruthy();
    expect(loadMathEngine()).toBe(a);
  });

  it("useMathEngine(false) never starts a load", async () => {
    vi.resetModules();
    const mod = await import("../math-engine.js");
    const spy = vi.spyOn(mod, "loadMathEngine");
    const { result } = renderHook(() => mod.useMathEngine(false));
    expect(result.current).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("useMathEngine(true) returns null first, then the engine; two hooks share one engine", async () => {
    vi.resetModules();
    const mod = await import("../math-engine.js");
    const one = renderHook(() => mod.useMathEngine(true));
    const two = renderHook(() => mod.useMathEngine(true));
    expect(one.result.current).toBeNull();
    await waitFor(() => expect(one.result.current).not.toBeNull());
    await waitFor(() => expect(two.result.current).not.toBeNull());
    expect(one.result.current).toBe(two.result.current);
  });

  it("a failed load keeps the hook at null permanently, logs once, and rejects loadMathEngine", async () => {
    vi.resetModules();
    vi.doMock("rehype-katex", () => {
      throw new Error("chunk 404");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("../math-engine.js");
    const one = renderHook(() => mod.useMathEngine(true));
    const two = renderHook(() => mod.useMathEngine(true));
    await act(async () => {
      await mod.loadMathEngine().catch(() => {});
    });
    expect(one.result.current).toBeNull();
    expect(two.result.current).toBeNull();
    await expect(mod.loadMathEngine()).rejects.toBeInstanceOf(Error);
    expect(err).toHaveBeenCalledTimes(1);
  });
});

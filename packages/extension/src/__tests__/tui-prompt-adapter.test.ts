/**
 * Tests for the bridge's built-in TUI adapter behavior.
 * Tests the production adapter used by bridge.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PromptBus } from "../prompt-bus.js";
import { createTuiPromptAdapter } from "../tui-prompt-adapter.js";

function createMockUi() {
  const signals: Record<string, AbortSignal | undefined> = {};
  const resolvers: Record<string, { resolve: (v: any) => void }> = {};

  function makeMock(name: string) {
    return vi.fn().mockImplementation((_q: string, _a?: any, opts?: any) => {
      signals[name] = opts?.signal;
      return new Promise((resolve) => {
        resolvers[name] = { resolve };
        opts?.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
      });
    });
  }

  return {
    select: makeMock("select"),
    input: makeMock("input"),
    confirm: makeMock("confirm"),
    editor: makeMock("editor"),
    _resolve: (method: string, value: any) => resolvers[method]?.resolve(value),
    _signal: (method: string) => signals[method],
  };
}

describe("Bridge TUI adapter", () => {
  let bus: PromptBus;
  let mockUi: ReturnType<typeof createMockUi>;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new PromptBus({ timeoutMs: 5000 });
    mockUi = createMockUi();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls original select with question and options", () => {
    bus.registerAdapter(createTuiPromptAdapter(mockUi, bus));
    bus.request({ pipeline: "command", type: "select", question: "Pick:", options: ["A", "B"] });

    expect(mockUi.select).toHaveBeenCalledWith("Pick:", ["A", "B"], expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("calls original input with question and defaultValue", () => {
    bus.registerAdapter(createTuiPromptAdapter(mockUi, bus));
    bus.request({ pipeline: "command", type: "input", question: "Name:", defaultValue: "default" });

    expect(mockUi.input).toHaveBeenCalledWith("Name:", "default", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("calls original editor with question and prefill", () => {
    bus.registerAdapter(createTuiPromptAdapter(mockUi, bus));
    bus.request({
      pipeline: "command",
      type: "editor",
      question: "Edit response:",
      defaultValue: "draft",
    });

    expect(mockUi.editor).toHaveBeenCalledWith(
      "Edit response:",
      "draft",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("calls original confirm with question and message context", () => {
    bus.registerAdapter(createTuiPromptAdapter(mockUi, bus));
    bus.request({
      pipeline: "command",
      type: "confirm",
      question: "Run production promotion?",
      metadata: { message: "Staging passed all verification checks." },
    });

    expect(mockUi.confirm).toHaveBeenCalledWith(
      "Run production promotion?",
      "Staging passed all verification checks.",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("passes an empty confirm message when context is absent", () => {
    bus.registerAdapter(createTuiPromptAdapter(mockUi, bus));
    bus.request({ pipeline: "command", type: "confirm", question: "Sure?" });

    expect(mockUi.confirm).toHaveBeenCalledWith(
      "Sure?",
      "",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not present multiselect prompts in the TUI", () => {
    const adapter = createTuiPromptAdapter(mockUi, bus);

    const claim = adapter.onRequest({
      id: "multi",
      pipeline: "command",
      type: "multiselect",
      question: "Pick several:",
      options: ["A", "B"],
    });

    expect(claim).toEqual({});
    expect(mockUi.select).not.toHaveBeenCalled();
    expect(mockUi.input).not.toHaveBeenCalled();
    expect(mockUi.confirm).not.toHaveBeenCalled();
    expect(mockUi.editor).not.toHaveBeenCalled();
  });

  it("responds via bus when user answers select", async () => {
    bus.registerAdapter(createTuiPromptAdapter(mockUi, bus));
    const promise = bus.request({ pipeline: "command", type: "select", question: "Q", options: ["A"] });

    mockUi._resolve("select", "A");
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;
    expect(result.answer).toBe("A");
    expect(result.source).toBe("tui");
  });

  it("responds cancelled when user dismisses dialog", async () => {
    bus.registerAdapter(createTuiPromptAdapter(mockUi, bus));
    const promise = bus.request({ pipeline: "command", type: "select", question: "Q", options: ["A"] });

    mockUi._resolve("select", undefined);
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;
    expect(result.cancelled).toBe(true);
  });

  it("converts boolean confirm to string", async () => {
    bus.registerAdapter(createTuiPromptAdapter(mockUi, bus));
    const promise = bus.request({ pipeline: "command", type: "confirm", question: "Sure?" });

    mockUi._resolve("confirm", true);
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;
    expect(result.answer).toBe("true");
  });

  it("aborts TUI dialog when another adapter answers", async () => {
    bus.registerAdapter(createTuiPromptAdapter(mockUi, bus));
    const promise = bus.request({ pipeline: "command", type: "select", question: "Q", options: ["A"] });

    // External adapter answers
    const id = (mockUi.select.mock.calls[0] as any)?.[2]?.signal ? undefined : undefined;
    // Get the prompt id from the bus's pending
    bus.respond({ id: (bus as any).pending.keys().next().value, answer: "B", source: "dashboard" });
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;
    expect(result.answer).toBe("B");
    expect(result.source).toBe("dashboard");
    expect(mockUi._signal("select")?.aborted).toBe(true);
  });

  it("aborts TUI dialog on cancel", async () => {
    bus.registerAdapter(createTuiPromptAdapter(mockUi, bus));
    const promise = bus.request({ pipeline: "command", type: "select", question: "Q", options: ["A"] });

    const id = (bus as any).pending.keys().next().value;
    bus.cancel(id);
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;
    expect(result.cancelled).toBe(true);
    expect(mockUi._signal("select")?.aborted).toBe(true);
  });

  it("does not respond after being aborted", async () => {
    const respondSpy = vi.spyOn(bus, "respond");
    bus.registerAdapter(createTuiPromptAdapter(mockUi, bus));
    bus.request({ pipeline: "command", type: "select", question: "Q", options: ["A"] });

    const id = (bus as any).pending.keys().next().value;
    // Dashboard answers first
    bus.respond({ id, answer: "B", source: "dashboard" });
    await vi.advanceTimersByTimeAsync(0);

    // TUI resolves after abort — should NOT call respond again
    mockUi._resolve("select", "A");
    await vi.advanceTimersByTimeAsync(0);

    // respond was called exactly once (by dashboard)
    expect(respondSpy.mock.calls.filter(c => c[0].id === id)).toHaveLength(1);
  });

  it("returns empty claim (no component)", () => {
    const adapter = createTuiPromptAdapter(mockUi, bus);
    bus.registerAdapter(adapter);
    const claim = adapter.onRequest({
      id: "test", pipeline: "command", type: "select", question: "Q", options: ["A"],
    });
    expect(claim).toEqual({});
    expect(claim?.component).toBeUndefined();
  });
});

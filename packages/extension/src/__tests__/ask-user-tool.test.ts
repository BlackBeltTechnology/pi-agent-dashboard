import { describe, it, expect, vi } from "vitest";

// Mock modules before importing
vi.mock("typebox", () => ({
  Type: {
    Object: vi.fn(() => ({})),
    String: vi.fn(() => ({})),
    Optional: vi.fn((x: any) => x),
    Array: vi.fn(() => ({})),
    Union: vi.fn(() => ({})),
    Literal: vi.fn(() => ({})),
  },
}));

vi.mock("@mariozechner/pi-ai", () => ({
  StringEnum: vi.fn(() => ({})),
}));

import { registerAskUserTool } from "../ask-user-tool.js";

function createMockPi() {
  return {
    registerTool: vi.fn(),
  };
}

describe("registerAskUserTool", () => {
  it("registers ask_user tool", () => {
    const pi = createMockPi();
    registerAskUserTool(pi as any);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    expect(pi.registerTool.mock.calls[0][0].name).toBe("ask_user");
  });

  it("registers with correct methods", () => {
    const pi = createMockPi();
    registerAskUserTool(pi as any);

    const tool = pi.registerTool.mock.calls[0][0];
    expect(tool.name).toBe("ask_user");
    expect(tool.execute).toBeTypeOf("function");
    expect(tool.promptGuidelines).toBeDefined();
    expect(tool.promptGuidelines.length).toBeGreaterThan(0);
  });

  it("description instructs agents not to add a Select all option", () => {
    const pi = createMockPi();
    registerAskUserTool(pi as any);
    const tool = pi.registerTool.mock.calls[0][0];
    expect(tool.description).toMatch(/UI provides a Select all/i);
  });

  describe("message passthrough", () => {
    function getToolAndMockCtx() {
      const pi = createMockPi();
      registerAskUserTool(pi as any);
      const tool = pi.registerTool.mock.calls[0][0];
      // `custom` stands in for the multiselect polyfill: it invokes the factory
      // with a `done` callback; the factory-returned component exposes
      // onConfirm/onCancel. We auto-confirm with ["A"] to preserve the legacy
      // mock return value that the multiselect assertions expected.
      const custom = vi.fn().mockImplementation(async (factory: any) => {
        return await new Promise<unknown>((resolve) => {
          const component: any = factory({}, {}, {}, (r: unknown) => resolve(r));
          component?.onConfirm?.(["A"]);
        });
      });
      const ctx = {
        ui: {
          confirm: vi.fn().mockResolvedValue(true),
          select: vi.fn().mockResolvedValue("A"),
          input: vi.fn().mockResolvedValue("hello"),
          custom,
        },
      };
      return { tool, ctx, custom };
    }

    it("passes message through opts for input", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      await tool.execute("id", { method: "input", title: "Q", message: "Details here" }, undefined, undefined, ctx);
      // toolCallId is also threaded through opts since change
      // `fix-interactive-ui-reorder`. Asserts both fields without
      // pinning property order.
      expect(ctx.ui.input).toHaveBeenCalledWith(
        "Q",
        undefined,
        expect.objectContaining({ message: "Details here", toolCallId: "id" }),
      );
    });

    it("passes message through opts for select", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      await tool.execute("id", { method: "select", title: "Pick", message: "Context", options: ["A", "B"] }, undefined, undefined, ctx);
      expect(ctx.ui.select).toHaveBeenCalledWith(
        "Pick",
        ["A", "B"],
        expect.objectContaining({ message: "Context", toolCallId: "id" }),
      );
    });

    it("dispatches multiselect through the polyfill via ctx.ui.custom", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      const result = await tool.execute(
        "id",
        { method: "multiselect", title: "Multi", message: "Info", options: ["A"] },
        undefined,
        undefined,
        ctx,
      );
      // Polyfill routes via custom(factory); multiselect is not called directly.
      expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
      expect(result.details.method).toBe("multiselect");
      expect(result.details.result).toEqual(["A"]);
    });

    it("passes only toolCallId through opts when message is undefined", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      await tool.execute("id", { method: "input", title: "Q" }, undefined, undefined, ctx);
      // Even with no `message`, the wrapper still attaches toolCallId so
      // the resulting prompt_request can be paired by the client reducer.
      expect(ctx.ui.input).toHaveBeenCalledWith(
        "Q",
        undefined,
        expect.objectContaining({ toolCallId: "id" }),
      );
    });

    it("falls back to message when title is missing", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      await tool.execute("id", { method: "input", message: "Detailed question" }, undefined, undefined, ctx);
      expect(ctx.ui.input).toHaveBeenCalledWith(
        "Detailed question",
        undefined,
        expect.objectContaining({ message: "Detailed question", toolCallId: "id" }),
      );
    });

    it("falls back to 'Question' when both title and message are missing", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      await tool.execute("id", { method: "confirm" }, undefined, undefined, ctx);
      // confirm now also threads toolCallId via 3rd arg.
      expect(ctx.ui.confirm).toHaveBeenCalledWith(
        "Question",
        "",
        expect.objectContaining({ toolCallId: "id" }),
      );
    });

    it("parses options from JSON string", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      await tool.execute("id", { method: "select", title: "Pick", options: '["A", "B"]' }, undefined, undefined, ctx);
      // No message, no other opts — only toolCallId.
      expect(ctx.ui.select).toHaveBeenCalledWith(
        "Pick",
        ["A", "B"],
        expect.objectContaining({ toolCallId: "id" }),
      );
    });

    it("throws when select reaches execute with unparseable options string", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      await expect(
        tool.execute("id", { method: "select", title: "Pick", options: "not json" }, undefined, undefined, ctx),
      ).rejects.toThrow(/options/i);
      expect(ctx.ui.select).not.toHaveBeenCalled();
    });

    it("throws when select is invoked with empty options array", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      await expect(
        tool.execute("id", { method: "select", title: "Pick", options: [] }, undefined, undefined, ctx),
      ).rejects.toThrow(/options.*input/is);
      expect(ctx.ui.select).not.toHaveBeenCalled();
    });

    it("throws when multiselect is invoked without options", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      await expect(
        tool.execute("id", { method: "multiselect", title: "Pick" }, undefined, undefined, ctx),
      ).rejects.toThrow(/options/i);
      expect(ctx.ui.custom).not.toHaveBeenCalled();
    });
  });

  describe("prepareArguments", () => {
    function getTool() {
      const pi = createMockPi();
      registerAskUserTool(pi as any);
      return pi.registerTool.mock.calls[0][0];
    }

    it("leaves empty {} args untouched (no synthetic method) so schema rejection still fires", () => {
      // Regression test for the Opus-emits-empty-args bug seen in session 019dd05c.
      // Our rescue layer must NOT silently fabricate a method/title when there is
      // nothing to rescue — the framework's schema validator must still reject {}
      // so the model is forced to retry with valid args.
      const tool = getTool();
      const result = tool.prepareArguments({});
      expect(result.method).toBeUndefined();
      expect(result.title).toBeUndefined();
      expect(result.questions).toBeUndefined();
      expect(Object.keys(result).filter((k) => k !== "__normalizations")).toHaveLength(0);
    });

    it("parses stringified options array", () => {
      const tool = getTool();
      const result = tool.prepareArguments({ method: "select", title: "Pick", options: '["A", "B"]' });
      expect(result.options).toEqual(["A", "B"]);
    });

    it("leaves real array options unchanged", () => {
      const tool = getTool();
      const result = tool.prepareArguments({ method: "select", title: "Pick", options: ["A", "B"] });
      expect(result.options).toEqual(["A", "B"]);
    });

    it("leaves malformed string as-is", () => {
      const tool = getTool();
      const result = tool.prepareArguments({ method: "select", title: "Pick", options: "not json" });
      expect(result.options).toBe("not json");
    });

    it("unwraps stringified params wrapper", () => {
      const tool = getTool();
      const result = tool.prepareArguments({
        method: "select",
        params: '{"title":"X","options":["a","b"]}',
      });
      expect(result.method).toBe("select");
      expect(result.title).toBe("X");
      expect(result.options).toEqual(["a", "b"]);
      expect(result.params).toBeUndefined();
    });

    it("unwraps object-form params wrapper", () => {
      const tool = getTool();
      const result = tool.prepareArguments({
        method: "select",
        params: { title: "X", options: ["a", "b"] },
      });
      expect(result.method).toBe("select");
      expect(result.title).toBe("X");
      expect(result.options).toEqual(["a", "b"]);
      expect(result.params).toBeUndefined();
    });

    it("copies question into title when title is absent", () => {
      const tool = getTool();
      const result = tool.prepareArguments({ method: "input", question: "Your name?" });
      expect(result.title).toBe("Your name?");
    });

    it("does not overwrite explicit title with question", () => {
      const tool = getTool();
      const result = tool.prepareArguments({ method: "input", title: "T", question: "Q" });
      expect(result.title).toBe("T");
    });

    it("top-level fields win over params wrapper", () => {
      const tool = getTool();
      const result = tool.prepareArguments({
        method: "select",
        title: "OuterTitle",
        params: { title: "InnerTitle", options: ["a", "b"] },
      });
      expect(result.title).toBe("OuterTitle");
      expect(result.options).toEqual(["a", "b"]);
    });

    it("rescues options JSON string inside params wrapper", () => {
      const tool = getTool();
      const result = tool.prepareArguments({
        method: "select",
        params: '{"title":"X","options":"[\\"a\\",\\"b\\"]"}',
      });
      expect(result.options).toEqual(["a", "b"]);
    });

    // ── batch rescue ────────────────────────────────────────────────

    it("parses stringified questions array and synthesizes method=batch", () => {
      const tool = getTool();
      const result = tool.prepareArguments({
        questions:
          '[{"title":"Pick","method":"select","options":["a","b"]}]',
      });
      expect(result.method).toBe("batch");
      expect(Array.isArray(result.questions)).toBe(true);
      expect(result.questions).toHaveLength(1);
      expect(result.title).toBe("Pick");
    });

    it("backfills missing outer title on explicit method=batch call", () => {
      const tool = getTool();
      const result = tool.prepareArguments({
        method: "batch",
        questions: [
          { method: "confirm", question: "Proceed?" },
          { method: "select", question: "Scope?", options: ["A", "B"] },
        ],
      });
      expect(result.title).toBe("Proceed?");
      expect(result.questions[0].title).toBe("Proceed?"); // sub-question rename also fired
      expect(result.questions[1].title).toBe("Scope?");
    });

    it("bare questions array with no method synthesizes method=batch and pulls title", () => {
      const tool = getTool();
      const result = tool.prepareArguments({
        questions: [{ method: "confirm", title: "Proceed?" }],
      });
      expect(result.method).toBe("batch");
      expect(result.title).toBe("Proceed?");
    });

    it("pulls title from question or header if sub-question lacks title", () => {
      const tool = getTool();
      const result = tool.prepareArguments({
        questions: [{ method: "input", question: "Your name?" }],
      });
      expect(result.method).toBe("batch");
      expect(result.title).toBe("Your name?");
    });

    it("flattens input_type wrapper inside a sub-question", () => {
      const tool = getTool();
      const result = tool.prepareArguments({
        method: "batch",
        title: "T",
        questions: [
          {
            title: "Pick",
            input_type: { method: "select", options: ["a", "b"] },
          },
        ],
      });
      const sq = result.questions[0];
      expect(sq.method).toBe("select");
      expect(sq.options).toEqual(["a", "b"]);
      expect(sq.input_type).toBeUndefined();
    });

    it("converts {label, value} options to labels and records a warning", () => {
      const tool = getTool();
      const result = tool.prepareArguments({
        method: "batch",
        title: "T",
        questions: [
          {
            method: "select",
            title: "Pick",
            options: [
              { label: "Sync now", value: "sync" },
              { label: "Skip", value: "skip" },
            ],
          },
        ],
      });
      expect(result.questions[0].options).toEqual(["Sync now", "Skip"]);
      const warnings = (result as any).__normalizations as string[];
      expect(warnings).toBeDefined();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toMatch(/label.*value/);
    });

    it("renames sub-question header to title", () => {
      const tool = getTool();
      const result = tool.prepareArguments({
        method: "batch",
        title: "T",
        questions: [{ method: "input", header: "Enter name" }],
      });
      expect(result.questions[0].title).toBe("Enter name");
    });
  });

  describe("batch execution", () => {
    function getToolAndMockCtx() {
      const pi = createMockPi();
      registerAskUserTool(pi as any);
      const tool = pi.registerTool.mock.calls[0][0];
      const custom = vi.fn().mockImplementation(async (factory: any) => {
        return await new Promise<unknown>((resolve) => {
          const component: any = factory({}, {}, {}, (r: unknown) => resolve(r));
          component?.onConfirm?.(["A"]);
        });
      });
      const ctx = {
        ui: {
          confirm: vi.fn().mockResolvedValue(true),
          select: vi.fn().mockResolvedValue("A"),
          input: vi.fn().mockResolvedValue("hello"),
          custom,
        },
      };
      return { tool, ctx };
    }

    it("invokes ctx.ui primitives sequentially for each sub-question", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      const result = await tool.execute(
        "id",
        {
          method: "batch",
          title: "Setup",
          questions: [
            { method: "input", title: "Name?" },
            { method: "select", title: "Lang?", options: ["TS", "Py"] },
            { method: "confirm", title: "Init git?" },
          ],
        },
        undefined,
        undefined,
        ctx,
      );
      expect(ctx.ui.input).toHaveBeenCalledTimes(1);
      expect(ctx.ui.select).toHaveBeenCalledTimes(1);
      expect(ctx.ui.confirm).toHaveBeenCalledTimes(1);
      expect(result.details.method).toBe("batch");
      expect(result.details.results).toEqual(["hello", "A", true]);
      expect(result.details.cancelled).toBe(false);
    });

    it("prepends batch title to sub-question titles", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      await tool.execute(
        "id",
        {
          method: "batch",
          title: "Setup",
          questions: [{ method: "input", title: "Name?" }],
        },
        undefined,
        undefined,
        ctx,
      );
      const firstCallTitle = ctx.ui.input.mock.calls[0][0];
      expect(firstCallTitle).toContain("Setup");
      expect(firstCallTitle).toContain("Name?");
    });

    it("stops on cancellation and returns partial results with cancelled=true", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      // First sub-question returns a value; second cancels (undefined); third should not be called.
      ctx.ui.input.mockResolvedValueOnce("first");
      ctx.ui.select.mockResolvedValueOnce(undefined); // cancel
      const result = await tool.execute(
        "id",
        {
          method: "batch",
          title: "T",
          questions: [
            { method: "input", title: "Q1" },
            { method: "select", title: "Q2", options: ["a", "b"] },
            { method: "confirm", title: "Q3" },
          ],
        },
        undefined,
        undefined,
        ctx,
      );
      expect(result.details.cancelled).toBe(true);
      expect(result.details.results).toEqual(["first", null]);
      expect(ctx.ui.confirm).not.toHaveBeenCalled();
    });

    it("surfaces __normalizations warnings in details.warnings", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      const prepared = tool.prepareArguments({
        method: "batch",
        title: "T",
        questions: [
          {
            method: "select",
            title: "Pick",
            options: [
              { label: "A", value: "a" },
              { label: "B", value: "b" },
            ],
          },
        ],
      });
      const result = await tool.execute("id", prepared, undefined, undefined, ctx);
      expect(result.details.warnings).toBeDefined();
      expect(result.details.warnings.length).toBeGreaterThan(0);
      expect(result.details.warnings[0]).toMatch(/label.*value/);
    });

    it("throws if a batch sub-question is select with empty options", async () => {
      const { tool, ctx } = getToolAndMockCtx();
      await expect(
        tool.execute(
          "id",
          {
            method: "batch",
            title: "T",
            questions: [{ method: "select", title: "Pick", options: [] }],
          },
          undefined,
          undefined,
          ctx,
        ),
      ).rejects.toThrow(/options/i);
    });
  });
});

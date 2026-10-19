import { describe, expect, it, vi } from "vitest";

// Mock modules before importing
vi.mock("typebox", () => ({
  Type: {
    Object: vi.fn(() => ({})),
    String: vi.fn(() => ({})),
    Optional: vi.fn((x: any) => x),
    Array: vi.fn(() => ({})),
    Union: vi.fn(() => ({})),
    Literal: vi.fn(() => ({})),
    Boolean: vi.fn(() => ({})),
  },
}));

vi.mock("@earendil-works/pi-ai", () => ({
  StringEnum: vi.fn(() => ({})),
}));

import { registerAskUserTool } from "../ask-user-tool.js";
import { patchUiForPromptBus } from "../bridge-handlers/ui-prompt-patch.js";

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

  describe("X7: the tool is cwd-independent (pi 0.85.1 honours ctx.cwd)", () => {
    it("execute ignores ctx.cwd and never reads process.cwd", async () => {
      const pi = createMockPi();
      registerAskUserTool(pi as any);
      const tool = pi.registerTool.mock.calls[0][0];
      const ctx = {
        // A session cwd DELIBERATELY different from the host process cwd — if
        // the tool resolved anything relative, this is where it would show.
        cwd: "/some/other/session/cwd",
        ui: { input: vi.fn().mockResolvedValue("hello"), confirm: vi.fn().mockResolvedValue(true) },
      };
      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/host/process/cwd");
      try {
        const res = await tool.execute(
          "id",
          { method: "input", title: "Q" },
          undefined,
          undefined,
          ctx,
        );
        // Ask-user is pure UI: it renders the prompt and returns the answer.
        expect(res.details.result).toBe("hello");
        expect(ctx.ui.input).toHaveBeenCalledTimes(1);
        // No filesystem/cwd resolution happens at all.
        expect(cwdSpy).not.toHaveBeenCalled();
      } finally {
        cwdSpy.mockRestore();
      }
    });
  });

  describe("image attachments (multiline paste)", () => {
    function getTool() {
      const pi = createMockPi();
      registerAskUserTool(pi as any);
      return pi.registerTool.mock.calls[0][0];
    }

    it("standalone input prefers ctx.ui.inputWithImages and surfaces attachment paths", async () => {
      const tool = getTool();
      const inputWithImages = vi.fn().mockResolvedValue({
        value: "see attached",
        attachments: [{ path: "/home/u/.pi/dashboard/attachments/s/abc.png", mimeType: "image/png", bytes: 42 }],
      });
      const ctx = { ui: { inputWithImages, input: vi.fn().mockResolvedValue("unused") } };
      const res = await tool.execute("id", { method: "input", title: "Paste" }, undefined, undefined, ctx);
      expect(inputWithImages).toHaveBeenCalledTimes(1);
      expect(ctx.ui.input).not.toHaveBeenCalled();
      expect(res.content[0].text).toContain('"attachments"');
      expect(res.content[0].text).toContain("abc.png");
      expect(res.details.result).toEqual({
        value: "see attached",
        attachments: [{ path: "/home/u/.pi/dashboard/attachments/s/abc.png", mimeType: "image/png", bytes: 42 }],
      });
    });

    it("standalone input falls back to ctx.ui.input (text-only) when inputWithImages absent", async () => {
      const tool = getTool();
      const ctx = { ui: { input: vi.fn().mockResolvedValue("plain text") } };
      const res = await tool.execute("id", { method: "input", title: "Q" }, undefined, undefined, ctx);
      expect(ctx.ui.input).toHaveBeenCalledTimes(1);
      expect(res.content[0].text).toBe('User responded: "plain text"');
    });

    it("batch input answer with attachments flows into the summary + details", async () => {
      const tool = getTool();
      const batch = vi.fn().mockResolvedValue([
        { value: "the error", attachments: [{ path: "/a/x.png", mimeType: "image/png", bytes: 9 }] },
        { confirmed: true },
      ]);
      const ctx = { ui: { batch } };
      const res = await tool.execute(
        "id",
        { method: "batch", title: "Qs", questions: [
          { method: "input", title: "Paste the error" },
          { method: "confirm", title: "Proceed?" },
        ] },
        undefined,
        undefined,
        ctx,
      );
      expect(batch).toHaveBeenCalledTimes(1);
      // input entry carries the {value, attachments} object; confirm stays boolean.
      expect(res.details.results[0]).toEqual({ value: "the error", attachments: [{ path: "/a/x.png", mimeType: "image/png", bytes: 9 }] });
      expect(res.details.results[1]).toBe(true);
      expect(res.content[0].text).toContain("x.png");
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
    function getToolAndMockCtx(batchImpl?: any) {
      const pi = createMockPi();
      registerAskUserTool(pi as any);
      const tool = pi.registerTool.mock.calls[0][0];
      const batch =
        batchImpl ??
        vi.fn().mockResolvedValue([
          { value: "hello" },
          { value: "A" },
          { confirmed: true },
        ]);
      const ctx = {
        ui: {
          confirm: vi.fn().mockResolvedValue(true),
          select: vi.fn().mockResolvedValue("A"),
          input: vi.fn().mockResolvedValue("hello"),
          custom: vi.fn(),
          batch,
        },
      };
      return { tool, ctx };
    }

    it("issues exactly ONE ctx.ui.batch request with all questions (no per-question dispatch)", async () => {
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
      expect(ctx.ui.batch).toHaveBeenCalledTimes(1);
      // No per-question dispatch.
      expect(ctx.ui.input).not.toHaveBeenCalled();
      expect(ctx.ui.select).not.toHaveBeenCalled();
      expect(ctx.ui.confirm).not.toHaveBeenCalled();
      // questions[] passed through to the single request.
      const passedQuestions = ctx.ui.batch.mock.calls[0][1];
      expect(passedQuestions).toHaveLength(3);
      expect(passedQuestions[1]).toMatchObject({ method: "select", options: ["TS", "Py"] });
      // Answers mapped index-aligned to the legacy result shape.
      expect(result.details.method).toBe("batch");
      expect(result.details.results).toEqual(["hello", "A", true]);
      expect(result.details.cancelled).toBe(false);
    });

    it("maps a multiselect sub-question answer to {values} → string[]", async () => {
      const batch = vi.fn().mockResolvedValue([{ values: ["ESLint", "Vitest"] }]);
      const { tool, ctx } = getToolAndMockCtx(batch);
      const result = await tool.execute(
        "id",
        {
          method: "batch",
          title: "Setup",
          questions: [{ method: "multiselect", title: "Tooling", options: ["ESLint", "Vitest", "Husky"] }],
        },
        undefined,
        undefined,
        ctx,
      );
      expect(result.details.results).toEqual([["ESLint", "Vitest"]]);
    });

    it("returns a cancel summary with cancelled=true when ctx.ui.batch resolves undefined", async () => {
      const batch = vi.fn().mockResolvedValue(undefined);
      const { tool, ctx } = getToolAndMockCtx(batch);
      const result = await tool.execute(
        "id",
        {
          method: "batch",
          title: "T",
          questions: [
            { method: "input", title: "Q1" },
            { method: "select", title: "Q2", options: ["a", "b"] },
          ],
        },
        undefined,
        undefined,
        ctx,
      );
      expect(result.details.cancelled).toBe(true);
      expect(result.details.results).toEqual([]);
      expect(result.content[0].text).toMatch(/cancelled batch/i);
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

// test-plan #E22 (add-pending-question-stack, D3): the `message` given to
// ask_user must reach `metadata.message` of the PromptBus request for every
// type. Exercises the REAL ask_user tool through the REAL ui-prompt-patch with
// a recording bus, so a carriage gap in either layer fails here.
describe("ask_user message carriage into prompt metadata (E22)", () => {
  function setup() {
    const requests: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
    const bus = {
      request: vi.fn(async (args: { type: string; metadata?: Record<string, unknown> }) => {
        requests.push(args);
        if (args.type === "batch") return { cancelled: false, answer: "[]" };
        return { cancelled: false, answer: args.type === "confirm" ? "true" : "A" };
      }),
      registerAdapter: vi.fn(),
    };
    const ctx: any = { hasUI: false, ui: {} };
    patchUiForPromptBus({ sessionId: "s1", connection: { send: vi.fn() }, getEmittedAssetHashes: () => new Set() } as any, ctx, bus as any);
    const pi = createMockPi();
    registerAskUserTool(pi as any);
    const tool = pi.registerTool.mock.calls[0][0];
    return { tool, ctx, requests };
  }

  const MESSAGE = "Context: why this is being asked and what each option does.";

  it.each([
    ["confirm", { method: "confirm", title: "Q" }],
    ["select", { method: "select", title: "Q", options: ["A", "B"] }],
    ["input", { method: "input", title: "Q" }],
  ])("%s carries message", async (type, params) => {
    const { tool, ctx, requests } = setup();
    await tool.execute("tc1", { ...params, message: MESSAGE }, undefined, undefined, ctx);
    expect(requests).toHaveLength(1);
    expect(requests[0].type).toBe(type);
    expect(requests[0].metadata?.message).toBe(MESSAGE);
  });

  it("batch carries the top-level message", async () => {
    const { tool, ctx, requests } = setup();
    await tool.execute(
      "tc1",
      { method: "batch", title: "Setup", message: MESSAGE, questions: [{ method: "input", title: "Name" }] },
      undefined,
      undefined,
      ctx,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].type).toBe("batch");
    expect(requests[0].metadata?.message).toBe(MESSAGE);
    expect(Array.isArray(requests[0].metadata?.questions)).toBe(true);
  });

  it("editor carries message through the patched ctx.ui.editor", async () => {
    const { ctx, requests } = setup();
    await ctx.ui.editor("Edit", "prefill", { message: MESSAGE });
    expect(requests[0].type).toBe("editor");
    expect(requests[0].metadata?.message).toBe(MESSAGE);
  });
});

// ── Inline Other — See change: add-ask-user-inline-other ───────────────
describe("ask_user inline Other opt-in", () => {
  function setup(answers: { select?: unknown; multiselect?: unknown; batch?: unknown } = {}) {
    const pi = createMockPi();
    registerAskUserTool(pi as any);
    const tool = pi.registerTool.mock.calls[0][0];
    const ctx = {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        select: vi.fn().mockResolvedValue("select" in answers ? answers.select : "A"),
        multiselect: vi.fn().mockResolvedValue("multiselect" in answers ? answers.multiselect : ["A"]),
        input: vi.fn().mockResolvedValue("hello"),
        batch: vi.fn().mockResolvedValue("batch" in answers ? answers.batch : []),
      },
    };
    return { tool, ctx };
  }
  const run = (tool: any, ctx: any, args: any) =>
    tool.execute("id", tool.prepareArguments(args), undefined, undefined, ctx);

  // #E9
  it.each([
    ["absent", {}, true],
    ["true", { allowOther: true }, true],
    ["false", { allowOther: false }, false],
  ])("single select/multiselect with allowOther %s", async (_n, extra, opted) => {
    const { tool, ctx } = setup();
    await run(tool, ctx, { method: "select", title: "Q", options: ["A", "B"], ...extra });
    await run(tool, ctx, { method: "multiselect", title: "Q", options: ["A", "B"], ...extra });
    const o1 = ctx.ui.select.mock.calls[0][2];
    const o2 = ctx.ui.multiselect.mock.calls[0][2];
    expect(o1?.allowOther === true).toBe(opted);
    expect(o2?.allowOther === true).toBe(opted);
  });

  it("confirm/input never get allowOther", async () => {
    const { tool, ctx } = setup();
    await run(tool, ctx, { method: "confirm", title: "Q", allowOther: true });
    await run(tool, ctx, { method: "input", title: "Q", allowOther: true });
    expect(JSON.stringify(ctx.ui.confirm.mock.calls[0])).not.toContain("allowOther");
    expect(ctx.ui.input.mock.calls[0][2]?.allowOther).toBeUndefined();
  });

  // #E10
  it("batch fan-out: top-level false, per-sub overrides win", async () => {
    const { tool, ctx } = setup();
    const questions = [
      { method: "select", title: "s0", options: ["A", "B"] },
      { method: "multiselect", title: "s1", options: ["A", "B"], allowOther: true },
      { method: "select", title: "s2", options: ["A", "B"], allowOther: false },
      { method: "confirm", title: "c" },
      { method: "input", title: "i" },
    ];
    await run(tool, ctx, { method: "batch", title: "T", allowOther: false, questions });
    const sent = ctx.ui.batch.mock.calls[0][1];
    expect(sent[0].allowOther).toBeUndefined();
    expect(sent[1].allowOther).toBe(true);
    expect(sent[2].allowOther).toBeUndefined();
    expect(sent[3].allowOther).toBeUndefined();
    expect(sent[4].allowOther).toBeUndefined();
    await run(tool, ctx, { method: "batch", title: "T", questions });
    expect(ctx.ui.batch.mock.calls[1][1][0].allowOther).toBe(true);
  });

  // #E11
  it("rescue: allowCustom alias and boolean coercion", async () => {
    const { tool } = setup();
    const a = tool.prepareArguments({ method: "select", title: "Q", options: ["A", "B"], allowCustom: false });
    expect(a.allowOther).toBe(false);
    expect("allowCustom" in a).toBe(false);
    expect(a.options).toEqual(["A", "B"]);
    expect(tool.prepareArguments({ method: "select", title: "Q", options: ["A"], allowOther: "false" }).allowOther).toBe(false);
    expect(tool.prepareArguments({ method: "select", title: "Q", options: ["A"], allowOther: "true" }).allowOther).toBe(true);
    const dropped = tool.prepareArguments({ method: "select", title: "Q", options: ["A"], allowOther: "yes" });
    expect("allowOther" in dropped).toBe(false);
    const c = tool.prepareArguments({ method: "select", title: "Q", options: ["A", "B"], allowCustom: true });
    expect(c.allowOther).toBe(true);
    expect(c.options).toEqual(["A", "B"]);
    const b = tool.prepareArguments({
      method: "batch",
      title: "T",
      questions: [{ method: "select", title: "s", options: ["A", "B"], allowCustom: false }],
    });
    expect(b.questions[0].allowOther).toBe(false);
    expect("allowCustom" in b.questions[0]).toBe(false);
  });

  it("rescue: alias loses to an explicit allowOther", () => {
    const { tool } = setup();
    const a = tool.prepareArguments({ method: "select", title: "Q", options: ["A"], allowOther: true, allowCustom: false });
    expect(a.allowOther).toBe(true);
    expect("allowCustom" in a).toBe(false);
  });

  it("rescued stringified allowOther:false reaches dispatch as an opt-out", async () => {
    const { tool, ctx } = setup();
    await run(tool, ctx, { method: "select", title: "Q", options: ["A", "B"], allowOther: "false" });
    expect(ctx.ui.select.mock.calls[0][2]?.allowOther).toBeUndefined();
  });

  // #E12
  it("result text flags custom answers; option answers unchanged", async () => {
    const sel = setup({ select: "C" });
    const r1 = await run(sel.tool, sel.ctx, { method: "select", title: "Q", options: ["A", "B"] });
    expect(r1.content[0].text).toBe('Custom answer (not one of the options).\nUser responded: "C"');
    expect(r1.details.result).toBe("C");

    const opt = setup({ select: "A" });
    const r2 = await run(opt.tool, opt.ctx, { method: "select", title: "Q", options: ["A", "B"] });
    expect(r2.content[0].text).toBe('User responded: "A"');

    const multi = setup({ multiselect: ["A", "D"] });
    const r3 = await run(multi.tool, multi.ctx, { method: "multiselect", title: "Q", options: ["A", "B"] });
    expect(r3.content[0].text).toBe('Custom values (not among the options): ["D"].\nUser responded: ["A","D"]');
    expect(r3.details.result).toEqual(["A", "D"]);

    const cancelled = setup({ select: undefined });
    const r4 = await run(cancelled.tool, cancelled.ctx, { method: "select", title: "Q", options: ["A", "B"] });
    expect(r4.content[0].text).toBe("User responded: undefined");
  });

  it("batch lines: (custom) only on select/multiselect", async () => {
    const { tool, ctx } = setup({
      batch: [{ value: "C" }, { value: "free text" }, { confirmed: true }, { values: ["A", "D"] }, { value: "A" }],
    });
    const r = await run(tool, ctx, {
      method: "batch",
      title: "T",
      questions: [
        { method: "select", title: "s", options: ["A", "B"] },
        { method: "input", title: "i" },
        { method: "confirm", title: "c" },
        { method: "multiselect", title: "m", options: ["A", "B"] },
        { method: "select", title: "s2", options: ["A", "B"] },
      ],
    });
    const lines = r.content[0].text.split("\n").filter((l: string) => /^ {2}\d\./.test(l));
    expect(lines[0]).toBe('  1. s: "C" (custom)');
    expect(lines[1]).toBe('  2. i: "free text"');
    expect(lines[2]).toBe("  3. c: true");
    expect(lines[3]).toBe('  4. m: ["A","D"] (custom)');
    expect(lines[4]).toBe('  5. s2: "A"');
    expect(r.details.results).toEqual(["C", "free text", true, ["A", "D"], "A"]);
  });

  // #E17
  it("select dispatch passes the title, options and allowOther opts", async () => {
    const { tool, ctx } = setup();
    await run(tool, ctx, { method: "select", title: "Pick one", options: ["A", "B"] });
    expect(ctx.ui.select).toHaveBeenCalledWith("Pick one", ["A", "B"], expect.objectContaining({ allowOther: true }));
  });

  // #E18
  it("existing rescues still work and empty args stay empty", async () => {
    const { tool, ctx } = setup({ batch: [{ value: "A" }] });
    const stringified = tool.prepareArguments({
      questions: JSON.stringify([{ method: "select", title: "Pick", options: ["a", "b"] }]),
    });
    expect(stringified.method).toBe("batch");
    expect(stringified.title).toBe("Pick");
    await expect(tool.execute("id", stringified, undefined, undefined, ctx)).resolves.toBeDefined();
    const wrapped = tool.prepareArguments({ questions: [{ method: "confirm", title: "Proceed?" }] });
    expect(wrapped.method).toBe("batch");
    const wrappedInput = tool.prepareArguments({
      method: "batch",
      questions: [{ question: "Q", input_type: { method: "select", options: ["x"] } }],
    });
    expect(wrappedInput.questions[0]).toMatchObject({ method: "select", title: "Q", options: ["x"] });
    const noTitle = tool.prepareArguments({ method: "batch", questions: [{ method: "confirm", question: "Proceed?" }] });
    expect(noTitle.title).toBe("Proceed?");
    const empty = tool.prepareArguments({});
    for (const k of ["method", "title", "questions", "allowOther"]) expect(k in empty).toBe(false);
  });
});

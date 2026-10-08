import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { parseSkillBlock } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCommandHandler } from "../command-handler.js";
import { expandPromptTemplateFromDisk, loadPromptTemplate } from "../prompt-expander.js";
import { tryDispatchExtensionCommand } from "../slash-dispatch.js";

// Mock the tool registry so `!`/`!!` bash resolution is deterministic
// across hosts. See change: register-bash-and-tool-install-help.
const registryMock = vi.hoisted(() => ({
  bash: { ok: true, path: "/usr/bin/bash" } as { ok: boolean; path: string | null },
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js", () => ({
  getDefaultRegistry: () => ({
    resolve: (name: string) =>
      name === "bash"
        ? {
            name: "bash",
            ok: registryMock.bash.ok,
            path: registryMock.bash.path,
            source: registryMock.bash.ok ? "system" : null,
            tried: [],
            resolvedAt: 0,
          }
        : { name, ok: false, path: null, source: null, tried: [], resolvedAt: 0 },
  }),
}));

// Spies wrapping the real prompt-expander / slash-dispatch implementations:
// team-confined sessions must NEVER call them (design D12, add-team-skill-access),
// while non-team tests delegate to the real bodies so pre-change behaviour and
// byte-identity stay observable. `readTemplate` is deliberately NOT mocked —
// the team route legitimately reads the granted SKILL.md through it.
vi.mock("../prompt-expander.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../prompt-expander.js")>();
  return {
    ...actual,
    loadPromptTemplate: vi.fn(actual.loadPromptTemplate),
    expandPromptTemplateFromDisk: vi.fn(actual.expandPromptTemplateFromDisk),
  };
});
vi.mock("../slash-dispatch.js", () => ({
  tryDispatchExtensionCommand: vi.fn(),
}));

const tmpDir = join(import.meta.dirname ?? __dirname, "__tmp_team_skill_test__");
const promptsDir = join(tmpDir, ".pi", "prompts");
const reviewRoot = join(tmpDir, ".pi", "skills", "review");
const reviewSkillMd = join(reviewRoot, "SKILL.md");
// A granted root OUTSIDE the session cwd: proves the team route expands from
// the granted root itself, never from a cwd scan or the registry.
const soloRoot = join(tmpDir, "granted-roots", "solo");
const soloSkillMd = join(soloRoot, "SKILL.md");

function grantEnv(entries: Array<{ name: string; root: string }>): void {
  process.env.PI_EXT_TEAM_TOOLS = "chat";
  process.env.PI_EXT_TEAM_SKILLS = JSON.stringify(entries);
}

function createMockPi() {
  return {
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    getCommands: vi.fn().mockReturnValue([
      { name: "ctx-stats", description: "Context stats", source: "extension" as const },
    ]),
    setSessionName: vi.fn(),
    getSessionName: vi.fn(),
    on: vi.fn(),
    exec: vi.fn(),
    events: { emit: vi.fn() },
  };
}

/** The two settlement frames a refused `/skill:` must emit (design D12). */
function expectRefusal(eventSink: ReturnType<typeof vi.fn>): void {
  expect(eventSink).toHaveBeenCalledTimes(2);
  expect(eventSink).toHaveBeenCalledWith({ type: "prompt_received", sessionId: "s1", fresh: false });
  expect(eventSink).toHaveBeenCalledWith({
    type: "event_forward",
    sessionId: "s1",
    event: {
      eventType: "command_feedback",
      timestamp: expect.any(Number),
      data: { command: "skill", status: "error", message: "skill not available" },
    },
  });
}

describe("team-confined /skill: route (add-team-skill-access)", () => {
  let cwdSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    mkdirSync(promptsDir, { recursive: true });
    mkdirSync(reviewRoot, { recursive: true });
    writeFileSync(reviewSkillMd, "---\nname: review\ndescription: Review skill\n---\nReview the code carefully");
    writeFileSync(join(promptsDir, "deploy.md"), "---\ndescription: deploy\n---\nDeploy to production");
    writeFileSync(join(promptsDir, "x.md"), "---\nexecutable: bash\n---\necho EXEC-RAN");
    mkdirSync(soloRoot, { recursive: true });
    writeFileSync(soloSkillMd, "---\nname: solo\ndescription: Outside cwd\n---\nSolo body");
  });

  afterEach(() => {
    delete process.env.PI_EXT_TEAM_TOOLS;
    delete process.env.PI_EXT_TEAM_SKILLS;
    cwdSpy?.mockRestore();
    cwdSpy = undefined;
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // 8.36 (test-plan #E31): the team envelope is byte-identical to the
  // non-team expandPromptTemplateFromDisk expansion of the same file, so
  // parseSkillBlock / SkillInvocationCard keep working unchanged.
  it("8.36 (E31): team envelope is byte-identical to the non-team expansion; parseSkillBlock round-trips", async () => {
    grantEnv([{ name: "review", root: reviewRoot }]);
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({
      type: "send_prompt",
      sessionId: "s1",
      text: "/skill:review check it",
    } as ServerToExtensionMessage);

    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
    const [teamText, teamOptions] = pi.sendUserMessage.mock.calls[0];
    // Exactly the plain deliverAs option — no expandPromptTemplates flag.
    expect(teamOptions).toEqual({ deliverAs: "followUp" });
    const nonTeamText = expandPromptTemplateFromDisk("/skill:review check it", tmpDir);
    expect(teamText).toBe(nonTeamText);
    const parsed = parseSkillBlock(teamText);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("review");
    expect(parsed!.args).toBe("check it");
    expect(parsed!.condensed).toBe("/skill:review check it");
    expect(parsed!.location).toBe(reviewSkillMd);
  });

  describe("8.37 (E32): team routing carve-out", () => {
    it("granted single-line /skill: expands once, multi-line /skill: to the same envelope", async () => {
      grantEnv([{ name: "review", root: reviewRoot }]);
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/skill:review x" } as ServerToExtensionMessage);
      expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
      const [singleText] = pi.sendUserMessage.mock.calls[0];
      expect(singleText).toMatch(/^<skill name="review"/);
      expect(singleText).toMatch(/\n\nx$/);

      pi.sendUserMessage.mockClear();
      await handler.handle({
        type: "send_prompt",
        sessionId: "s1",
        text: "/skill:review\nx",
      } as ServerToExtensionMessage);
      expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
      const [multiText] = pi.sendUserMessage.mock.calls[0];
      expect(multiText).toBe(singleText);
    });

    it("granted /skill: acks the promptId it delivered (idle)", async () => {
      grantEnv([{ name: "review", root: reviewRoot }]);
      const pi = createMockPi();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink });

      await handler.handle({
        type: "send_prompt",
        sessionId: "s1",
        text: "/skill:review x",
        promptId: "p1",
      } as ServerToExtensionMessage);

      expect(eventSink).toHaveBeenCalledWith({ type: "prompt_received", sessionId: "s1", fresh: true, promptId: "p1" });
    });

    it("a granted root outside the session cwd still expands from its own SKILL.md", async () => {
      grantEnv([
        { name: "review", root: reviewRoot },
        { name: "solo", root: soloRoot },
      ]);
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/skill:solo" } as ServerToExtensionMessage);

      expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
      const [text] = pi.sendUserMessage.mock.calls[0];
      expect(text).toContain('name="solo"');
      expect(text).toContain(`location="${soloSkillMd}"`);
      expect(text).toContain("Solo body");
    });

    it("refuses an ungranted name, single or multi-line; never queued", async () => {
      grantEnv([{ name: "review", root: reviewRoot }]);
      const pi = createMockPi();
      const eventSink = vi.fn();
      const onFollowupSent = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink, onFollowupSent, isStreaming: () => true });

      for (const text of ["/skill:other", "/skill:other\nx"]) {
        eventSink.mockClear();
        await handler.handle({ type: "send_prompt", sessionId: "s1", text } as ServerToExtensionMessage);
        expectRefusal(eventSink);
      }
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      // Streaming with delivery=followUp would buffer a normal prompt — a
      // refused /skill: must never enter the queue (no queue_update).
      expect(onFollowupSent).not.toHaveBeenCalled();
    });

    it("multi-line other `/` text is sent verbatim (no disk/registry expansion)", async () => {
      grantEnv([{ name: "review", root: reviewRoot }]);
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await handler.handle({
        type: "send_prompt",
        sessionId: "s1",
        text: "/deploy\nnow",
      } as ServerToExtensionMessage);

      expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
      expect(pi.sendUserMessage).toHaveBeenCalledWith("/deploy\nnow", { deliverAs: "followUp" });
      expect(expandPromptTemplateFromDisk).not.toHaveBeenCalled();
    });

    it("single-line exec template `/x` is dropped; multi-line `/x\\nargs` is sent verbatim; bash never runs", async () => {
      grantEnv([{ name: "review", root: reviewRoot }]);
      const pi = createMockPi();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/x" } as ServerToExtensionMessage);
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(pi.exec).not.toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalledTimes(1);
      expect(eventSink).toHaveBeenCalledWith({ type: "prompt_received", sessionId: "s1", fresh: false });

      eventSink.mockClear();
      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/x\nargs" } as ServerToExtensionMessage);
      expect(pi.sendUserMessage).toHaveBeenCalledWith("/x\nargs", { deliverAs: "followUp" });
      expect(pi.exec).not.toHaveBeenCalled();
      expect(expandPromptTemplateFromDisk).not.toHaveBeenCalled();
    });

    it("extension command, bang and exec inputs dispatch nothing; /compact and plain text keep working", async () => {
      grantEnv([{ name: "review", root: reviewRoot }]);
      const pi = createMockPi();
      const sessionPrompt = vi.fn();
      const compact = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { sessionPrompt, compact });

      // Dropped routes (single-line slash, bash): settled, never dispatched.
      for (const text of ["/ctx-stats", "!id"]) {
        pi.sendUserMessage.mockClear();
        await handler.handle({ type: "send_prompt", sessionId: "s1", text } as ServerToExtensionMessage);
        expect(pi.sendUserMessage).not.toHaveBeenCalled();
        expect(pi.exec).not.toHaveBeenCalled();
      }
      // /compact keeps its existing team allowance.
      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/compact" } as ServerToExtensionMessage);
      expect(compact).toHaveBeenCalledWith({});
      // Plain text is a normal passthrough send.
      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "just a question" } as ServerToExtensionMessage);
      expect(pi.sendUserMessage).toHaveBeenCalledWith("just a question", { deliverAs: "followUp" });
    });

    it("granted /skill: while streaming buffers the ENVELOPE through the normal follow-up routing", async () => {
      grantEnv([{ name: "review", root: reviewRoot }]);
      const pi = createMockPi();
      const eventSink = vi.fn();
      const onFollowupSent = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink, onFollowupSent, isStreaming: () => true });

      await handler.handle({
        type: "send_prompt",
        sessionId: "s1",
        text: "/skill:review x",
        delivery: "followUp",
      } as ServerToExtensionMessage);

      // parseSkillCommand ran BEFORE the buffering decision: the queued text
      // is the expanded envelope, not the raw command.
      expect(onFollowupSent).toHaveBeenCalledTimes(1);
      expect(onFollowupSent.mock.calls[0][0]).toMatch(/^<skill name="review"/);
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalledWith({ type: "prompt_received", sessionId: "s1", fresh: false });
    });

    it("invariant: nothing dispatches, expands or executes across all manifest inputs", async () => {
      grantEnv([{ name: "review", root: reviewRoot }]);
      const pi = createMockPi();
      const sessionPrompt = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { sessionPrompt });

      const inputs = [
        "/skill:review x",
        "/skill:review\nx",
        "/skill:other",
        "/skill:other\nx",
        "/deploy\nnow",
        "/x",
        "/x\nargs",
        "/ctx-stats",
        "!id",
        "/compact",
        "plain text",
      ];
      for (const text of inputs) {
        await handler.handle({ type: "send_prompt", sessionId: "s1", text } as ServerToExtensionMessage);
      }

      expect(expandPromptTemplateFromDisk).not.toHaveBeenCalled();
      expect(loadPromptTemplate).not.toHaveBeenCalled();
      expect(tryDispatchExtensionCommand).not.toHaveBeenCalled();
      expect(sessionPrompt).not.toHaveBeenCalled();
      expect(pi.exec).not.toHaveBeenCalled();
    });
  });

  describe("8.38 (E33): non-team regression — same inputs, no PI_EXT_TEAM_TOOLS", () => {
    it("single-line /skill: still routes through sessionPrompt", async () => {
      const pi = createMockPi();
      const sessionPrompt = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { sessionPrompt });

      await handler.handle({
        type: "send_prompt",
        sessionId: "s1",
        text: "/skill:review x",
      } as ServerToExtensionMessage);

      expect(sessionPrompt).toHaveBeenCalledWith("/skill:review x", undefined, undefined);
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
    });

    it("multi-line /deploy still expands from disk; multi-line unknown slash stays verbatim", async () => {
      cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/deploy\nnow" } as ServerToExtensionMessage);
      expect(expandPromptTemplateFromDisk).toHaveBeenCalledTimes(1);
      expect(pi.sendUserMessage).toHaveBeenCalledWith("Deploy to production\n\nnow", { deliverAs: "followUp" });

      pi.sendUserMessage.mockClear();
      await handler.handle({
        type: "send_prompt",
        sessionId: "s1",
        text: "/skill:other\nbody",
      } as ServerToExtensionMessage);
      expect(pi.sendUserMessage).toHaveBeenCalledWith("/skill:other\nbody", { deliverAs: "followUp" });
    });

    it("bang routes still run bash in non-team sessions", async () => {
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "!id" } as ServerToExtensionMessage);

      expect(pi.exec).toHaveBeenCalledWith("/usr/bin/bash", ["-c", "id"], expect.objectContaining({ timeout: 30000 }));
    });
  });

  describe("8.39 (X1): unreadable granted skill", () => {
    it("a deleted granted SKILL.md refuses; no send, no unexpanded fallback", async () => {
      grantEnv([{ name: "review", root: reviewRoot }]);
      rmSync(reviewSkillMd);
      const pi = createMockPi();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/skill:review go" } as ServerToExtensionMessage);

      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expectRefusal(eventSink);
    });

    it("a vanished granted root refuses the same way", async () => {
      grantEnv([{ name: "review", root: reviewRoot }]);
      rmSync(reviewRoot, { recursive: true });
      const pi = createMockPi();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/skill:review go" } as ServerToExtensionMessage);

      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expectRefusal(eventSink);
    });

    it("missing, malformed or wrong-shape PI_EXT_TEAM_SKILLS fails closed", async () => {
      const pi = createMockPi();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink });

      process.env.PI_EXT_TEAM_TOOLS = "chat";
      // Missing entirely.
      delete process.env.PI_EXT_TEAM_SKILLS;
      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/skill:review" } as ServerToExtensionMessage);
      expectRefusal(eventSink);

      // Unparseable JSON.
      eventSink.mockClear();
      process.env.PI_EXT_TEAM_SKILLS = "not json";
      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/skill:review" } as ServerToExtensionMessage);
      expectRefusal(eventSink);

      // Wrong entry shape.
      eventSink.mockClear();
      process.env.PI_EXT_TEAM_SKILLS = JSON.stringify([{ name: "review" }]);
      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/skill:review" } as ServerToExtensionMessage);
      expectRefusal(eventSink);

      expect(pi.sendUserMessage).not.toHaveBeenCalled();
    });
  });
});

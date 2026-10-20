/**
 * Spikes 0.1 / 0.2 / 0.3 of `add-supervised-tool-approval`, answered against pi's
 * REAL runtime (`@earendil-works/pi-coding-agent` 1.3.0): a real `AgentSession`
 * (agent loop + ExtensionRunner + nested-tool-call runner) driven by pi-ai's
 * scriptable faux provider — no API key, no network.
 *
 *  - X10 / spike 0.2 — does `tool_execution_end` fire for a tool blocked by a LATER
 *    `tool_call` handler (so the fan-out permit is released)?
 *      YES. Any `tool_call` block makes `prepareToolCall` return an "immediate"
 *      result, and the agent loop always emits `tool_execution_end` for an
 *      immediate result (agent-core `agent-loop.js` sequential ~L388-395,
 *      parallel ~L445-455; forwarded to extensions by `agent-session.js` ~L958).
 *  - X11 / spike 0.1 — does an `Agent` child's tool call reach the parent's
 *    `tool_call`? NO. The child is its OWN `AgentSession` (own ExtensionRunner),
 *    created by pi-dashboard-subagents `extensions/agent.ts` via `createAgentSession`.
 *  - spike 0.3 — do `codemode` script calls traverse `tool_call` individually?
 *    YES: `ctx.executeTool` → `_beforeToolCall(ctx, parentId)` → `emitToolCall`
 *    with `parentToolCallId` (codemode `execute.js` ~L421, `agent-session.js` ~L405).
 * @structural-pin the re-entry test pins that bridge.ts returns before registering any handler, so the supervised gate is absent in an Agent child.
 */
import * as fs from "node:fs";
import os from "node:os";
import nodePath, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FanoutAdmissionGate } from "../../subagent-fanout-admission.js";
import { fakePrompter, flush, makeGate } from "./harness.js";

// pi's published index.d.ts re-exports `.ts` specifiers the repo `tsc` cannot follow; use a local shape.
const loadPi = async (): Promise<any> => import("@earendil-works/pi-coding-agent");
const loadAi = async (): Promise<any> => import("@earendil-works/pi-ai");

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const FAUX_MODEL = {
  id: "faux-1",
  name: "Faux",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8000,
  maxTokens: 1000,
};

/** A real pi session whose model is a scripted faux provider; `factories` are inline extensions. */
async function startSession(opts: {
  responses: unknown[];
  factories: Array<(pi: any) => void>;
  withCodemode?: boolean;
}) {
  const pi = await loadPi();
  const ai = await loadAi();
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "sup-spike-"));
  tmpDirs.push(tmp);
  const agentDir = nodePath.join(tmp, "agent");
  fs.mkdirSync(agentDir, { recursive: true });
  const faux = ai.fauxProvider({ api: "faux" });
  faux.setResponses(opts.responses);
  const registerFaux = (p: any) =>
    p.registerProvider("faux", { baseUrl: "http://localhost:0", apiKey: "k", api: "faux", streamSimple: faux.provider.streamSimple, models: [FAUX_MODEL] });
  const loader = new pi.DefaultResourceLoader({
    cwd: tmp,
    agentDir,
    noExtensions: true,
    extensionFactories: [registerFaux, ...(opts.withCodemode ? [pi.createCodemodeExtension({ mode: "on" })] : []), ...opts.factories],
  });
  await loader.reload();
  const settingsManager = pi.SettingsManager.create(tmp, agentDir);
  if (opts.withCodemode) settingsManager.applyOverrides({ defaultTools: ["+codemode"] });
  const { session } = await pi.createAgentSession({
    model: faux.getModel(),
    cwd: tmp,
    agentDir,
    resourceLoader: loader,
    settingsManager,
    sessionManager: pi.SessionManager.inMemory(tmp),
  });
  await session.bindExtensions({});
  return { session, tmp, agentDir, faux, pi, ai };
}

const toolCall = (ai: any, name: string, args: Record<string, unknown>, id: string) => ai.fauxToolCall(name, args, { id });
const toolUse = (ai: any, calls: unknown[]) => ai.fauxAssistantMessage(calls, { stopReason: "toolUse" });

const AGENT_TOOL = {
  name: "Agent",
  label: "Agent",
  description: "stub subagent tool",
  parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
  execute: async () => ({ content: [{ type: "text", text: "child result" }], details: {} }),
};

describe("X10 — spike 0.2: tool_execution_end fires for a tool blocked by a LATER handler", () => {
  it.each([true, false])("fan-out permits (release wired: %s) on a supervised deny of limit+1 Agent calls", async (wireRelease) => {
    const ai = await loadAi();
    const LIMIT = 2;
    const fanout = new FanoutAdmissionGate({
      resolveConfig: () => ({ maxConcurrentSubagents: LIMIT, thresholds: {} }),
      saturation: { read: () => ({ saturated: false, reading: {} }) },
    });
    const prompter = fakePrompter();
    const sup = makeGate({ prompter });
    const answerAll = setInterval(() => {
      // the operator denies every approval as soon as it opens
      for (let i = 0; i < prompter.reqs.length; i++) if (prompter.isPending(i)) prompter.answer("Deny", "dashboard-default", i);
    }, 1);
    const inFlightSeen: number[] = [];
    const ends: Array<{ id: string; isError: boolean; text: string }> = [];
    try {
      const { session } = await startSession({
        responses: [
          toolUse(
            ai,
            Array.from({ length: LIMIT + 1 }, (_, i) => toolCall(ai, "Agent", { prompt: `task ${i}` }, `ag${i + 1}`)),
          ),
          ai.fauxAssistantMessage("done"),
        ],
        factories: [
          (pi) => {
            pi.registerTool(AGENT_TOOL);
            // registration order = the bridge's: fan-out admission first, supervised gate AFTER
            pi.on("tool_call", (e: any) => {
              const r = fanout.onToolCall(e);
              inFlightSeen.push(fanout.inFlight);
              return r;
            });
            pi.on("tool_call", (e: any, ctx: any) => sup.gate.handler(e, { hasUI: true, cwd: ctx.cwd }));
            pi.on("tool_execution_end", (e: any) => {
              if (wireRelease) fanout.onExecutionEnd(e);
              ends.push({ id: e.toolCallId, isError: e.isError, text: JSON.stringify(e.result?.content ?? "") });
            });
          },
        ],
      });
      await session.prompt("go");
      session.dispose();
    } finally {
      clearInterval(answerAll);
    }
    // `tool_execution_end` fired for EVERY call, each blocked by the supervised gate …
    expect(ends.map((e) => e.id).sort()).toEqual(["ag1", "ag2", "ag3"]);
    if (!wireRelease) {
      // CONTROL: without the release the third call is refused by fan-out, so the scenario discriminates
      expect(fanout.counters.fanoutRefused).toBe(1);
      expect(fanout.inFlight).toBe(LIMIT);
      return;
    }
    for (const e of ends) {
      expect(e.isError).toBe(true);
      expect(e.text).toContain("supervised: denied");
    }
    // … and releasing on that event returned each permit, so call limit+1 was admitted too
    expect(fanout.counters).toMatchObject({ fanoutAdmitted: LIMIT + 1, fanoutRefused: 0 });
    expect(fanout.inFlight).toBe(0);
    expect(Math.max(...inFlightSeen)).toBeLessThanOrEqual(1); // the permit never accumulates
  }, 30_000);
});

describe("X11 — spike 0.1: an Agent child's tool calls do NOT reach the parent's tool_call", () => {
  it("the child is its own AgentSession: the parent handler sees only the Agent call itself", async () => {
    const ai = await loadAi();
    const pi = await loadPi();
    const parentSeen: Array<{ name: string; parent?: string }> = [];
    const childSeen: string[] = [];

    // The Agent tool mirrors pi-dashboard-subagents `extensions/agent.ts`: `createAgentSession`
    // with an in-memory SessionManager, then prompt it.
    const childTmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "sup-spike-child-"));
    tmpDirs.push(childTmp);
    const runChild = async () => {
      const faux = ai.fauxProvider({ api: "faux" });
      faux.setResponses([toolUse(ai, [toolCall(ai, "bash", { command: "echo child" }, "cb1")]), ai.fauxAssistantMessage("child done")]);
      const loader = new pi.DefaultResourceLoader({
        cwd: childTmp,
        agentDir: nodePath.join(childTmp, "agent"),
        noExtensions: true,
        extensionFactories: [
          (p: any) =>
            p.registerProvider("faux", { baseUrl: "http://localhost:0", apiKey: "k", api: "faux", streamSimple: faux.provider.streamSimple, models: [FAUX_MODEL] }),
        ],
      });
      await loader.reload();
      const { session } = await pi.createAgentSession({
        model: faux.getModel(),
        cwd: childTmp,
        agentDir: nodePath.join(childTmp, "agent"),
        resourceLoader: loader,
        settingsManager: pi.SettingsManager.create(childTmp, nodePath.join(childTmp, "agent")),
        sessionManager: pi.SessionManager.inMemory(childTmp),
      });
      session.subscribe((ev: any) => {
        if (ev.type === "tool_execution_end") childSeen.push(ev.toolName);
      });
      await session.prompt("child task");
      session.dispose();
    };

    const { session } = await startSession({
      responses: [toolUse(ai, [toolCall(ai, "Agent", { prompt: "run bash" }, "ag1")]), ai.fauxAssistantMessage("done")],
      factories: [
        (p) => {
          p.registerTool({
            ...AGENT_TOOL,
            execute: async () => {
              await runChild();
              return { content: [{ type: "text", text: "child finished" }], details: {} };
            },
          });
          p.on("tool_call", (e: any) => {
            parentSeen.push({ name: e.toolName, parent: e.parentToolCallId });
          });
        },
      ],
    });
    await session.prompt("go");
    session.dispose();

    expect(childSeen).toEqual(["bash"]); // the child really ran its own bash call
    expect(parentSeen).toEqual([{ name: "Agent", parent: undefined }]); // …which the parent never saw
  }, 30_000);

  it("and the bridge (hence the supervised gate) never registers in the child: re-entry returns before any pi.on", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const bridge = fs.readFileSync(join(here, "..", "..", "bridge.ts"), "utf8");
    const init = bridge.slice(bridge.indexOf("function initBridge(pi: ExtensionAPI)"));
    const guard = init.indexOf("teardownPreviousIncarnation(prev, () => isBridgeReentry(prev, pi))");
    expect(guard).toBeGreaterThan(-1);
    expect(init.slice(guard, guard + 120)).toContain("return;");
    expect(guard).toBeLessThan(init.indexOf('pi.on("tool_call"'));
    expect(guard).toBeLessThan(init.indexOf("createSupervisedGateForBridge("));
  });
});

describe("spike 0.3 — codemode script calls traverse tool_call individually", () => {
  it("a nested tools.bash() call reaches tool_call with parentToolCallId = the codemode call id", async () => {
    const ai = await loadAi();
    const seen: Array<{ name: string; id: string; parent?: string }> = [];
    const { session } = await startSession({
      withCodemode: true,
      responses: [
        toolUse(ai, [toolCall(ai, "codemode", { code: "return await tools.bash({ command: 'echo nested' });" }, "cm1")]),
        ai.fauxAssistantMessage("done"),
      ],
      factories: [
        (p) => {
          p.on("tool_call", (e: any) => {
            seen.push({ name: e.toolName, id: e.toolCallId, parent: e.parentToolCallId });
            // block the nested call so nothing runs; the script rejects with the block reason
            if (e.toolName === "bash") return { block: true, reason: "supervised: denied" };
            return undefined;
          });
        },
      ],
    });
    await session.prompt("go");
    session.dispose();
    expect(seen[0]).toEqual({ name: "codemode", id: "cm1", parent: undefined });
    const nested = seen.find((s) => s.name === "bash");
    expect(nested).toBeTruthy();
    expect(nested).toMatchObject({ parent: "cm1" });
    expect(nested!.id).toMatch(/^cm1\//);
  }, 30_000);

  it("the supervised gate decides a nested bash call individually (prompt per nested call)", async () => {
    const ai = await loadAi();
    const prompter = fakePrompter();
    const sup = makeGate({ prompter });
    const answerAll = setInterval(() => {
      for (let i = 0; i < prompter.reqs.length; i++) if (prompter.isPending(i)) prompter.answer("Deny", "dashboard-default", i);
    }, 1);
    try {
      const { session } = await startSession({
        withCodemode: true,
        responses: [
          toolUse(ai, [toolCall(ai, "codemode", { code: "await Promise.allSettled([tools.bash({command:'a'}), tools.bash({command:'b'})]); return 'ok';" }, "cm2")]),
          ai.fauxAssistantMessage("done"),
        ],
        factories: [(p) => p.on("tool_call", (e: any, ctx: any) => sup.gate.handler(e, { hasUI: true, cwd: ctx.cwd }))],
      });
      await session.prompt("go");
      session.dispose();
    } finally {
      clearInterval(answerAll);
    }
    await flush();
    // codemode itself is a wrapper (not in the risky set, not logged as unclassified); the two nested
    // bash calls each raised their own approval, serialised by the per-session mutex
    expect(prompter.reqs.map((r) => (r.metadata as { command: string }).command).sort()).toEqual(["a", "b"]);
    expect(sup.logs.filter((l) => l.includes("unclassified"))).toHaveLength(0);
  }, 30_000);
});

/**
 * Gateway ↔ team-controls integration (change: add-chat-gateway-team-controls).
 * Scenarios: X11 (no path without a grant), X19/X20/X21 (question gating),
 * X24 (provenance), X26 (log unreachable from chat).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecordingAdapter } from "../../adapters/__tests__/recording-adapter.js";
import type { InboundMessage, ResolvedConfig } from "../../shared/types.js";
import { createChatGateway } from "../gateway.js";
import { createBindingStore, createSpawnCorrelator } from "../routing.js";
import { createCommandLog } from "../team/audit.js";
import { createTeamController } from "../team/controller.js";
import { validateTeamControls } from "../team/team-config.js";
import { createFakeSeam } from "./fake-seam.js";

const WORKSPACES = [
  { id: "ws_1", name: "Team", folders: ["/repo"] },
  { id: "ws_2", name: "Other", folders: ["/repo2"] },
];

function makeConfig(): ResolvedConfig {
  return {
    enabled: true,
    token: "t",
    allowedRoots: ["/repo"],
    fixedMap: {},
    allowlist: ["alice", "bob", "carol", "eve"],
    admins: ["alice"],
    groupChannels: [],
    steerPrefix: "!",
    editThrottleMs: 0,
  };
}

describe("gateway team-controls integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-team-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setup(
    opts: { assignRefResult?: boolean; onTrustFailure?: (reason: string) => void } = {},
  ) {
    const seam = createFakeSeam();
    if (opts.assignRefResult !== undefined) seam.assignRefResult = opts.assignRefResult;
    seam.sessions.push({ id: "s1", cwd: "/repo/proj", status: "active" });
    const adapter = new RecordingAdapter();
    const store = createBindingStore({ filePath: path.join(tmpDir, "bindings.json") });
    store.set({
      platform: "discord",
      channelId: "chan1",
      sessionId: "s1",
      cwd: "/repo/proj",
      boundBy: "alice",
      source: "spawn",
      isDM: true,
      createdAt: 1,
    });
    const validated = validateTeamControls({
      ceiling: "operate",
      bindings: {
        ws_1: {
          // `frank` has a tier mapping but is NOT on the L1 allowlist (X17).
          principals: {
            alice: "control",
            bob: "control",
            carol: "control",
            eve: "observe",
            frank: "control",
          },
          mirrorLevel: "names-only",
        },
        // `carol` is `operate` here but not an admin (X18).
        ws_2: { principals: { carol: "operate" } },
      },
    });
    if (!validated.ok) throw new Error(validated.reason);
    const log = createCommandLog({ limit: 1_000 });
    const team = createTeamController({
      config: validated.value,
      log,
      listWorkspaces: () => WORKSPACES,
      ...(opts.onTrustFailure ? { onTrustFailure: opts.onTrustFailure } : {}),
      channelBindings: () =>
        new Map([
          ["chan1", "ws_1"],
          ["chan2", "ws_2"],
        ]),
    });
    const gateway = createChatGateway({
      platform: "discord",
      seam,
      adapter,
      config: makeConfig(),
      store,
      correlator: createSpawnCorrelator(),
      team,
    });
    return { seam, adapter, gateway, log, team, teamConfig: validated.value };
  }

  const msg = (userId: string, text: string): InboundMessage => ({
    platform: "discord",
    channelId: "chan1",
    userId,
    text,
    isDM: true,
    startedAt: 1,
  });

  it("X11: a permitted control principal's prompt reaches the session", async () => {
    const { seam, gateway } = setup();
    await gateway.start();
    await gateway.handleInbound(msg("alice", "hello"));
    expect(seam.sentPrompts).toHaveLength(1);
  });

  it("X17: a tier mapping cannot widen L1 — a non-allowlisted principal is refused", async () => {
    const { seam, adapter, gateway } = setup();
    await gateway.start();
    await gateway.handleInbound(msg("frank", "drive the session"));
    expect(seam.sentPrompts).toHaveLength(0);
    expect(adapter.sent.some((m) => m.content.includes("not_allowlisted"))).toBe(true);
  });

  it("X18: a tier cannot widen L2 — a non-admin cannot bind a channel", async () => {
    const { seam, adapter, gateway } = setup();
    await gateway.start();
    await gateway.handleInbound({ ...msg("carol", "bind here"), channelId: "chan2" });
    expect(seam.spawns).toHaveLength(0);
    expect(adapter.sent.some((m) => m.content.includes("not_admin"))).toBe(true);
  });

  it("X11: a below-control principal's prompt is refused and reaches no session", async () => {
    const { seam, adapter, gateway } = setup();
    await gateway.start();
    await gateway.handleInbound(msg("eve", "please run this"));
    expect(seam.sentPrompts).toHaveLength(0);
    expect(adapter.sent.some((m) => m.content.includes("insufficient_tier"))).toBe(true);
  });

  it("X13: a cwd supplied as free text is never used to resolve a target", async () => {
    const { seam, gateway } = setup();
    await gateway.start();
    await gateway.handleInbound(msg("alice", "spawn in /etc/../root and run rm -rf"));
    // The text is delivered verbatim as a prompt to the bound session; it never
    // triggers a spawn or changes the binding.
    expect(seam.spawns).toHaveLength(0);
    expect(seam.sentPrompts).toHaveLength(1);
    expect(seam.sentPrompts[0].text).toContain("/etc/../root");
  });

  it("X24: a chat-driven prompt attaches persisted provenance", async () => {
    const { seam, gateway } = setup();
    await gateway.start();
    await gateway.handleInbound(msg("alice", "hello"));
    expect(seam.assignedRefs).toEqual([
      { sessionId: "s1", ref: expect.objectContaining({ principal: "alice", workspaceId: "ws_1" }) },
    ]);
  });

  it("X26: the command log is unreachable from chat", async () => {
    const { seam, adapter, gateway } = setup();
    await gateway.start();
    await gateway.handleInbound(msg("alice", "!command log"));
    expect(seam.sentPrompts).toHaveLength(0);
    expect(adapter.sent.some((m) => m.content.includes("only readable from the dashboard"))).toBe(true);
  });

  it("X10: a trusted-gated verb no-op marks the layer unhealthy and refuses the command", async () => {
    const failures: string[] = [];
    const { seam, adapter, gateway, team } = setup({
      assignRefResult: false,
      onTrustFailure: (reason) => failures.push(reason),
    });
    await gateway.start();
    await gateway.handleInbound(msg("alice", "drive the session"));

    // No phantom success: the prompt never reaches the session, and the
    // refusal names the missing trust level rather than an unrelated reason.
    expect(seam.sentPrompts).toHaveLength(0);
    const refusal = adapter.sent.find((m) => m.content.startsWith("Refused:"));
    expect(refusal?.content).toMatch(/trust level/);
    expect(refusal?.content).toMatch(/assignSessionRef/);

    // The plugin reports itself unhealthy exactly once, naming the same reason.
    expect(failures).toHaveLength(1);
    expect(team.trustHealth()).toEqual({ healthy: false, reason: failures[0] });
  });

  /** Flush the mirror lane's async posts (microtasks + one macrotask). */
  const flush = () => new Promise((r) => setTimeout(r, 0));

  /** A bridge event frame carrying a tool call, as `subscribeSession` delivers it. */
  const toolFrame = (toolName: string, args: Record<string, unknown>) => ({
    type: "event",
    event: { eventType: "tool_execution_start", data: { toolName, args } },
  });

  const toolEndFrame = (toolName: string, output: string) => ({
    type: "event",
    event: { eventType: "tool_execution_end", data: { toolName, output } },
  });

  const allSent = (adapter: { sent: Array<{ content: string }> }) =>
    adapter.sent.map((m) => m.content).join("\n");

  it("E24: at the default level the thread shows the tool and target basename, never the diff or output", async () => {
    const { adapter, gateway } = setup();
    await gateway.start();
    gateway.handleFrame(
      "s1",
      toolFrame("Edit", {
        file_path: "/repo/src/foo.ts",
        oldText: "SECRET_OLD",
        newText: "SECRET_NEW",
      }),
    );
    gateway.handleFrame("s1", toolEndFrame("Bash", "SECRET_OUTPUT"));
    await flush();

    const out = allSent(adapter);
    // The thread shows that an edit tool ran and its target's basename...
    expect(out).toContain("Edit");
    expect(out).toContain("foo.ts");
    // ...and not the file's contents, the diff, or the command's output.
    expect(out).not.toContain("SECRET_OLD");
    expect(out).not.toContain("SECRET_NEW");
    expect(out).not.toContain("SECRET_OUTPUT");
  });

  it("E25: a level change is forward-only — already-posted messages are not rewritten", async () => {
    const { adapter, gateway, teamConfig } = setup();
    await gateway.start();
    for (let i = 0; i < 3; i++) {
      gateway.handleFrame("s1", toolFrame("Read", { file_path: `/repo/f${i}.ts` }));
      await flush();
    }
    const before = adapter.sent.map((m) => m.content);
    expect(before).toHaveLength(3);
    expect(before[0]).not.toContain("args");

    // Raise the level mid-session, then emit ONE further event.
    teamConfig.bindings.ws_1.mirrorLevel = "full-transcript";
    gateway.handleFrame("s1", toolFrame("Edit", { file_path: "/repo/new.ts", newText: "FRESH" }));
    await flush();

    // The new event renders in full...
    const last = adapter.sent[adapter.sent.length - 1].content;
    expect(last).toContain("FRESH");
    // ...and the three earlier posts are byte-identical (not back-filled).
    expect(adapter.sent.slice(0, 3).map((m) => m.content)).toEqual(before);
  });

  it("X15: mirroring survives disarm while every action-bearing request refuses", async () => {
    const { seam, adapter, gateway, team } = setup();
    await gateway.start();
    team.disarm();

    // The passive stream is not an action: activity still appears.
    gateway.handleFrame("s1", toolFrame("Read", { file_path: "/repo/a.ts" }));
    await flush();
    expect(allSent(adapter)).toContain("Read");

    // Every action-bearing request in the same channel is refused.
    const before = seam.sentPrompts.length;
    await gateway.handleInbound(msg("alice", "keep going"));
    expect(seam.sentPrompts).toHaveLength(before);
    expect(allSent(adapter)).toContain("disarmed");
  });

  it("6.4: a refused activation is not consumed — the invoker can still answer the same prompt", async () => {
    const { seam, adapter, gateway } = setup();
    await gateway.start();
    await gateway.handleInbound(msg("alice", "hello")); // alice is the invoker
    gateway.handleFrame("s1", {
      type: "prompt_request",
      promptId: "pc",
      prompt: { type: "select", title: "Pick", options: ["a", "b"] },
    });
    await flush();

    // bob is at control but is NOT the invoker: the gate refuses, and the
    // interaction was already acked by the adapter, so nothing fails visibly.
    adapter.emitInteractiveResponse({ requestId: "pc", userId: "bob", value: "a" });
    expect(seam.sentResponses).toHaveLength(0);

    // The refusal did not consume the prompt: the invoker answers the SAME one.
    adapter.emitInteractiveResponse({ requestId: "pc", userId: "alice", value: "a" });
    expect(seam.sentResponses).toHaveLength(1);
  });

  it("X19: an observer's control activation sends no response", async () => {
    const { seam, adapter, gateway } = setup();
    await gateway.start();
    gateway.handleFrame("s1", {
      type: "prompt_request",
      promptId: "p1",
      prompt: { type: "select", title: "Pick", options: ["a", "b"] },
    });
    await new Promise((r) => setTimeout(r, 0));
    adapter.emitInteractiveResponse({ requestId: "p1", userId: "eve", value: "a" });
    expect(seam.sentResponses).toHaveLength(0);
  });

  it("X20: a bystander at control cannot answer another principal's question", async () => {
    const { seam, adapter, gateway } = setup();
    await gateway.start();
    // alice drives the session first → she is the question's invoker.
    await gateway.handleInbound(msg("alice", "hello"));
    gateway.handleFrame("s1", {
      type: "prompt_request",
      promptId: "p2",
      prompt: { type: "select", title: "Pick", options: ["a", "b"] },
    });
    await new Promise((r) => setTimeout(r, 0));
    adapter.emitInteractiveResponse({ requestId: "p2", userId: "bob", value: "a" });
    expect(seam.sentResponses).toHaveLength(0);
  });

  it("X20b: the invoker at control can answer", async () => {
    const { seam, adapter, gateway } = setup();
    await gateway.start();
    await gateway.handleInbound(msg("alice", "hello"));
    gateway.handleFrame("s1", {
      type: "prompt_request",
      promptId: "p3",
      prompt: { type: "select", title: "Pick", options: ["a", "b"] },
    });
    await new Promise((r) => setTimeout(r, 0));
    adapter.emitInteractiveResponse({ requestId: "p3", userId: "alice", value: "a" });
    expect(seam.sentResponses).toHaveLength(1);
  });

  it("X21: a question no chat principal invoked can be answered by any control", async () => {
    const { seam, adapter, gateway } = setup();
    await gateway.start();
    gateway.handleFrame("s1", {
      type: "prompt_request",
      promptId: "p4",
      prompt: { type: "select", title: "Pick", options: ["a", "b"] },
    });
    await new Promise((r) => setTimeout(r, 0));
    adapter.emitInteractiveResponse({ requestId: "p4", userId: "carol", value: "a" });
    expect(seam.sentResponses).toHaveLength(1);
  });
});

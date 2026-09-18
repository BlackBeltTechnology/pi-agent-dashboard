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

  function setup() {
    const seam = createFakeSeam();
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
    return { seam, adapter, gateway, log, team };
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

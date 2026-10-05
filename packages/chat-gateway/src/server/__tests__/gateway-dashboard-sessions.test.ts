/**
 * Reaching sessions started in the DASHBOARD from Discord.
 *
 * - `!sessions` lists live, non-hidden sessions inside the channel's bound
 *   workspace (verb `list_sessions`, observe).
 * - `!attach <n|id-prefix>` opens a thread named after the session and binds it
 *   (`source: "attach"`, chat-local verb `attach_session`, observe + scope check);
 *   messages in the thread then drive that session through the normal chokepoint.
 * - `mirrorDashboardSessions` (opt-in) attaches every eligible live session at
 *   start and every newly seen one (first forwarded event) into its workspace's
 *   channel, one thread each.
 * See change: chat-gateway-attach-dashboard-sessions.
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

class ThreadingAdapter extends RecordingAdapter {
  threads: Array<{ channelId: string; messageId: string; name: string; threadId: string }> = [];
  async startThread(channelId: string, messageId: string, name: string): Promise<{ threadId: string }> {
    const threadId = `th-${this.threads.length + 1}`;
    this.threads.push({ channelId, messageId, name, threadId });
    return { threadId };
  }
}

const WORKSPACES = [
  { id: "ws_1", name: "Team", folders: ["/repo"] },
  { id: "ws_2", name: "Other", folders: ["/repo2"] },
];

function makeConfig(over: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    enabled: true,
    token: "t",
    allowedRoots: ["/repo", "/repo2"],
    fixedMap: {},
    allowlist: ["alice", "eve", "zed"],
    admins: ["alice"],
    groupChannels: ["chan1", "chan2"],
    steerPrefix: "!",
    editThrottleMs: 0,
    sessionVisibility: "hidden",
    threadPerConversation: true,
    mirrorDashboardSessions: false,
    ...over,
  };
}

describe("dashboard sessions in Discord", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-dash-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setup(config: Partial<ResolvedConfig> = {}) {
    const seam = createFakeSeam();
    seam.sessions.push(
      { id: "s1aaaaaa-1", cwd: "/repo/a", status: "idle", name: "Fix login bug" },
      { id: "s2bbbbbb-2", cwd: "/repo/b", status: "streaming", name: "Refactor" },
      { id: "s3cccccc-3", cwd: "/repo2/x", status: "idle", name: "Other ws" },
      { id: "s4dddddd-4", cwd: "/repo/c", status: "idle", name: "worker", hidden: true },
      { id: "s5eeeeee-5", cwd: "/elsewhere", status: "idle", name: "Outside" },
    );
    const adapter = new ThreadingAdapter();
    const store = createBindingStore({ filePath: path.join(tmpDir, "bindings.json") });
    const validated = validateTeamControls({
      ceiling: "operate",
      bindings: {
        ws_1: { principals: { alice: "control", eve: "observe" } },
        ws_2: { principals: { alice: "control" } },
      },
    });
    if (!validated.ok) throw new Error(validated.reason);
    const log = createCommandLog({ limit: 1_000 });
    const team = createTeamController({
      config: () => validated.value,
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
      config: makeConfig(config),
      store,
      correlator: createSpawnCorrelator(),
      team,
    });
    return { seam, adapter, gateway, log, store };
  }

  let seq = 0;
  const say = (userId: string, text: string, over: Partial<InboundMessage> = {}): InboundMessage => ({
    platform: "discord",
    channelId: "chan1",
    messageId: `m${++seq}`,
    userId,
    text,
    isDM: false,
    startedAt: 1,
    ...over,
  });
  const repliesIn = (adapter: RecordingAdapter, channelId: string) =>
    adapter.sent.filter((s) => s.channelId === channelId).map((s) => s.content);

  describe("!sessions", () => {
    it("lists live, non-hidden sessions of the channel's workspace, numbered", async () => {
      const { adapter, gateway, seam, log } = setup();
      await gateway.handleInbound(say("alice", "!sessions"));
      const [list] = repliesIn(adapter, "chan1");
      expect(list).toMatch(/1\. .*Fix login bug/);
      expect(list).toMatch(/2\. .*Refactor/);
      expect(list).not.toMatch(/Other ws|worker|Outside/);
      expect(adapter.threads).toHaveLength(0);
      expect(seam.spawns).toHaveLength(0);
      expect(log.entries().at(-1)).toMatchObject({ verb: "list_sessions", outcome: "permitted" });
    });

    it("an observe principal may list", async () => {
      const { adapter, gateway } = setup();
      await gateway.handleInbound(say("eve", "!sessions"));
      expect(repliesIn(adapter, "chan1")[0]).toMatch(/Fix login bug/);
    });

    it("a principal with no tier in the workspace is refused", async () => {
      const { adapter, gateway } = setup();
      await gateway.handleInbound(say("zed", "!sessions"));
      expect(repliesIn(adapter, "chan1")[0]).toMatch(/^Refused/);
    });
  });

  describe("!attach", () => {
    it("by list number: opens a thread named after the session and binds it", async () => {
      const { adapter, gateway, store, seam, log } = setup();
      await gateway.handleInbound(say("alice", "!sessions"));
      await gateway.handleInbound(say("alice", "!attach 1"));
      expect(adapter.threads).toHaveLength(1);
      expect(adapter.threads[0]).toMatchObject({ channelId: "chan1", name: "Fix login bug" });
      const b = store.get("discord:th-1:th-1");
      expect(b).toMatchObject({ sessionId: "s1aaaaaa-1", source: "attach", parentChannelId: "chan1" });
      expect(repliesIn(adapter, "th-1")[0]).toMatch(/Attached to Fix login bug/);
      expect(seam.frameHandlers.has("s1aaaaaa-1")).toBe(true);
      expect(seam.spawns).toHaveLength(0);
      expect(log.entries().at(-1)).toMatchObject({ verb: "attach_session", outcome: "permitted" });
    });

    it("by id prefix, without a prior list", async () => {
      const { gateway, store } = setup();
      await gateway.handleInbound(say("alice", "!attach s2bb"));
      expect(store.get("discord:th-1:th-1")?.sessionId).toBe("s2bbbbbb-2");
    });

    it("an observe principal may attach (watching is observe)", async () => {
      const { gateway, store } = setup();
      await gateway.handleInbound(say("eve", "!attach s1"));
      expect(store.get("discord:th-1:th-1")?.sessionId).toBe("s1aaaaaa-1");
    });

    it("refuses a session outside the channel's workspace and opens no thread", async () => {
      const { adapter, gateway, store } = setup();
      await gateway.handleInbound(say("alice", "!attach s3cc"));
      expect(adapter.threads).toHaveLength(0);
      expect(store.all()).toHaveLength(0);
      expect(repliesIn(adapter, "chan1")[0]).toMatch(/No live session/);
    });

    it("refuses an unknown number or prefix", async () => {
      const { adapter, gateway } = setup();
      await gateway.handleInbound(say("alice", "!attach 9"));
      expect(adapter.threads).toHaveLength(0);
      expect(repliesIn(adapter, "chan1")[0]).toMatch(/No live session/);
    });

    it("points to the existing thread instead of attaching twice", async () => {
      const { adapter, gateway } = setup();
      await gateway.handleInbound(say("alice", "!attach s1"));
      await gateway.handleInbound(say("alice", "!attach s1"));
      expect(adapter.threads).toHaveLength(1);
      expect(repliesIn(adapter, "chan1").at(-1)).toMatch(/already attached.*<#th-1>/i);
    });

    it("messages in the attached thread drive that session, never a spawn", async () => {
      const { gateway, seam } = setup();
      await gateway.handleInbound(say("alice", "!attach s1"));
      await gateway.handleInbound(
        say("alice", "what are you doing?", { channelId: "th-1", threadId: "th-1", parentChannelId: "chan1" }),
      );
      expect(seam.sentPrompts).toEqual([{ sessionId: "s1aaaaaa-1", text: "what are you doing?", delivery: "followUp" }]);
      expect(seam.spawns).toHaveLength(0);
    });

    it("inside a thread it is refused (run it in the channel)", async () => {
      const { adapter, gateway, seam } = setup();
      await gateway.handleInbound(say("alice", "!attach s1", { channelId: "th-9", threadId: "th-9", parentChannelId: "chan1" }));
      expect(adapter.threads).toHaveLength(0);
      expect(seam.sentPrompts).toHaveLength(0);
      expect(repliesIn(adapter, "th-9")[0]).toMatch(/in the channel itself/);
    });
  });

  describe("mirrorDashboardSessions", () => {
    it("off by default: nothing is mirrored at start or on events", async () => {
      const { adapter, gateway, seam } = setup();
      await gateway.start();
      seam.emitSessionEvent("s1aaaaaa-1");
      await new Promise((r) => setTimeout(r, 0));
      expect(adapter.threads).toHaveLength(0);
      await gateway.stop();
    });

    it("on: attaches every eligible live session at start, each in its workspace channel", async () => {
      const { adapter, gateway, store } = setup({ mirrorDashboardSessions: true });
      await gateway.start();
      const byChannel = adapter.threads.map((t) => `${t.channelId}:${t.name}`).sort();
      expect(byChannel).toEqual(["chan1:Fix login bug", "chan1:Refactor", "chan2:Other ws"]);
      expect(store.all().every((b) => b.source === "attach")).toBe(true);
      expect(repliesIn(adapter, "chan1").some((c) => /Dashboard session: Fix login bug/.test(c))).toBe(true);
      await gateway.stop();
    });

    it("on: a newly seen session is attached once, even on an event burst", async () => {
      const { adapter, gateway, seam } = setup({ mirrorDashboardSessions: true });
      await gateway.start();
      const before = adapter.threads.length;
      seam.sessions.push({ id: "s6ffffff-6", cwd: "/repo/new", status: "streaming", name: "New one" });
      seam.emitSessionEvent("s6ffffff-6");
      seam.emitSessionEvent("s6ffffff-6");
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(adapter.threads.slice(before).map((t) => t.name)).toEqual(["New one"]);
      await gateway.stop();
    });

    it("on: already-bound sessions are not mirrored again after a restart", async () => {
      const { adapter, gateway } = setup({ mirrorDashboardSessions: true });
      await gateway.start();
      await gateway.stop();
      const first = adapter.threads.length;
      await gateway.start();
      expect(adapter.threads.length).toBe(first);
      await gateway.stop();
    });
  });
});

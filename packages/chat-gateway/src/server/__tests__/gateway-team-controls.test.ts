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
import { bindingKey } from "../../shared/types.js";
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
    opts: {
      assignRefResult?: boolean;
      onTrustFailure?: (reason: string) => void;
      /** Override the workspace list (real dirs, for the D8 resolution tests). */
      workspaces?: typeof WORKSPACES;
      /** Override allowedRoots (real dirs, for the D8 resolution tests). */
      allowedRoots?: string[];
      /** Override the L1 config (e.g. `groupChannels`), to get past L1 to the team layer. */
      config?: Partial<ResolvedConfig>;
      /** Override the provisioned channel→workspace map. */
      channelBindings?: () => Map<string, string>;
      /** Override the configured per-workspace policies. */
      bindings?: Record<string, unknown>;
    } = {},
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
      bindings: opts.bindings ?? {
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
      config: () => validated.value,
      log,
      listWorkspaces: () => opts.workspaces ?? WORKSPACES,
      ...(opts.onTrustFailure ? { onTrustFailure: opts.onTrustFailure } : {}),
      channelBindings:
        opts.channelBindings ??
        (() =>
          new Map([
            ["chan1", "ws_1"],
            ["chan2", "ws_2"],
          ])),
    });
    const gateway = createChatGateway({
      platform: "discord",
      seam,
      adapter,
      config: { ...makeConfig(), ...(opts.allowedRoots ? { allowedRoots: opts.allowedRoots } : {}), ...(opts.config ?? {}) },
      store,
      correlator: createSpawnCorrelator(),
      team,
    });
    return { seam, adapter, gateway, log, team, teamConfig: validated.value, store };
  }

  const msg = (userId: string, text: string): InboundMessage => ({
    platform: "discord",
    channelId: "chan1",
    userId,
    text,
    isDM: true,
    startedAt: 1,
  });

  it("11.4: an attach never adopts a session outside the BOUND workspace", async () => {
    // Here the workspace's folders are INERT (outside `allowedRoots`), so D8
    // resolution finds nothing and falls through to the interactive attach — which
    // filtered candidates by `allowedRoots` alone. That adopted whatever session
    // the host happened to be running (s1 at /repo/proj, a DIFFERENT workspace's
    // path), and the binding, the subscription and the mirror were all in place
    // before the next message refused `scope_violation`. Attaching to the wrong
    // session is not something a later refusal repairs, so it must not happen.
    const { adapter, gateway, store } = setup({
      allowedRoots: ["/repo"],
      workspaces: [
        { id: "ws_1", name: "Team", folders: ["/outside"] },
        { id: "ws_2", name: "Other", folders: ["/repo2"] },
      ],
      channelBindings: () => new Map([["chan9", "ws_1"]]),
      config: { groupChannels: ["chan9"] },
    });
    await gateway.start();
    await gateway.handleInbound({ ...msg("alice", "hello"), channelId: "chan9", isDM: false });
    await flush();

    // Nothing attached, and the operator is told which constraint bit — not sent
    // looking for a missing fixedMap.
    expect(store.get(bindingKey({ platform: "discord", channelId: "chan9" }))).toBeUndefined();
    expect(adapter.sent.at(-1)?.content).toContain("bound to a workspace");
  });

  it("D8: a bind resolves to the BOUND WORKSPACE's folder, not just fixedMap/default", async () => {
    // Real temp dirs: containment is decided on the REAL path, so a fake path
    // like "/repo" is correctly judged outside any allowed root and skipped.
    // With no fixedMap and no defaultCwd, the workspace source is the only thing
    // that can resolve — unwired, this falls through to interactive attach and
    // spawns nothing. `chan2` is chosen because `chan1` is pre-bound in setup().
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cg-ws-"));
    const wsDir = path.join(root, "team-proj");
    fs.mkdirSync(wsDir, { recursive: true });
    const { seam, gateway } = setup({
      workspaces: [{ id: "ws_2", name: "Other", folders: [wsDir] }],
      allowedRoots: [root],
      channelBindings: () => new Map([["chan2", "ws_2"]]),
      // `alice` must be MAPPED in ws_2, or the chokepoint refuses with
      // `no_principal_mapping` before resolution is ever reached.
      bindings: { ws_2: { principals: { alice: "control" } } },
    });
    await gateway.start();
    await gateway.handleInbound({ ...msg("alice", "bind here"), channelId: "chan2" });
    expect(seam.spawns).toHaveLength(1);
    expect(seam.spawns[0].cwd).toBe(fs.realpathSync(wsDir));
  });

  it("D8: an INERT workspace folder is SKIPPED, never spawned into", async () => {
    // A workspace folder outside allowedRoots is inert: the source must skip it
    // rather than adopt it, so the convenience feature can only NARROW the spawn
    // boundary. Two separate temp roots, so `outside` is genuinely not within
    // `root`.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cg-in-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cg-out-"));
    const { seam, gateway } = setup({
      workspaces: [{ id: "ws_2", name: "Other", folders: [outside] }],
      allowedRoots: [root],
      channelBindings: () => new Map([["chan2", "ws_2"]]),
      // Mapped, so this refuses for the INERT-FOLDER reason and not for a
      // missing principal mapping (which would make the assertion vacuous).
      bindings: { ws_2: { principals: { alice: "control" } } },
    });
    await gateway.start();
    await gateway.handleInbound({ ...msg("alice", "bind here"), channelId: "chan2" });
    expect(seam.spawns.map((s) => s.cwd)).not.toContain(fs.realpathSync(outside));
    expect(seam.spawns).toHaveLength(0);
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

  it("B1: a prompt raised by a session in a THREAD is answerable at all (parent binding resolves)", async () => {
    // A click is an actor's action, so it is re-authorized. The session lives in
    // a THREAD, so its binding's `channelId` is the THREAD id and `chan1` is only
    // reachable via `parentChannelId` — at BOTH layers (L4 opted-in check and the
    // team chokepoint). Omitting it made every prompt in a thread unanswerable:
    // the click was refused, nothing was sent, and because the refusal path only
    // logs, the user saw NOTHING while the session blocked forever.
    const { seam, adapter, gateway, store } = setup({ config: { groupChannels: ["chan1"] } });
    store.set({
      platform: "discord",
      channelId: "thread1",
      threadId: "thread1",
      parentChannelId: "chan1",
      sessionId: "s_thr",
      cwd: "/repo/proj",
      boundBy: "alice",
      source: "spawn",
      isDM: false,
      createdAt: 2,
    });
    await gateway.start();
    gateway.handleFrame("s_thr", {
      type: "prompt_request",
      promptId: "p_thr",
      prompt: { type: "select", title: "Pick", options: ["a", "b"] },
    });
    await flush();
    adapter.emitInteractiveResponse({ requestId: "p_thr", userId: "alice", value: "a" });
    await flush();
    expect(seam.sentResponses.length).toBeGreaterThan(0);
  });

  it("B2: a prompt for a session OUTSIDE the binding's workspace is refused, never recorded as permitted", async () => {
    // Scope containment must be evaluated INSIDE the chokepoint (spec: "Scope
    // containment SHALL be evaluated inside that authorization, not as a separate
    // check"). The prompt path passed no `targetCwd`, so containment was never
    // evaluated: an out-of-scope target was authorized, the answer WAS delivered,
    // and the audit log — the operator's record of what happened — affirmatively
    // recorded `permitted`. Reachable from any pre-existing binding whose cwd
    // falls outside a newly-configured workspace.
    const { seam, adapter, gateway, store, log } = setup({ config: { groupChannels: ["chan1"] } });
    store.set({
      platform: "discord",
      channelId: "chan1",
      sessionId: "s_out",
      cwd: "/elsewhere/secret",
      boundBy: "alice",
      source: "spawn",
      isDM: false,
      createdAt: 3,
    });
    await gateway.start();
    gateway.handleFrame("s_out", {
      type: "prompt_request",
      promptId: "p_out",
      prompt: { type: "select", title: "Pick", options: ["a", "b"] },
    });
    await flush();
    adapter.emitInteractiveResponse({ requestId: "p_out", userId: "alice", value: "a" });
    await flush();
    // The ANSWER must not be delivered — asserting on `sentPrompts` would pass
    // vacuously, because an interactive answer travels as a RESPONSE.
    expect(seam.sentResponses).toHaveLength(0);
    const entry = log.entries().findLast((e) => e.verb === "prompt_response");
    expect(entry?.outcome).toBe("refused");
    expect(entry?.reason).toBe("scope_violation");
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

  it("11.2: a session in a THREAD mirrors at its PARENT binding's level, not the default", async () => {
    const { adapter, gateway, store, teamConfig } = setup();
    // `chan1` is bound to `ws_1`; this session was spawned in a THREAD of it, so
    // its binding carries the THREAD id as `channelId` plus the parent. The
    // operator's level is `full-transcript` while the default is `names-only`,
    // so a lane that looked up the bare thread id would miss the binding and
    // silently drop the diff — making the per-thread level a no-op.
    teamConfig.bindings.ws_1.mirrorLevel = "full-transcript";
    const threadBinding = {
      platform: "discord" as const,
      channelId: "thread1",
      threadId: "thread1",
      parentChannelId: "chan1",
      sessionId: "s_thr",
      cwd: "/repo/proj",
      boundBy: "alice",
      source: "spawn" as const,
      isDM: false,
      createdAt: 2,
    };
    store.set(threadBinding);
    await gateway.start();
    gateway.handleFrame(
      "s_thr",
      toolFrame("Edit", { file_path: "/repo/src/foo.ts", oldText: "OLD", newText: "NEW_SECRET" }),
    );
    await flush();
    expect(allSent(adapter)).toContain("NEW_SECRET");

    // Teeth: with the SAME session and level but no `parentChannelId`, the lane
    // falls back to the default and the diff is filtered out. So it is genuinely
    // the persisted parent that resolves the operator's level.
    adapter.sent.length = 0;
    const { parentChannelId: _dropped, ...withoutParent } = threadBinding;
    store.set(withoutParent);
    gateway.handleFrame(
      "s_thr",
      toolFrame("Edit", { file_path: "/repo/src/foo.ts", oldText: "OLD", newText: "NEW_SECRET" }),
    );
    await flush();
    expect(allSent(adapter)).not.toContain("NEW_SECRET");
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

  it("F7: an oversized mirrored payload is elided with an EXPLICIT, truthful marker", async () => {
    const { adapter, gateway, teamConfig } = setup();
    await gateway.start();
    // `full-transcript` is the only level that renders a tool RESULT, so it is
    // the only one where a payload can reach the post large enough to be cut.
    teamConfig.bindings.ws_1.mirrorLevel = "full-transcript";

    const HUGE = "A".repeat(5_000);
    gateway.handleFrame("s1", toolEndFrame("Bash", HUGE));
    await flush();

    const posted = adapter.sent.at(-1)?.content ?? "";
    // The post is bounded, so it fits inside the platform's message limit...
    expect(posted.length).toBeLessThanOrEqual(2_000);
    // ...the HEAD is preserved rather than mangled...
    expect(posted.startsWith("A".repeat(64))).toBe(true);
    // ...and the cut is DISCLOSED. Summing the surviving text against the
    // reported count must reproduce the original length EXACTLY: that is what
    // makes the marker truthful rather than decorative, and a marker that
    // under-reports would be a silent cut wearing a label.
    const reported = posted.match(/\[elided (\d+) characters\]/);
    expect(reported).not.toBeNull();
    const visible = posted.slice(0, posted.indexOf("\n… [elided"));
    expect(visible.length + Number(reported?.[1])).toBe(HUGE.length);
  });

  it("F2 (threads): a THREAD of a bound channel inherits the binding, not unbound_channel", async () => {
    // `chan1` is opted into L1 so the message actually REACHES the team layer;
    // the thread id is deliberately NOT opted in and NOT in the binding map.
    const { seam, adapter, gateway } = setup({ config: { groupChannels: ["chan1"] } });
    await gateway.start();
    const before = seam.spawns.length;
    // Discord sets `channelId` to the THREAD id and `parentChannelId` to the
    // parent channel (see discord.ts). The workspace-binding spec requires that
    // a command from "a bound channel OR ITS THREADS" resolve that channel's
    // workspace — so a thread the operator never explicitly provisioned must
    // inherit, or per-thread session granularity is dead under team controls.
    await gateway.handleInbound({
      ...msg("alice", "thread hello"),
      isDM: false,
      channelId: "thread1",
      parentChannelId: "chan1",
    });
    await flush();
    expect(allSent(adapter)).not.toContain("unbound_channel");
    // A thread with no session of its own yet SPAWNS one (per-thread session
    // granularity), which only happens if the request was authorized — so this
    // is the observable that proves the parent binding was inherited rather
    // than the thread being waved through.
    expect(seam.spawns.length).toBeGreaterThan(before);
  });

  it("F3/b: enrollment still works over DM, and a DM is refused with GUIDANCE, never a bare reason", async () => {
    const { seam, adapter, gateway } = setup();
    await gateway.start();

    // 1. Enrollment is UNTOUCHED: the pairing branch returns before the
    //    chokepoint, so scoping DMs out of session control must not break the
    //    one flow that legitimately happens in a DM. The allowlist is also the
    //    enrollment path for GUILD channels (auth.ts gates all talk on it), so
    //    this is what makes "DM = enrollment channel" coherent rather than a
    //    dead end.
    const code = gateway.status().pairingCode;
    expect(code).toMatch(/^\d{6}$/);
    await gateway.handleInbound({ ...msg("dave", code), channelId: "dm_dave" });
    await flush();
    expect(seam.persistedAllowlists.at(-1)).toContain("dave");

    // 2. ...but it must stop PROMISING session control the layer will refuse.
    //    This was the actual defect: the reply said "You can now talk to
    //    sessions.", then every later message was refused — a dead flow that
    //    advertised itself as working.
    const paired = adapter.sent.map((s) => s.content).join("\n");
    expect(paired).not.toContain("You can now talk to sessions");
    expect(paired).toContain("workspace-bound channel");

    // 3. An allowlisted DM is refused BY DESIGN — a DM can never carry a
    //    workspace binding — and the reply says what to do instead of dumping a
    //    machine reason that reads like an operator forgot to bind the channel.
    adapter.sent.length = 0;
    const before = seam.spawns.length;
    await gateway.handleInbound({ ...msg("alice", "hello"), channelId: "dm_alice" });
    await flush();
    const refusal = adapter.sent.map((s) => s.content).join("\n");
    expect(refusal).toContain("don't drive sessions");
    expect(refusal).not.toContain("unbound_channel");
    expect(seam.spawns.length).toBe(before);
  });

  it("3.10: an OBSERVE principal disarms from chat, every action is then refused, and only the dashboard re-arms", async () => {
    const { seam, adapter, gateway, team } = setup();
    await gateway.start();

    // The spec says ANY principal holding at least `observe` may disarm — so the
    // panic button must not be reserved for control/operate. `eve` is `observe`
    // on ws_1 and the ceiling is `operate`, so her tier is the binding factor.
    await gateway.handleInbound(msg("eve", "!disarm"));
    await flush();
    expect(team.isDisarmed()).toBe(true);
    expect(adapter.sent.map((s) => s.content).join("\n")).toMatch(/disarm/i);

    // While disarmed every action-bearing request is refused — including a
    // `control` principal's, because the switch is global, not per-principal.
    adapter.sent.length = 0;
    const before = seam.spawns.length;
    await gateway.handleInbound(msg("alice", "please run this"));
    await flush();
    expect(adapter.sent.map((s) => s.content).join("\n")).toContain("disarmed");
    expect(seam.spawns.length).toBe(before);

    // ...but the command log / mirroring lane is untouched: only ACTIONS halt.

    // Re-arming from chat is refused; the dashboard is the only way back.
    expect(team.rearmFromChat().ok).toBe(false);
    expect(team.isDisarmed()).toBe(true);
    team.rearmFromDashboard();
    expect(team.isDisarmed()).toBe(false);

    adapter.sent.length = 0;
    await gateway.handleInbound(msg("alice", "hello"));
    await flush();
    expect(seam.sentPrompts.at(-1)?.text).toContain("hello");
  });

  it("3.10: a bare or in-sentence 'disarm' is NOT the command — prose must never halt the layer", async () => {
    const { seam, gateway, team } = setup();
    await gateway.start();
    await gateway.handleInbound(msg("alice", "how do I disarm a device?"));
    await flush();
    // Matching a bare word would let a normal prompt halt the whole team layer.
    expect(team.isDisarmed()).toBe(false);
    expect(seam.sentPrompts.at(-1)?.text).toContain("disarm a device");

    // The stronger case: `!` is the DEFAULT `steerPrefix`, so `!disarm` followed
    // by arguments is an ordinary STEER instruction. It must reach the session —
    // not halt every principal's actions until a dashboard operator intervenes.
    seam.sentPrompts.length = 0;
    await gateway.handleInbound(msg("alice", "!disarm the rate limiter in auth.ts"));
    await flush();
    expect(team.isDisarmed()).toBe(false);
    expect(seam.sentPrompts.at(-1)?.text).toContain("rate limiter");
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

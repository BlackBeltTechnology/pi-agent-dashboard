/**
 * Plugin entry tests — the inertness contract (task 1.3), the settings surface
 * that must stay reachable while inert, and the fail-loud behaviour when the
 * host lacks the in-process frame seam.
 *
 * See change: add-chat-gateway.
 * See change: add-chat-gateway-team-controls.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  TEAM_CONFIG_MESSAGE,
  TEAM_SURFACE_MESSAGE,
  type TeamSurfaceView,
} from "../../shared/types.js";
import registerChatGateway, {
  commandLogFilePath,
  disarmFilePath,
  shouldApplyDisarm,
} from "../index.js";
import { createDisarmStore } from "../team/disarm-store.js";

function fakeCtx(
  config: Record<string, unknown>,
  opts: { frameSeam?: boolean; workspaces?: unknown[] } = {},
) {
  const info = vi.fn();
  const error = vi.fn();
  const warn = vi.fn();
  const onShutdown = vi.fn();
  const spawnSession = vi.fn(async () => ({ success: false }));
  const broadcastToSubscribers = vi.fn();
  const handlers = new Map<string, (msg?: unknown) => void>();
  const ctx = {
    logger: { info, warn, error, debug: vi.fn() },
    getPluginConfig: () => config,
    onShutdown,
    spawnSession,
    abortSession: () => false,
    sendExtensionMessage: () => false,
    mintSpawnToken: () => "tok",
    onSessionResolved: () => () => {},
    sessionManager: { listActive: () => [], listAll: () => [], getSession: () => undefined },
    subscribeSession: opts.frameSeam === false ? undefined : () => () => {},
    // Registered even while inert: the settings panel reads local state, so it
    // must work with no bot token.
    registerBrowserHandler: (type: string, fn: (msg?: unknown) => void) => {
      handlers.set(type, fn);
    },
    broadcastToSubscribers,
    listWorkspaces: () => opts.workspaces ?? [],
    // The workspace-change seam (host workspace seam, section 1): the gateway
    // subscribes on the LIVE path to reconcile provisioning.
    onWorkspacesChanged: () => () => {},
    // The live path also publishes a bindings route for the operator.
    fastify: { get: vi.fn() },
    networkGuard: vi.fn(),
    updatePluginConfig: vi.fn(async () => {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { ctx, info, error, warn, onShutdown, spawnSession, handlers, broadcastToSubscribers };
}

/** Drive the surface lane the way the panel does, and return the snapshot. */
async function requestSurface(
  handlers: Map<string, (msg?: unknown) => void>,
  broadcast: ReturnType<typeof vi.fn>,
): Promise<TeamSurfaceView> {
  handlers.get(TEAM_SURFACE_MESSAGE)?.();
  await vi.waitFor(() => expect(broadcast).toHaveBeenCalled());
  return broadcast.mock.calls.at(-1)?.[0].surface as TeamSurfaceView;
}

describe("chat-gateway plugin entry", () => {
  it("is inert with no token: no adapter, no connection, no shutdown hook", async () => {
    const { ctx, info, onShutdown, spawnSession } = fakeCtx({});

    await registerChatGateway(ctx);

    expect(info).toHaveBeenCalledWith(expect.stringContaining("inert"));
    expect(onShutdown).not.toHaveBeenCalled();
    expect(spawnSession).not.toHaveBeenCalled();
  });

  it("is inert when disabled even with a token", async () => {
    const { ctx, info, onShutdown } = fakeCtx({ token: "t", enabled: false });

    await registerChatGateway(ctx);

    expect(info).toHaveBeenCalledWith(expect.stringContaining("inert"));
    expect(onShutdown).not.toHaveBeenCalled();
  });

  it("fails LOUDLY when the host lacks the frame seam", async () => {
    const { ctx, error, info } = fakeCtx({ token: "t" }, { frameSeam: false });

    await registerChatGateway(ctx);

    expect(error).toHaveBeenCalledWith(expect.stringContaining("subscribeSession"));
    // Never claims to have started.
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining("started"));
  });
});

/**
 * Task 10g: the panel is a LOCAL projection, so it must not require a bot
 * token. Without this the settings surface is unreachable on any install whose
 * gateway is inert — including the browser harness — and there is no way to
 * review or edit the policy before enabling the bot.
 */
describe("dashboard disarm writes (task 3.10)", () => {
  it("re-arms a CHAT-initiated disarm, by comparing against the LIVE latch", () => {
    // The scenario that motivated this: a chat disarm flips the live latch but
    // writes NO config (the dashboard remains the only config writer), so
    // config.disarmed stays false. The dashboard then re-arms by writing false.
    // A caller comparing against CONFIG would see `false !== false` — "no
    // change" — and never apply it, leaving the layer disarmed permanently with
    // no way back. Comparing against the LIVE latch applies it.
    expect(shouldApplyDisarm(false, true)).toBe(true);

    // An unrelated edit echoes the live value it displays, so it is NOT a change
    // and cannot undo a chat disarm as a side effect.
    expect(shouldApplyDisarm(true, true)).toBe(false);

    // A plain dashboard disarm still applies, and an idle re-write does nothing.
    expect(shouldApplyDisarm(true, false)).toBe(true);
    expect(shouldApplyDisarm(false, false)).toBe(false);
  });
});

describe("settings surface while inert (no token)", () => {
  const workspaces = [{ id: "ws_1", name: "Alpha", folders: [] }];
  const policies = {
    teamControls: {
      ceiling: "control",
      bindings: {
        ws_1: {
          ceiling: "observe",
          mirrorLevel: "names-only",
          principals: { u1: "observe" },
          roles: { r1: "control" },
        },
      },
    },
  };

  it("registers the surface lane, so the panel is not something you enable the bot for", async () => {
    const { ctx, info, handlers } = fakeCtx(policies, { workspaces });

    await registerChatGateway(ctx);

    // Inertness itself is unchanged — no adapter, no connection, no hook.
    expect(info).toHaveBeenCalledWith(expect.stringContaining("inert"));
    // The read AND write lanes exist, so the panel can render and save.
    expect([...handlers.keys()]).toEqual([TEAM_SURFACE_MESSAGE, TEAM_CONFIG_MESSAGE]);
  });

  it("projects the configured policy, so it can be reviewed before a token exists", async () => {
    const { ctx, handlers, broadcastToSubscribers: broadcast } = fakeCtx(policies, { workspaces });

    await registerChatGateway(ctx);
    const surface = await requestSurface(handlers, broadcast);

    expect(surface.configured).toBe(true);
    expect(surface.ceiling).toBe("control");
    expect(surface.bindings).toHaveLength(1);
    expect(surface.bindings[0].workspaceId).toBe("ws_1");
    expect(surface.bindings[0].workspaceName).toBe("Alpha");
    expect(surface.bindings[0].bound).toBe(true);
    expect(surface.bindings[0].principals).toEqual([{ id: "u1", tier: "observe" }]);
    // The binding ceiling NARROWS the global one (see team-config).
    expect(surface.bindings[0].ceiling).toBe("observe");
  });

  it("names the delegation as UNAVAILABLE, never an empty roster", async () => {
    const { ctx, handlers, broadcastToSubscribers: broadcast } = fakeCtx(policies, { workspaces });

    await registerChatGateway(ctx);
    const surface = await requestSurface(handlers, broadcast);

    // An empty `assigners` list would read as "nobody can hand this out", which
    // understates who holds the role. The inert lane must say what is missing.
    expect(surface.bindings[0].roles).toHaveLength(1);
    expect(surface.bindings[0].roles[0].assigners).toEqual({
      kind: "unavailable",
      missingPermission: "the gateway is not connected",
    });
  });

  it("shows a REJECTED policy with the fail-closed banner rather than hiding it", async () => {
    // A role may not be mapped to `operate` — the one binding shape the config
    // refuses outright, rather than clamping.
    const { ctx, error, handlers, broadcastToSubscribers: broadcast } = fakeCtx(
      { teamControls: { bindings: { ws_1: { roles: { r1: "operate" } } } } },
      { workspaces },
    );

    await registerChatGateway(ctx);
    const surface = await requestSurface(handlers, broadcast);

    expect(error).toHaveBeenCalledWith(expect.stringContaining("rejected"));
    // Fail-closed values, not the operator's rejected ones.
    expect(surface.ceiling).toBe("observe");
    expect(surface.bindings).toEqual([]);
    // The operator is TOLD, rather than shown an empty panel with no
    // explanation — and told WHICH path was refused.
    expect(surface.configError).toContain("teamControls.bindings.ws_1.roles.r1");
  });

  it("11.3: a chat disarm survives a restart, so the halt the operator sees is real", async () => {
    // The spec says the layer stays disarmed until an OPERATOR re-arms. The latch
    // is deliberately not kept in config (a chat disarm must not write config, as
    // the dashboard is the only config writer), so it needs its own file — and a
    // FILE is only half the contract: if the entry point never reads it back, the
    // layer comes back armed on every bounce, silently. Same failure mode as the
    // command log below, and the same reason it is worth a test.
    const file = disarmFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ disarmed: true }), { mode: 0o600 });
    // The latch is only read on the LIVE path (an inert install has no layer to
    // disarm), so this needs an adapter. The socket-less fake is exactly the
    // fixture for that, and it keeps the test off the network.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "disarm-boot-"));
    vi.stubEnv("PI_CHAT_GATEWAY_FAKE", "1");
    vi.stubEnv("PI_CHAT_GATEWAY_FAKE_DIR", scratch);

    try {
      const { ctx, handlers, broadcastToSubscribers: broadcast } = fakeCtx(
        {
          enabled: true,
          token: "t",
          allowedRoots: ["/repo"],
          teamControls: {
            bindings: { ws_1: { principals: { alice: "control" } } },
            ceiling: "operate",
          },
        },
        { workspaces: [{ id: "ws_1", name: "Team", folders: ["/repo"] }] },
      );
      await registerChatGateway(ctx);
      const surface = await requestSurface(handlers, broadcast);
      expect(surface.disarmed).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.rmSync(file, { force: true });
    }
  });

  it("11.3: a dashboard disarm is PERSISTED, not just applied to the live latch", async () => {
    // The other half of the join: `onDisarmChange` must actually reach the store.
    // Without it the latch works perfectly until the next restart, which is the
    // failure mode task 11.3 is about — so it needs coverage, not a code read.
    const file = disarmFilePath();
    fs.rmSync(file, { force: true });
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "disarm-write-"));
    vi.stubEnv("PI_CHAT_GATEWAY_FAKE", "1");
    vi.stubEnv("PI_CHAT_GATEWAY_FAKE_DIR", scratch);

    try {
      const { ctx, handlers, broadcastToSubscribers: broadcast } = fakeCtx(
        {
          enabled: true,
          token: "t",
          allowedRoots: ["/repo"],
          teamControls: {
            bindings: { ws_1: { principals: { alice: "control" } } },
            ceiling: "operate",
            guildId: "g1",
          },
        },
        { workspaces: [{ id: "ws_1", name: "Team", folders: ["/repo"] }] },
      );
      await registerChatGateway(ctx);

      handlers.get(TEAM_CONFIG_MESSAGE)?.({
        teamControls: {
          bindings: { ws_1: { principals: { alice: "control" } } },
          ceiling: "operate",
          guildId: "g1",
          disarmed: true,
        },
      });

      await vi.waitFor(() => expect(createDisarmStore({ filePath: file }).load()).toBe(true));
      const surface = await requestSurface(handlers, broadcast);
      expect(surface.disarmed).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.rmSync(file, { force: true });
    }
  });

  it("restores the command log from disk, so a restart cannot erase the audit trail", async () => {
    // The log is append-only and persisted precisely so it survives a restart.
    // Writing the file is therefore only half the contract: if the entry point
    // never READS it back, every restart silently presents an empty audit trail
    // to the operator — the one failure mode an audit log must not have. Caught
    // by the L3 panel scenario (F5), which rendered zero rows against a seeded
    // file that was verifiably on disk.
    const file = commandLogFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const seeded = {
      entries: [
        { at: 1, principal: "u1", channelId: "c1", verb: "list_sessions", outcome: "permitted" },
        { at: 2, principal: "u1", channelId: "c1", verb: "abort_run", outcome: "permitted" },
      ],
    };
    fs.writeFileSync(file, JSON.stringify(seeded), { mode: 0o600 });

    try {
      const { ctx, handlers, broadcastToSubscribers: broadcast } = fakeCtx({});
      await registerChatGateway(ctx);
      const surface = await requestSurface(handlers, broadcast);

      // Present, and ordered by the LOG's own rule (most-recent-first) rather
      // than the renderer's — the panel prints them in the order it is given.
      expect(surface.log.map((e) => e.verb)).toEqual(["abort_run", "list_sessions"]);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});

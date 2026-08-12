/**
 * mcp-server-plugin · SERVER entry.
 *
 * Mounts `POST /mcp` on the shared Fastify instance handed to every plugin
 * (`ctx.fastify`), exactly as seven other plugins already do. Registration is
 * synchronous because routes must exist before `fastify.listen`.
 *
 * Wiring notes that are decisions, not detail:
 *
 * - The token registry is created HERE and never persisted, so it dies with the
 *   plugin. A plugin load failure therefore leaves no credential behind (X8),
 *   and a restart invalidates everything at once (X9).
 *
 * - Minting is driven only by `registerPiHandler`, i.e. messages arriving over
 *   a session's own bridge socket. The sessionId comes from the dispatch key,
 *   never from the message body — that is the whole basis of Decision 6, and
 *   why minting for a foreign session is unrepresentable rather than merely
 *   rejected.
 *
 * - Provisioning failure is logged, never thrown: writing `mcp.json` is a
 *   convenience for local pi sessions, not a precondition for serving `/mcp`
 *   (J7).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { type ToolInvocation } from "./dispatch.js";
import { probeAdapterVersion, provisionDashboardEntry } from "./provisioning.js";
import { mountMcpRoutes } from "./routes.js";
import { SubscriptionRegistry, type StreamSink } from "./streaming.js";
import { McpTokenRegistry } from "./tokens.js";
import { MCP_TOOLS, checkToolCompleteness, assertContextPartitionTotal } from "./tools.js";

const PLUGIN_ID = "mcp-server";

/** Bridge message names this plugin answers on a session's own socket. */
const MINT_MESSAGE = "mcp/mint-token";
const REVOKE_MESSAGE = "mcp/revoke-token";

function mcpConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "mcp.json");
}

/** Atomic write: temp file in the same directory, then rename. */
function writeFileAtomic(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("mcp-server plugin server entry activated");

  // Fail loudly at load rather than advertising a tool that cannot be called.
  // The denylist.ts lesson: an advertised-but-dead tool is worse than an absent
  // one, because the client believes the call landed.
  const partition = assertContextPartitionTotal();
  if (!partition.ok) {
    ctx.logger.error(
      `mcp-server: ServerPluginContext partition is incomplete — unclassified: ${partition.unclassified.join(", ")}; overlapping: ${partition.overlapping.join(", ")}`,
    );
  }

  const tokens = new McpTokenRegistry();
  const subscriptions = new SubscriptionRegistry();

  const handlers: Record<string, (inv: ToolInvocation) => Promise<unknown>> = {
    list_sessions: async () => ({ sessions: ctx.sessionManager.listAll() }),
    send_prompt: async ({ args }) => ({
      delivered: ctx.sendToSession(args.sessionId as string, args.text as string),
    }),
    spawn_session: async ({ args }) => ctx.spawnSession({ cwd: args.cwd as string }),
    abort: async ({ args }) => {
      const aborted = await ctx.abortSession(args.sessionId as string);
      // X4: abortSession returns false for a disconnected bridge. Reporting it
      // as `aborted:false` rather than a bare success is the whole point — a
      // false success would tell the caller a no-op worked.
      return { aborted };
    },
  };

  const completeness = checkToolCompleteness(MCP_TOOLS, (name) => handlers[name]);
  if (!completeness.ok) {
    ctx.logger.error(
      `mcp-server: advertised tools without a handler: ${completeness.missing.join(", ")}`,
    );
  }

  await mountMcpRoutes(ctx.fastify, {
    tokens,
    verifyDeviceToken: (token) =>
      (ctx.consume<(t: string) => string | null>("host.verifyDeviceToken")?.(token)) ?? null,
    serverInfo: { name: "pi-dashboard", version: process.env.npm_package_version ?? "0.0.0" },
    invokeTool: async (invocation) => {
      const handler = handlers[invocation.tool.name];
      if (!handler) throw new Error(`No handler for tool ${invocation.tool.name}`);
      return handler(invocation);
    },
    recordRefusal: ({ callerSessionId, targetSessionId, tool }) => {
      // G5 — refusals must be observable, with all three identifiers.
      ctx.logger.warn(
        `mcp-server: refused self-target caller=${callerSessionId} target=${targetSessionId} tool=${tool}`,
      );
    },
    openSubscription: async () => {
      // The streaming response is written by the route layer; this hook exists
      // so dispatch stays transport-agnostic and unit-testable.
      throw new Error("subscriptions/listen requires the streaming transport");
    },
    log: {
      info: (m) => ctx.logger.info(m),
      warn: (m) => ctx.logger.warn(m),
      error: (m) => ctx.logger.error(m),
    },
  });

  // --- Token lifecycle over the bridge (Decision 6 / 8) ---------------------

  ctx.registerPiHandler(MINT_MESSAGE, (msg: unknown, sessionId: string) => {
    // `sessionId` is supplied by the gateway from the socket's own key. Nothing
    // in `msg` influences attribution, so minting for a foreign session has no
    // representation on the wire (M4).
    const token = tokens.mintForSession(sessionId);
    ctx.logger.info(`mcp-server: minted a token for session ${sessionId}`);
    return { token };
  });

  ctx.registerPiHandler(REVOKE_MESSAGE, (msg: unknown, sessionId: string) => {
    const revoked = tokens.revokeSession(sessionId);
    ctx.logger.info(`mcp-server: revoked ${revoked} token(s) for session ${sessionId}`);
    return { revoked };
  });

  ctx.onSessionEnded((sessionId: string) => {
    const revoked = tokens.revokeSession(sessionId);
    if (revoked > 0) {
      ctx.logger.info(`mcp-server: session ${sessionId} ended, ${revoked} token(s) died with it`);
    }
  });

  // --- Provisioning ---------------------------------------------------------

  const probe = probeAdapterVersion(ctx.consume<string>("host.piMcpAdapterVersion") ?? null);
  if (!probe.ok) {
    // A warning, not a failure: the endpoint serves external clients fine
    // without a local adapter. Only the local-pi path needs the floor.
    ctx.logger.warn(`mcp-server: ${probe.message}`);
  }

  const port = ctx.consume<number>("host.httpPort") ?? 8000;
  const result = provisionDashboardEntry(
    { readFile: (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null), writeFileAtomic },
    mcpConfigPath(),
    `http://127.0.0.1:${port}/mcp`,
  );
  if (!result.ok) {
    ctx.logger.warn(`mcp-server: could not provision mcp.json (${result.state}): ${result.message}`);
  } else {
    ctx.logger.info(`mcp-server: mcp.json entry ${result.action}`);
  }

  ctx.provide(`${PLUGIN_ID}.disposeForTest`, () => {
    subscriptions.closeAll();
    tokens.dispose();
  });
}

export default registerPlugin;
